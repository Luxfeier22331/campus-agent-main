# AGENTS.md

## Purpose

This file is the repository entry guide for coding agents. Keep it short,
practical and stable. Put detailed architecture, workflow and verification
guidance in `docs/` and link to it from here.

## Project Snapshot

- `campus-agent` is the v2 monorepo for the campus assistant system.
- `main` is the long-lived integration and stable trunk. Short-lived feature
  branches merge to `main` through pull requests.
- When discussing merged truth, default to the state already merged into
  `main`. Feature worktree progress is not merged truth until merged.
- Production release state is selected through release tags and GitHub
  Environments, not through a long-lived development branch.
- `apps/` contains long-running transport/runtime boundaries, `jobs/` contains
  manual or scheduled deployable runtime boundaries, and `packages/` contains
  stable tool/domain boundaries.
- `scripts/` contains repo-level executable entrypoints and shared deploy/env
  primitives. Generic validation uses standard tool CLIs; domain and contract
  invariants belong to their owning app or package tests.
- Current forward student product surface is `campus-web`; `/docs/*` is the
  Rspress-powered canonical reader surface.
- `apps/app-api` is the Worker-owned shared browser-facing API surface.
- `apps/execution-control` is the Go-owned execution-control service. Temporal
  is the execution substrate. PostgreSQL stores sanitized run/event/step
  projections, not raw workflow truth.
- Online answer flow is primary-agent-first. Ordinary chat stays in the primary
  agent path; admitted `knowledge_query` uses the Go-owned RAG Temporal graph.
- Current model-visible tools are controlled by
  `configs/runtime/tools.v4.json`,
  `configs/runtime/tool-function-schemas.v1.json` and
  `configs/runtime/workflow-artifacts.v2.json`.
- Python `apps/supervisor-agent-worker` has been removed from the active
  workspace. Do not restore it as serving code.

## Branch And Worktree

- Work in the current feature worktree and branch unless the user explicitly
  asks to switch.
- Before editing, confirm the current worktree with `git status --short --branch`
  when there is any chance of parallel worktree confusion.
- Never revert user or other-worktree changes unless explicitly asked.
- Ignore unrelated dirty files. If they block the task, call out the conflict
  and work with the existing changes.
- Use `rg` / `rg --files` for search. Use `pnpm` for Node/Worker work.
- Do not add or maintain `package-lock.json`.

## Read First

Use targeted reading. Do not load every document by default.

- Repo overview and commands: `README.md`
- Documentation rules and truth classes:
  `docs/README.md`, `docs/documentation-architecture.md`
- Current merged architecture truth: `docs/architecture/current.md`
- Product scope: `docs/architecture/product.md`
- Target architecture: `docs/architecture/target.md`
- Code organization: `docs/architecture/system/code-organization.md`
- Verification lanes: `docs/reference/testing-and-verification-lanes.md`
- Release and staging QA: `docs/runbooks/e2e-qa-release.md`
- Workstream state: `.planning/PROJECT.md`, `.planning/WORKSTREAMS.md`
- GSD workflow: `docs/runbooks/workstream-gsd-sdk-workflow.md`

For domain work, read the closest relevant `docs/architecture/system/*`,
`docs/architecture/domains/*`, `docs/data/*`, `docs/contracts/*` or ADR before
changing structure or contracts.

## Hard Boundaries

- Do not treat `docs/architecture/target.md` as current merged truth.
- Do not treat local dev/test/deploy paths as architecture truth changes.
- Do not restore old bootstrap/tool-adapter patterns as the product entry,
  top-level router, hidden mega-agent or flat retrieval tool.
- Keep retrieval internals, index building and vector DB details out of the
  Execution Agent Layer and `packages/contracts`.
- Do not leak `Agno`, `LlamaIndex`, `Qdrant`, `MinIO` or other infrastructure
  types into `packages/contracts`.
- Do not mix online query path and offline ingestion/data plane ownership.
- Hindsight personal memory is consumed only through execution-control Temporal
  activities and sanitized projection. Do not expose raw memory ids or payloads
  to primary-agent model-visible tools, app-api contracts or browser responses.
- Campus services model-visible scope currently includes only
  `transport_schedule_lookup`; do not open broader service tools casually.
- `ToolSpec`, contract or JSON Schema existence does not make a tool
  model-visible. Runtime tool exposure must be opened in the runtime configs.
- Prefer mature existing libraries and existing repo primitives for UI,
  framework and generic infrastructure work. Add custom code only when repo
  contracts, authz, projections or domain semantics require it.

## Work Protocol

