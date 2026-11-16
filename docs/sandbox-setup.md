# Sandbox Setup

How to reproduce the Docker Sandbox environment that powers the TaskFlow software
factory. Covers both the local microVM path (`sbx` CLI) and the cloud path
(`@docker/sandboxes` SDK + GitHub Actions).

---

## 1. Agents & templates

| Stage   | Agent / kit | Template image                         |
|---------|-------------|----------------------------------------|
| spec    | `claude`    | `docker/sandbox-templates:claude-code` |
| coding  | `claude`    | `docker/sandbox-templates:claude-code` |
| review  | `codex`     | `docker/sandbox-templates:codex` *(cloud: `codex` kit)* |
| test    | `claude`    | `factory-test` (custom, see below)     |
| release | `claude`    | `factory-release` (custom, `-docker`)  |

Two custom templates are built from `factory/templates/`:

```bash
cd taskflow
docker build -t "$FACTORY_REGISTRY/factory-test:v1"    -f factory/templates/Dockerfile.test .
docker build -t "$FACTORY_REGISTRY/factory-release:v1" -f factory/templates/Dockerfile.release .
docker push "$FACTORY_REGISTRY/factory-test:v1"
docker push "$FACTORY_REGISTRY/factory-release:v1"
```

`factory-release` uses the `-docker` base variant so its agent can `docker build`
the app image via an inner, host-isolated Docker daemon.

---

## 2. Credentials

Copy `factory/.env.example` to `factory/.env` and fill it in for the cloud path.
For the local `sbx` path, store secrets in the OS keychain instead:

```bash
sbx secret set -g anthropic                    # spec / coding / test / release (claude)
sbx secret set -g openai                       # review (codex)
sbx secret set -g github -t "$(gh auth token)" # clone/push the factory branch
```

With 1Password (`op`), keep them off disk entirely:

```bash
sbx secret set -g anthropic -t "$(op read -n 'op://Vault/Anthropic/credential')"
sbx secret set -g openai    -t "$(op read -n 'op://Vault/OpenAI/credential')"
sbx secret set -g github    -t "$(op read -n 'op://Vault/GitHub/token')"
```

Scope: all three are **global** (`-g`) here because every sandbox the factory
creates is short-lived. If you want a narrower GitHub token for this repo only,
set it per-sandbox after creation: `sbx secret set <name> github -t ...`.

> **Creation-time gotcha:** global secrets are injected only when a sandbox is
> *created*. After changing one, recreate the sandbox (the factory does this each
> run anyway, so it is a non-issue for pipeline runs).

For GitHub Actions, add the same values as repo **secrets**:
`DOCKER_PAT`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (`GITHUB_TOKEN` is automatic).

---

## 3. Network policy

The orchestrator tightens/loosens policy per stage (least privilege):

| Stage   | Hosts allowed beyond default                              |
|---------|-----------------------------------------------------------|
| spec    | none (`deny-all`)                                         |
| coding  | `registry.npmjs.org`, `*.npmjs.org`                       |
| review  | `+ api.openai.com`                                        |
| test    | npm registry                                              |
| release | `+ docker.io`, `*.docker.io`, `ghcr.io`, `*.ghcr.io`      |

If your dependencies pull from other hosts, add them with
`sbx policy allow network "<host>"` and check `sbx policy log` for blocks.
Remember: **deny always beats allow**, and `example.com` does not match
`*.example.com`.

---

## 4. Port forwarding (manual app runs)

To poke at the running app inside a sandbox, forward a port after the sandbox
exists (the app binds `0.0.0.0` already):

```bash
sbx ports <sandbox> --publish 8080:3000     # host:8080 -> app:3000
```

Port mappings are lost on `sbx stop` and must be re-added after restart.

---

## 5. Branch / handoff convention

- **Local path:** stages use `--clone`; the host pulls each stage's work via
  `git fetch sandbox-<stage>` and merges it onto `factory/<timestamp>`.
- **Cloud path:** each sandbox clones the GitHub repo and pushes the same
  `factory/<timestamp>` branch; the workflow opens the PR.
- `.gitignore` already excludes `.sbx/`, `.env`, and `node_modules/`.

---

## 6. Post-session checklist

After any sandbox session (especially before merging a factory PR):

1. `cat .git/hooks/*` — agent-authored git hooks are **invisible to `git diff`**.
2. Read the full diff, including `package.json` and any CI/config files.
3. Review `SPEC.md` and `REVIEW.md` on the branch — they are the agents'
   reasoning trail.
4. Confirm `npm test` is green locally (the factory verifies this, but trust it
   once yourself).

---

## 7. Quick smoke test

```bash
# Local VM
sbx run shell .                    # bare sandbox on this repo
sbx exec -it <name> bash -lc "npm ci && npm test"

# Cloud SDK orchestrator
cd factory && npm install && npm run typecheck
```
