---
doc_type: phase_plan
workstream: shared-file-asset-loader-contract
phase: "H"
phase_name: "LibreOffice Conversion Runtime Productization"
plan: "02"
type: execute
wave: 1
status: active
autonomous: true
language: zh-CN
depends_on: []
files_modified:
  - apps/legacy-office-conversion-service
  - infra/local/docker-compose.legacy-office-conversion.yml
requirements:
  - H1
must_haves:
  truths:
    - repo owns a standalone self-hosted conversion runtime using JODConverter + LibreOffice
    - `GET /healthz`, `GET /readyz`, and `POST /api/internal/legacy-office/conversions` are the only admitted service routes
    - readiness is stricter than liveness and shared-secret admission is enforced at the service boundary
  artifacts:
    - apps/legacy-office-conversion-service
    - infra/local/docker-compose.legacy-office-conversion.yml
  key_links:
    - docker compose boots the same service consumed by H-01 client contract
    - readiness and admission semantics match the env/runbook contract used in H-03
created: 2026-04-20
updated: 2026-04-20
---

<objective>
落 repo-owned `JODConverter + LibreOffice` self-hosted conversion runtime，并固定 service health/admission/runtime contract。

Purpose: 把 H1 中的 self-hosted service boundary真正变成 repo 内可部署、可探活、可测试的 runtime，而不是继续依赖业务 worker 的本机 office lifecycle。
Output: 独立 service app、local compose 启动方式、controller/health tests。
</objective>

<execution_context>
@$HOME/.codex/get-shit-done/workflows/execute-plan.md
@$HOME/.codex/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/workstreams/shared-file-asset-loader-contract/ROADMAP.md
@.planning/workstreams/shared-file-asset-loader-contract/phases/phase-h-libreoffice-conversion-runtime-productization/CONTEXT.md
@.planning/workstreams/shared-file-asset-loader-contract/phases/phase-h-libreoffice-conversion-runtime-productization/RESEARCH.md
@.planning/workstreams/shared-file-asset-loader-contract/phases/phase-h-libreoffice-conversion-runtime-productization/PATTERNS.md
@docs/architecture/system/file-asset-loader-architecture.md
@apps/ingestion-worker/README.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: 新建 standalone conversion service app</name>
  <files>apps/legacy-office-conversion-service</files>
  <read_first>.planning/workstreams/shared-file-asset-loader-contract/phases/phase-h-libreoffice-conversion-runtime-productization/RESEARCH.md, .planning/workstreams/shared-file-asset-loader-contract/phases/phase-h-libreoffice-conversion-runtime-productization/PATTERNS.md, docs/architecture/system/file-asset-loader-architecture.md</read_first>
  <action>新建 `apps/legacy-office-conversion-service/` 作为独立 runtime boundary，固定实现为 Java HTTP service + JODConverter local office manager + LibreOffice。实现 `POST /api/internal/legacy-office/conversions`、`GET /healthz`、`GET /readyz` 三条 route；request JSON 固定包含 `source_media_type`、`target_format`、`source_sha256`、`filename`、`source_bytes_b64`，仅允许 `target_format=docx|xlsx`；response JSON 固定包含 `target_format`、`normalized_media_type`、`normalized_sha256`、`engine_name`、`engine_version`、`normalized_bytes_b64`、`warnings`。在 service 内用 `x-app-internal-auth` 做 shared-secret admission，wrong or missing secret 返回 401/403。`/readyz` 必须比 `/healthz` 更严格：只有 office manager 已启动、workdir 可写、service 没进入 degraded queue state 时才 ready。不要把 JODConverter 藏回 Python worker，也不要暴露 public token/OAuth admission 模式。</action>
  <verify>docker build -f apps/legacy-office-conversion-service/Dockerfile --target unit-tests -t campus-legacy-office-conversion:test /home/reptilian/code/campus-agent</verify>
  <acceptance_criteria>
    - repo 内存在独立的 `apps/legacy-office-conversion-service`
    - service route、payload shape、shared-secret admission 与 readiness semantics 全部落盘
    - service controller/health tests 能在 Docker 构建流程内通过
  </acceptance_criteria>
  <done>repo 已拥有独立 self-hosted conversion runtime，实现了 H1 的 service boundary。</done>
</task>

<task type="auto">
  <name>Task 2: 落本地 compose 启动与 readiness gate</name>
  <files>infra/local/docker-compose.legacy-office-conversion.yml</files>
  <read_first>apps/legacy-office-conversion-service, docs/architecture/system/file-asset-loader-architecture.md</read_first>
  <action>新增 `infra/local/docker-compose.legacy-office-conversion.yml`，暴露 `127.0.0.1:8091:8091`，把 `LIBREOFFICE_SERVICE_BIND=0.0.0.0:8091`、`LEGACY_OFFICE_CONVERSION_INTERNAL_SHARED_SECRET`、`LIBREOFFICE_SERVICE_TASK_TIMEOUT_MS`、`LIBREOFFICE_SERVICE_QUEUE_TIMEOUT_MS`、`LIBREOFFICE_SERVICE_WORKDIR=/tmp/legacy-office-conversion` 接起来，并把 container healthcheck 固定为 `GET /readyz`，不是只探进程是否存活。compose 目标是让 Phase H 在 repo 内有一条可重复执行的 self-hosted runtime 启动路径。</action>
  <verify>docker compose -f infra/local/docker-compose.legacy-office-conversion.yml up -d --build && curl -sS http://127.0.0.1:8091/healthz && curl -sS http://127.0.0.1:8091/readyz && docker compose -f infra/local/docker-compose.legacy-office-conversion.yml down</verify>
  <acceptance_criteria>
    - `docker compose -f infra/local/docker-compose.legacy-office-conversion.yml up -d --build` 可以把 service 启起来
    - `/readyz` 为 200 时表示 JODConverter + LibreOffice 真正可接单
    - compose 配置不把 business worker 和 office process lifecycle 再次绑死
  </acceptance_criteria>
  <done>Phase H 拥有可重复启动的 self-hosted runtime 入口，health/readiness gate 也已落盘。</done>
</task>

</tasks>

<verification>
Before declaring plan complete:
- [ ] `docker build -f apps/legacy-office-conversion-service/Dockerfile --target unit-tests -t campus-legacy-office-conversion:test /home/reptilian/code/campus-agent`
- [ ] `docker compose -f infra/local/docker-compose.legacy-office-conversion.yml up -d --build`
- [ ] `curl -sS http://127.0.0.1:8091/healthz`
- [ ] `curl -sS http://127.0.0.1:8091/readyz`
- [ ] `docker compose -f infra/local/docker-compose.legacy-office-conversion.yml down`
</verification>

<success_criteria>

- repo 拥有独立的 `JODConverter + LibreOffice` self-hosted runtime
- service health, readiness, and admission semantics 与 H-01/H-03 共享同一 contract
- 本地 compose 成为 repo-owned 的 runtime bootstrap 入口
</success_criteria>

<output>
After completion, create `.planning/workstreams/shared-file-asset-loader-contract/phases/phase-h-libreoffice-conversion-runtime-productization/H-02-SUMMARY.md`
</output>