- First answer the user’s actual question. Do not turn deployment, local test or
  review questions into architecture debates unless the user asks for that.
- If the task is implementation work, read the relevant files and implement
  end-to-end within the current turn when feasible.
- Keep changes scoped to the requested owner/module. Do not do unrelated
  refactors while passing through a file.
- Structural changes must respect owner/runtime/domain boundaries from
  `docs/architecture/system/code-organization.md`.
- Cross-package contract changes should freeze or update `packages/contracts`
  before dependent implementations.
- Fail closed for missing contract, config, authz, evidence or deployment truth.
  Do not add fallback, best-effort, silent recovery or implicit success unless
  the user explicitly asks for it.
- Parallelize independent read-only inspection with `multi_tool_use.parallel`.
  Do not parallelize edits.
- Use `apply_patch` for manual tracked-file edits.
- For frontend changes, keep the first screen usable, respect existing design
  system conventions, ensure mobile text/layout do not overlap, and verify
  browser behavior when the change affects runtime UI.

## Verification Policy

- Match verification to the phase and blast radius.
- During implementation/exploration, default to local, relevant, repeatable and
  cost-controlled checks.
- Before PR, run the affected lint/typecheck/test/build lanes and report what
  passed and what was not run.
- Run real staging E2E, full E2E or release runbooks only when the user asks for
  release/staging validation, the task itself is CI/release governance, or the
  change is being prepared for release.
- Do not list release validation as a normal feature’s current P0 implementation
  step.
- `pnpm repo:static` runs generic formatting and text hygiene only. It is not
  architecture, runtime or E2E validation.
- Use `docs/reference/testing-and-verification-lanes.md` for exact lane meaning
  and commands.

Common local commands:

```bash
pnpm repo:static
pnpm go:check
pnpm ci:rust
pnpm web:lint
pnpm web:typecheck
pnpm web:test
pnpm web:test:worker
pnpm web:test:integration
pnpm web:build
uv run --all-packages ruff check .
uv run --all-packages ruff format . --check
pnpm ci:contracts
pnpm ci:ingest
pnpm ci:eval
```

## External Verification

- 对“最佳实践”“最新推荐”“官方当前能力边界”“当前模型、agent、runtime 建议”这类问题，先联网查官方资料再回答
- 优先查 `developers.openai.com`，其次 `openai.com`
- 如果查不到足够依据，就明确说不确定，不要沿用旧知识补全
- 回答时附实际参考链接，并区分文档事实与推断
- 仓库本地事实、代码结构、已落盘 docs 不需要联网

## Commit Style

- Use Conventional Commit prefixes with Chinese result descriptions:
  `feat:`、`fix:`、`docs:`、`refactor:`、`test:`、`chore:`.
- Prefer verb-object titles, for example `docs: 精简 AGENTS 入口规则`.
- Avoid vague titles such as `update`, `misc`, `init`, `fix stuff`.
- Keep commits focused and do not mix unrelated formatting, refactor and
  behavior changes.

## Repo Map

- `apps/campus-web`: student web shell, account surface and Rspress docs reader.
- `apps/operator-console-web`: controlled operator browser surface.
- `apps/app-api`: Worker-owned shared browser-facing API and product proxy seam.
- `apps/execution-control`: Go execution admission, Temporal control, memory
  recall, RAG activities, finalization and runtime observability.
- `apps/agent-runtime`: OpenAI Agents SDK primary agent runtime.
- `apps/ingestion-control`: TS ingestion task control plane; owns task
  admission, Temporal workflow start, registry-aware activity dispatch,
  terminal closeout and operator projection.
- `apps/source-collector`: TS/Crawlee source collectors and source-channel
  adapters that emit object-store handoff artifacts.
- `apps/ingestion-worker`: removed from the active workspace; old code may only
  be traced through git history and must not be reattached to serving or
  ingestion lifecycle.
- `jobs/dining-sync`: dining data write job/CronJob.
- `jobs/learning-loop-candidates`: learning-loop candidate selection and
  Langfuse dataset publication job.
- `packages/contracts`: shared execution/tool/evidence schemas without runtime
  infrastructure leakage.
- `packages/ingest-core`: runtime-neutral TS ingestion helpers, parsers,
  canonical artifact writers and registry-aware dispatch helpers.
- `packages/ingestion-contracts`: runtime-neutral TS ingestion task envelopes,
  registry schemas and assertion fixtures.
- `packages/ingestion-kernels-rs`: deterministic file-level ingestion kernels.
- `packages/eval-langfuse`: TS Langfuse eval adapter.
- `packages/ragas-runner`: narrow Python Ragas execution island.
