# authenticated-notice-collector

Repo-local collector runtime shell for authenticated notice portal collection.

This app fetches authenticated portal notices and file-release source material,
then writes verified source-bucket artifacts and source-channel run ledger
facts. It does not own ingestion task admission, document registry writes,
chunk/index release, query-serving or regulation promotion.

## Scope

Current collector modes:

- `auth-check`
- `notice-export`
- `file-release-export`
- `visual-ref-audit`

Current responsibilities:

- reuse operator-provided authenticated portal cookies
- fetch notice and file-release list/detail API data
- capture typed attachment refs and selected admitted source bytes
- upload verified source bundle/manifest artifacts when object-store source
  credentials are configured
- write bounded collector run ledger state when configured
- expose read-only visual reference audit for source selection

Attachment routing, OCR, source-truth materialization, replay, chunking and
query-serving are downstream ingestion responsibilities.

## References

- authenticated-notice architecture:
  `docs/architecture/domains/authenticated-notice/architecture.md`
- source truth schema: `docs/data/authenticated-notice.md`
- file-release export contract:
  `docs/contracts/authenticated-notice-file-release-export.md`
- auth-window runbook: `docs/runbooks/notice-release-auth-window.md`
- ingestion lifecycle runbook:
  `docs/runbooks/ingestion-control-clean-target.md`

## Local Commands

```bash
pnpm install
pnpm --dir apps/authenticated-notice-collector test
pnpm --dir apps/authenticated-notice-collector typecheck
pnpm --dir apps/authenticated-notice-collector build
pnpm --dir apps/authenticated-notice-collector auth:check
pnpm --dir apps/authenticated-notice-collector bootstrap:export
pnpm --dir apps/authenticated-notice-collector file-release:export
```

Docker package:

```bash
docker build -f apps/authenticated-notice-collector/Dockerfile \
  -t campus-authenticated-notice-collector:local .
AUTHENTICATED_NOTICE_COLLECTOR_MODE=auth-check \
docker run --rm --env-file .env campus-authenticated-notice-collector:local
```

External cron, systemd or Kubernetes Job owns scheduling. Local JSON exports
are operator artifacts only and must not be treated as canonical system truth.
