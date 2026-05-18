---
doc_type: summary
status: completed
created: 2026-05-02
updated: 2026-05-02
---

# Summary: Phase 08 Documentation Guardrails And Acceptance

## Outcome

The workstream is closed with docs, implementation guardrails, staging checks
and focused runtime verification.

Closed scope:

- Architecture docs describe hub as the product entry surface and MediaWiki as a
  sibling legacy service.
- `apps/hub-web` README documents local, build, staging and auth seam behavior.
- Hub staging build and config verification require hub-scoped Turnstile config.
- Worker staging preflight and env doctor include `hub-web`.
- `doctor_env` worker staging specs were split into a helper module to avoid
  growing the main diagnostic file.
- Phase plan frontmatter and summaries now match the completed workstream state.

## Verification

Fresh focused verification:

```bash
pnpm --filter hub-web test
pnpm --filter hub-web typecheck
pnpm --filter hub-web test:worker
pnpm --filter hub-web build
STAGING_HUB_AUTH_TURNSTILE_SITE_KEY=0x4AAAAAAAstagingWidget pnpm --filter hub-web build:staging
STAGING_HUB_AUTH_TURNSTILE_SITE_KEY=0x4AAAAAAAstagingWidget pnpm --filter hub-web deploy:verify-config:staging
pnpm --filter app-api exec vitest run -c vitest.node.config.mts test/worker.test.ts test/auth-and-db.test.ts
pnpm --filter public-chat-web test:worker
uv run --all-packages python -m unittest tests.test_doctor_env tests.test_check_worker_secret_presence tests.test_workspace_layout
pnpm docs:lint
pnpm yaml:lint
git diff --check
```

Result: all listed focused commands exited `0`.

## Repo-wide Gate Notes

`pnpm web:lint` and `pnpm decomposition:lint` were run. Their remaining
failures are outside this workstream:

- `pnpm web:lint`: existing official-web formatting failures in
  `apps/app-api/src/modules/official-web-planner/store.ts` and
  `configs/sources/official_web/muc_public/consumer-denominator.json`.
- `pnpm decomposition:lint`: existing large-file failures in ingestion,
  official-web, protected-panel, supervisor-api and campus-services surfaces.

## Residuals

No hub workstream implementation blocker remains.
