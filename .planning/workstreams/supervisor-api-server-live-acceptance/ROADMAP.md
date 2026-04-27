---
doc_type: roadmap
status: active
created: 2026-04-27
updated: 2026-04-27
---

# Roadmap: Supervisor API Server Live Acceptance

当前为 detailed active plan。执行时只做 `ubuntu-43` 非 WSL 服务侧验收，不扩大到
server-side build、长期部署、生产容量或真实 ingress 接入。

## Phase 0: Scope Lock And Host Readiness Baseline

**Goal:** 固定本次验收边界与 `ubuntu-43` host facts，避免再次把服务侧验收扩展成 build /
long-running / production capacity 任务。

**Inputs:**

- `.planning/workstreams/supervisor-api-docker-dev-package-hardening/STATE.md`
- `docs/runbooks/supervisor-api-server-handoff.md`
- Windows SSH alias: `ubuntu-43`

**Scope:**

- 记录 host facts：
  - OS
  - Docker / Compose version
  - CPU / memory / swap / disk
  - target port availability
  - existing containers
  - existing `80/443` listeners
- 明确验收端口：默认 `127.0.0.1:38080`。
- 明确禁止事项：
  - no server-side build
  - no `80/443` change
  - no long-running service
  - no capability gate opening

**Primary Write Set:**

- `.planning/workstreams/supervisor-api-server-live-acceptance/STATE.md`

**Verification:**

```bash
powershell.exe -NoProfile -Command "ssh ubuntu-43 'hostname && docker --version && docker compose version'"
powershell.exe -NoProfile -Command "ssh ubuntu-43 'free -h && df -h / && ss -ltn'"
```

**Exit Criteria:**

- `STATE.md` records current host baseline.
- Any blocker is recorded before deployment material transfer.

## Phase 1: Image Source And No-Build Acceptance Bundle

**Goal:** 准备不会在 `ubuntu-43` 触发 build 的验收材料。

**Scope:**

- 选择 image source：
  - preferred: local prebuilt image tar copied to `ubuntu-43`
  - allowed: registry pull if registry image already exists
  - allowed: already-present host image
- 准备 no-build compose：
  - uses `image:` only
  - no `build:` keys
  - binds `127.0.0.1:38080:8000`
  - keeps service DNS `supervisor-agent-worker:18081`
- 准备 smoke env：
  - local acceptance placeholder secrets
  - mock runtime provider/model/API key
  - capability gates remain closed
- 准备 remote directory:
  - `~/campus-agent-supervisor-acceptance`

**Primary Write Set:**

- remote-only files under `~/campus-agent-supervisor-acceptance/`
- optional local `.tmp/` generated transfer bundle
- `.planning/workstreams/supervisor-api-server-live-acceptance/STATE.md`

**Verification:**

```bash
powershell.exe -NoProfile -Command "ssh ubuntu-43 'test -d ~/campus-agent-supervisor-acceptance'"
powershell.exe -NoProfile -Command "ssh ubuntu-43 'grep -R \"build:\" ~/campus-agent-supervisor-acceptance || true'"
```

**Exit Criteria:**

- Remote compose cannot trigger a server-side build.
- Required images are available through load/pull/present-image path.
- Secrets are placeholders scoped to acceptance only.

## Phase 2: Isolated Runtime Bring-Up

**Goal:** 在 `ubuntu-43` 上用独立 project 和端口启动双容器 runtime。

**Scope:**

- Start with:
  - `COMPOSE_PROJECT_NAME=campus-supervisor-live-acceptance`
  - `SUPERVISOR_API_HOST_PORT=38080`
- Wait for:
  - `supervisor-agent-worker` healthy
  - `supervisor-api` healthy
- Capture:
  - `docker compose ps`
  - `docker inspect` health status
  - `docker logs --tail`

**Primary Write Set:**

- remote artifact directory
- `.planning/workstreams/supervisor-api-server-live-acceptance/STATE.md`

**Verification:**

