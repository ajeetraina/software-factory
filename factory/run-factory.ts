/**
 * TaskFlow software factory — CLOUD orchestrator (Docker Sandboxes TypeScript SDK).
 *
 * Same five stages as factory/run-factory.sh (spec -> coding -> review -> test ->
 * release), but each stage runs as an agent *kit* on Docker-managed cloud infra
 * instead of a local microVM. Artifacts hand off through a GitHub branch: each
 * sandbox clones the repo, the agent commits, and pushes the shared factory branch.
 *
 * Run:
 *   cd taskflow/factory && npm install
 *   DOCKER_PAT=... GITHUB_TOKEN=... GITHUB_REPOSITORY=owner/repo \
 *     npm run factory -- "Add PATCH /tasks/:id to update title and completed"
 *
 * Verified against docs.docker.com/ai/sandboxes-api: package name, `Sandboxes`
 * client, `kits.launchAndWait`, `processes.run({args},{timeoutMs})`,
 * `refresh()`/`delete({force})`/`waitUntilDeleted()`. Spots that depend on your
 * installed SDK version are marked `NOTE:` — confirm them against the cookbook.
 */
import { oauth, Sandboxes } from "@docker/sandboxes";

// ---- inputs -----------------------------------------------------------------
const FEATURE = process.argv.slice(2).join(" ").trim();
if (!FEATURE) {
  console.error('Usage: npm run factory -- "<feature request>"');
  process.exit(1);
}

const REPO = requireEnv("GITHUB_REPOSITORY"); // "owner/repo"
const GH_TOKEN = requireEnv("GITHUB_TOKEN");
const DOCKER_PAT = process.env.DOCKER_PAT; // set in CI; omit for local OAuth
const BRANCH = `factory/${Date.now()}`;
const REMOTE = `https://x-access-token:${GH_TOKEN}@github.com/${REPO}.git`;

// Per-agent headless invocation builders. Each takes the prompt and returns the
// shell command to run inside the sandbox. Claude passes the prompt via -p;
// Codex runs it as a positional arg to its `exec` subcommand.
type Invoke = (prompt: string) => string;
const claudeCmd: Invoke = (p) => `claude --dangerously-skip-permissions -p ${JSON.stringify(p)}`;
const codexCmd: Invoke = (p) => `codex exec --full-auto ${JSON.stringify(p)}`;
// NOTE: confirm each agent's exact non-interactive flag against its CLI docs.

// ---- client -----------------------------------------------------------------
// NOTE: PAT auth is the automation path. The exact helper name may differ by SDK
// version (the verified interactive example uses `oauth({...})`). If your version
// exposes e.g. `pat(token)` or `token(...)`, swap it in here.
const client = new Sandboxes(
  DOCKER_PAT
    ? ({ auth: { token: DOCKER_PAT } } as any) // <-- confirm against cookbook "authenticate automation with a PAT"
    : {
        auth: oauth({
          onVerification({ verificationUriComplete, verificationUri, userCode }) {
            console.log(`Open ${verificationUriComplete ?? verificationUri}`);
            console.log(`Verification code: ${userCode}`);
          },
        }),
      },
);

// ---- helpers ----------------------------------------------------------------
/** Run a shell command in a sandbox; throw on non-zero exit. */
async function sh(sandbox: any, script: string, timeoutMs = 600_000) {
  const result = await sandbox.processes.run(
    { args: ["bash", "-lc", script] },
    { timeoutMs },
  );
  const code = result.exitCode ?? result.code ?? 0;
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (code !== 0) throw new Error(`command failed (exit ${code}): ${script.slice(0, 80)}…`);
  return result;
}

/**
 * One factory stage: launch a kit, clone+checkout the branch, run the agent
 * headless, commit, push. The sandbox is always deleted, even on failure.
 */
async function runStage(name: string, kit: string, prompt: string, invoke: Invoke = claudeCmd) {
  console.log(`\n=================== STAGE: ${name} (kit: ${kit}) ===================`);
  // NOTE: agent kits need their provider credential (Anthropic for `claude`,
  // OpenAI for `codex`). In cloud this comes from a configured secret/kit setting
  // — see the cookbook "run agents with kits". launchAndWait may take an options arg.
  const sandbox = await client.kits.launchAndWait(kit);
  try {
    await sh(
      sandbox,
      `set -e
       git clone ${REMOTE} /work
       cd /work
       git config user.email factory@taskflow.local
       git config user.name  "TaskFlow Factory"
       git checkout ${BRANCH} 2>/dev/null || git checkout -b ${BRANCH}`,
    );
    await sh(sandbox, `cd /work && ${invoke(prompt)}`);
    await sh(
      sandbox,
      `cd /work
       git add -A
       git commit -m ${JSON.stringify(`factory(${name}): ${FEATURE}`)} || echo "nothing to commit"
       git push origin ${BRANCH}`,
    );
  } finally {
    const latest = await sandbox.refresh();
    const deleting = await latest.delete({ force: true });
    await deleting?.waitUntilDeleted();
  }
}

// ---- the pipeline -----------------------------------------------------------
async function main() {
  console.log(`>> Factory branch: ${BRANCH}\n>> Feature: ${FEATURE}`);

  await runStage(
    "spec",
    "claude",
    `Read the repo. The requested feature is: "${FEATURE}". Write SPEC.md with the ` +
      `HTTP method+path, request body schema, success response+status, every validation ` +
      `rule, every error case+status, and numbered acceptance criteria. No app code, no tests.`,
  );

  await runStage(
    "coding",
    "claude",
    `Implement the feature in src/ to satisfy SPEC.md exactly. Match the existing style ` +
      `(ES modules, the db.js repository pattern, routes/). Add db.update() if needed. No tests.`,
  );

  // Cross-model review: a DIFFERENT model (Codex) audits Claude's code. Swap the
  // kit to "gemini" (and pass a gemini invoke builder) for a third opinion.
  await runStage(
    "review",
    "codex",
    `Review the diff on this branch against SPEC.md for correctness, security, validation, ` +
      `and style. Write REVIEW.md as a checklist of 'file:line [BLOCKER|MAJOR|MINOR] description'. ` +
      `Fix any BLOCKER findings directly.`,
    codexCmd,
  );

  await runStage(
    "test",
    "claude",
    `Write vitest + supertest tests in test/ covering EVERY acceptance criterion in SPEC.md ` +
      `including error cases. Run 'npm ci && npm test'. Fix code or tests until the suite is ` +
      `fully green. Exit non-zero if you cannot make it pass.`,
  );

  await runStage(
    "release",
    "claude",
    `Bump the patch version in package.json (semver). Build the app image with ` +
      `'docker build -t taskflow:$(node -p "require(\\'./package.json\\').version") .' and ` +
      `confirm it builds. Add a dated CHANGELOG.md entry. Create an annotated git tag v<version>.`,
  );

  console.log(`\n>> Factory complete on branch ${BRANCH}.`);
  console.log(`>> Open a PR:  gh pr create --base main --head ${BRANCH}`);
  // Machine-readable handoff for the GitHub Actions step:
  if (process.env.GITHUB_OUTPUT) {
    const fs = await import("node:fs");
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `branch=${BRANCH}\n`);
  }
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
