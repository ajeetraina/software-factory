# TaskFlow

A minimal task REST API (Express + in-memory store, zero native deps) used as
the sample application for a **Docker Sandbox software factory** — five AI coding
agents (spec → coding → reviewer → test → release), each running in its own
isolated microVM, chained together over a git branch.

## The app

| Method | Path          | Status | Purpose                         |
|--------|---------------|--------|---------------------------------|
| GET    | `/health`     | 200    | Liveness check                  |
| GET    | `/tasks`      | 200    | List tasks                      |
| GET    | `/tasks/:id`  | 200/404| Fetch one task                  |
| POST   | `/tasks`      | 201/400| Create a task (`{ "title" }`)   |
| DELETE | `/tasks/:id`  | 204/404| Delete a task                   |
| PATCH  | `/tasks/:id`  | —      | **Not implemented** — this is what the factory builds |

### Run it locally

```bash
npm install
npm start           # http://0.0.0.0:3000
npm test            # vitest + supertest
```

```bash
curl -s localhost:3000/tasks
curl -s -X POST localhost:3000/tasks -H 'content-type: application/json' -d '{"title":"ship it"}'
```

### Project layout

```
taskflow/
├── src/
│   ├── app.js            # builds the Express app (no listener) — imported by tests
│   ├── server.js         # binds 0.0.0.0:3000 (0.0.0.0 required for `sbx ports`)
│   ├── db.js             # swappable in-memory repository
│   └── routes/tasks.js   # task routes (PATCH intentionally missing)
├── test/tasks.test.js    # covers existing endpoints; factory adds the PATCH suite
├── Dockerfile            # the app image the Release stage builds
└── factory/
    ├── run-factory.sh    # the 5-stage orchestrator
    └── templates/
        ├── Dockerfile.test     # claude-code + vitest/supertest
        └── Dockerfile.release  # claude-code-docker (inner Docker daemon)
```

## Running the factory

> Full environment reference (templates, secrets, per-stage network policy,
> ports, post-session checklist): [`docs/sandbox-setup.md`](docs/sandbox-setup.md).
> Copy [`factory/.env.example`](factory/.env.example) → `factory/.env` for the
> cloud path.

### 1. One-time host setup

```bash
brew install docker/tap/sbx
sbx login                                     # choose Balanced or Locked Down
sbx secret set -g anthropic                   # Anthropic key (or --oauth) — spec/coding/test/release
sbx secret set -g openai                      # OpenAI key — the Codex review stage
sbx secret set -g github -t "$(gh auth token)"
```

### 2. Build the two custom templates (once)

Replace `youruser` with your registry namespace, then set `FACTORY_REGISTRY`.

```bash
cd taskflow
docker build -t docker.io/youruser/factory-test:v1    -f factory/templates/Dockerfile.test .
docker build -t docker.io/youruser/factory-release:v1 -f factory/templates/Dockerfile.release .
docker push docker.io/youruser/factory-test:v1
docker push docker.io/youruser/factory-release:v1
export FACTORY_REGISTRY=docker.io/youruser
```

### 3. Make this a git repo (the factory hands off via git)

```bash
cd taskflow
git init && git add -A && git commit -m "TaskFlow starter"
```

### 4. Run the factory

```bash
./factory/run-factory.sh "Add PATCH /tasks/:id to update a task's title and completed status"
```

Each stage spins up a dedicated sandbox, runs an agent **headless** via
`sbx exec <name> -- claude --dangerously-skip-permissions -p "..."`, commits its
output, and is torn down. The host merges each stage forward onto a
`factory/<timestamp>` branch, runs an independent `npm test` verification, and
stops early if the reviewer records a `BLOCKER`. When it finishes:

```bash
gh pr create --base main --head factory/<timestamp>
```

## How the isolation maps to the stages

| Stage    | Sandbox image                     | Network policy                         | Why isolated |
|----------|-----------------------------------|----------------------------------------|--------------|
| spec     | `claude-code`                     | `deny-all`                             | No reason to touch the network |
| coding   | `claude-code`                     | npm registry only                      | Can install deps, nothing else |
| review   | **`codex`** (cross-model)         | + `api.openai.com`                     | A *different* model audits Claude's code |
| test     | `factory-test` (custom)           | npm registry only                      | Runs untrusted generated tests |
| release  | `factory-release` (`-docker`)     | npm + docker/ghcr registries           | Builds a container via inner daemon |

The reviewer runs **Codex**, not Claude, so a second model independently audits
the code the first one wrote. Swap it to `gemini` in either orchestrator for a
third opinion. This is why the review stage needs the OpenAI secret +
`api.openai.com` network access.

The microVM boundary — not in-VM privileges — is the security control, which is
why `--dangerously-skip-permissions` is safe here. After a run, inspect
`.git/hooks/` and the diff before merging (git hooks don't show up in `git diff`).

## Cloud / CI variant

The same pipeline runs on Docker-managed cloud infra via the **Sandboxes API +
TypeScript SDK** (`@docker/sandboxes`), in `factory/run-factory.ts`. It launches
each stage as an agent *kit* and hands off through a GitHub branch:

```bash
cd factory && npm install
npm run typecheck                             # tsc --noEmit against the real SDK types
DOCKER_PAT=... GITHUB_TOKEN=... GITHUB_REPOSITORY=owner/repo \
  npm run factory -- "Add PATCH /tasks/:id to update title and completed"
```

### Trigger from a GitHub issue

`.github/workflows/factory.yml` runs the cloud orchestrator when an issue is
labelled **`factory`**, using the issue title+body as the feature request, then
opens a PR that closes the issue. Required repo secrets: `DOCKER_PAT`,
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (`GITHUB_TOKEN` is automatic). The workflow
type-checks the orchestrator before running it.

Non-interactive CI login for the `sbx` CLI (local-VM path):

```bash
echo "$DOCKER_PAT" | sbx login --username <your-docker-id> --password-stdin
```
