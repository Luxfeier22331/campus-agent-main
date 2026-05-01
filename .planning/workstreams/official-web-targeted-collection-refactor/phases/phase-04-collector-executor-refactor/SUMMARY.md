---
doc_type: phase_summary
status: complete
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 4 Summary: Collector Executor Refactor

## Completed

- Added explicit collector execution mode semantics: app-api admitted runs execute `target-workset`; legacy debug runs remain `legacy-broad-crawl`.
- Changed target-workset initial request construction to use returned planner pages only, excluding seeds and sitemap expansion.
- Changed navigation, listing requeue and dynamic-shell requeue to reject URLs not present in the target workset lookup.
- Changed control-plane execution host selection to come from returned workset hosts.
- Added target workset counters to heartbeat progress payloads using flat numeric keys by target job and consumer family.
- Preserved explicit legacy broad crawl admission with `legacy_contract_excluded`.

## Verification

```bash
pnpm --dir apps/official-web-collector test
pnpm --dir apps/official-web-collector typecheck
pnpm --dir apps/app-api test -- official-web-command
pnpm exec biome check apps/official-web-collector/src/crawl.ts apps/official-web-collector/src/crawl-host-runner.ts apps/official-web-collector/src/crawl-single-host.ts apps/official-web-collector/src/crawl-discovery-requests.ts apps/official-web-collector/src/crawl-discovery-requeue.ts apps/official-web-collector/src/crawl-progress.ts apps/official-web-collector/src/crawl-internal-types.ts apps/official-web-collector/test/crawl-workset-executor.test.ts apps/official-web-collector/test/crawl-incremental.test.ts
```

## Follow-Up

- Phase 5 must persist target lineage into source-truth artifacts and make validation reject retained pages without lineage.
