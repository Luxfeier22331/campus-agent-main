# AGENTS.md

## Purpose

This file is the stable repository entry guide for coding agents. Detailed
architecture, contracts, workflows and verification guidance belongs in
`docs/` or the owning module README, not here.

## Repository Truth

- `main` is the long-lived integration and stable trunk. Feature worktrees are
  not merged truth until their pull requests land.
- Production state is selected through release tags and GitHub Environments.
- `apps/` owns long-running transport and runtime boundaries, `jobs/` owns
  scheduled or manual deployable runtimes, and `packages/` owns stable domain,
  contract and reusable logic boundaries.
- `scripts/` contains repository entrypoints and shared deploy/env primitives.
  Domain and contract invariants belong to owner tests, not central scanners.
- Python `apps/supervisor-agent-worker` and `apps/ingestion-worker` are retired.
  Do not restore them as active runtime paths.

## Read First

Read only the sources relevant to the task:

- Repo overview and commands: `README.md`
- Documentation ownership: `docs/README.md`,
  `docs/documentation-architecture.md`
- Current merged architecture: `docs/architecture/current.md`
- Product and target boundaries: `docs/architecture/product.md`,
  `docs/architecture/target.md`
- Code organization: `docs/architecture/system/code-organization.md`
- Verification lanes: `docs/reference/testing-and-verification-lanes.md`
- Active workstreams: `.planning/PROJECT.md`, `.planning/WORKSTREAMS.md`

For domain work, read the closest owner README, architecture document,
contract, data document or ADR before changing structure or interfaces.

## Worktree Safety

- Work in the current feature worktree and branch unless the user asks to
  switch. Confirm with `git status --short --branch` when parallel worktrees
  may be involved.
- Never revert user changes or changes from another worktree unless explicitly
  asked. Work with relevant existing changes and ignore unrelated ones.
- Use `rg` / `rg --files` for search and `pnpm` for Node/Worker work. Do not add
  or maintain `package-lock.json`.

## Stable Boundaries

- Do not treat target architecture, local test paths or deployment procedures
  as current merged runtime truth.
- Keep provider, vector store, object store and framework-specific types out of
  `packages/contracts`.
- Keep online query execution separate from offline ingestion and publication
  ownership.
- Online knowledge admission comes from
  `configs/runtime/query-serving-targets.v1.json`. A target binds one semantic
  id to one `collection` and server-owned serving config; offline `corpus`
  metadata is not duplicated into the target registry. `official_web` remains
  unavailable while it is absent from that registry.
- A schema, config or `ToolSpec` does not by itself make a capability
  model-visible or product-ready. Follow the owning runtime registry and
  product contract.
- Do not restore retired bootstrap routers, hidden mega-agents, compatibility
  wrappers or fallback execution paths without an explicit external migration
  requirement.
- Prefer mature libraries and existing repository primitives for generic UI,
  framework and infrastructure work. Add custom code only for repository
  contracts, authz, projections or domain semantics.

## Implementation

- Answer the user’s actual question first and keep edits scoped to the requested
  owner. Do not perform unrelated refactors while passing through a file.
- Respect ownership boundaries from
  `docs/architecture/system/code-organization.md`.
- Update executable contracts or schemas before dependent implementations when
  a cross-package interface changes.
- Do not add fallback, best-effort recovery, silent success or migration state
  unless the requirement explicitly calls for it.

## Verification

- Match checks to the changed owner and blast radius. During implementation,
  prefer local, repeatable and cost-controlled checks.
- Before a pull request, run affected lint, typecheck, test and build lanes and
  report both executed and omitted checks.
- Run full E2E, staging or release procedures only for release/staging work or
  when the user asks for them.
- `pnpm repo:static` proves generic formatting and text hygiene only. It is not
  runtime, architecture or E2E validation.
- `pnpm ci:repo` runs generic repository formatting and text hygiene only.
- `pnpm ci:ingest` owns ingestion TypeScript typecheck/tests;
  `pnpm ci:eval` owns Langfuse TypeScript and Ragas Python checks.
- Use `docs/reference/testing-and-verification-lanes.md` for exact commands and
  lane meaning.

## External Facts

- For current capabilities, versions and best practices, check the relevant
  official upstream documentation before answering.
- Distinguish documented facts from repository-specific inference and include
  source links. Local code and merged docs remain the source for repository
  facts.

## Commits

- Use Chinese Conventional Commit results with `feat:`, `fix:`, `docs:`,
  `refactor:`, `test:` or `chore:`.
- Keep commits focused and avoid vague titles such as `update`, `misc` or
  `fix stuff`.