```bash
powershell.exe -NoProfile -Command "ssh ubuntu-43 'cd ~/campus-agent-supervisor-acceptance && docker compose ps'"
powershell.exe -NoProfile -Command "ssh ubuntu-43 'curl -fsS http://127.0.0.1:38080/healthz'"
```

**Exit Criteria:**

- Both containers reach healthy.
- `127.0.0.1:38080/healthz` returns `200`.
- `80/443` remain untouched.

## Phase 3: Closed-Gate Service Smoke And Artifact Capture

**Goal:** 在真实 server runtime 上验证 health / ready / metrics / closed-gate answer contract。

**Scope:**

- Capture:
  - `healthz.json`
  - `readyz.json`
  - `metrics.txt`
  - `answer.json`
  - `summary.json`
- Closed-gate request:
  - requested capability: `campus_services`
  - expected HTTP status: `503`
  - expected code/body marker: `structured_runtime_closed`
- Record:
  - host alias and hostname
  - compose project
  - image ids
  - status codes
  - smoke result

**Primary Write Set:**

- remote artifact directory
- optional copied artifact summary under local `.tmp/`
- `.planning/workstreams/supervisor-api-server-live-acceptance/STATE.md`

**Verification:**

```bash
powershell.exe -NoProfile -Command "ssh ubuntu-43 'test -f ~/campus-agent-supervisor-acceptance/artifacts/latest/summary.json'"
powershell.exe -NoProfile -Command "ssh ubuntu-43 'grep structured_runtime_closed ~/campus-agent-supervisor-acceptance/artifacts/latest/answer.json'"
```

**Exit Criteria:**

- `/healthz`, `/readyz`, `/metrics` status codes match expected values.
- `/api/v1/answer` closed gate returns `503`.
- artifact contains no real secret.

## Phase 4: Cleanup And Non-Interference Verification

**Goal:** 验收结束后清理 runtime，并证明没有影响业务入口。

**Scope:**

- Run:
  - `docker compose down --remove-orphans`
- Verify:
  - acceptance containers removed
  - acceptance network removed
  - `38080` released
  - `80/443` still have the same listener posture as Phase 0
- Retain:
  - artifacts
  - minimal logs

**Primary Write Set:**

- remote artifact directory
- `.planning/workstreams/supervisor-api-server-live-acceptance/STATE.md`

**Verification:**

```bash
powershell.exe -NoProfile -Command "ssh ubuntu-43 'docker ps --format \"{{.Names}}\" | grep campus-supervisor-live-acceptance || true'"
powershell.exe -NoProfile -Command "ssh ubuntu-43 'ss -ltn | grep 38080 || true'"
```

**Exit Criteria:**

- No acceptance containers remain running.
- No acceptance network remains unless Docker keeps it for non-running resources; if present, it is recorded.
- `38080` is free.

## Phase 5: Evidence Reconciliation And Workstream Closeout

**Goal:** 把服务器实机证据回写到 repo planning，关闭 live-only gap。

**Scope:**

- Update `STATE.md`:
  - host alias
  - hostname
  - timestamp
  - image source
  - artifact path
  - command summary
  - passed / waived / not-in-scope items
- Update upstream workstream state if needed:
  - `.planning/workstreams/supervisor-api-docker-dev-package-hardening/STATE.md`
  - `.planning/workstreams/supervisor-api-docker-dev-package-hardening/ROADMAP.md`
- Update `.planning/WORKSTREAMS.md` if this workstream is completed.

**Primary Write Set:**

- `.planning/workstreams/supervisor-api-server-live-acceptance/STATE.md`
- `.planning/workstreams/supervisor-api-docker-dev-package-hardening/STATE.md`
- `.planning/workstreams/supervisor-api-docker-dev-package-hardening/ROADMAP.md`
- `.planning/WORKSTREAMS.md`

**Verification:**

```bash
pnpm docs:lint
```

**Exit Criteria:**

- `supervisor-api-docker-dev-package-hardening` no longer lists non-WSL server live acceptance as
  unresolved.
- This workstream records exact evidence and remaining non-goals.
- No unverified production/long-running claims are added.
