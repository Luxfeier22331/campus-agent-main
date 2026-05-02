---
doc_type: index
status: active
created: 2026-05-02
updated: 2026-05-02
---

# Workstream: Hub Product Entry And Legacy Wiki Identity

This workstream plans and implements the `hub.muc.wiki/[slug]` product entry
surface for the campus-agent app set.

It explicitly does not replace the existing `muc.wiki` MediaWiki service.
MediaWiki remains a sibling legacy service with its own historical user system.
MediaWiki page content and uploaded media remain in the legacy service; this
workstream does not plan content migration, media migration, mirroring or
proxying.

## Current Status

- status: `active`
- current phase: `Phase 1 next`
- current focus: freeze product hub boundary, route namespace, account shell
  ownership, legacy MediaWiki external-link posture, and identity compatibility
  guardrails

## Boundary

- `apps/hub-web` serves `hub.muc.wiki/[slug]` as the new app-set entry shell.
- `muc.wiki` remains the existing MediaWiki service.
- `apps/app-api` remains canonical product identity / session / principal owner.
- `apps/supervisor-api` and domain agents do not read MediaWiki sessions or
  become identity owners.
- MediaWiki identity starts as external-link-only compatibility. Account linking
  or future login federation require explicit later admission; direct reuse of
  MediaWiki cookies or password hashes is prohibited.
- The legacy Wiki entry in hub is an external link to `muc.wiki`; it is not an
  internal hub app slug that implies shared session state.
- The legacy Wiki entry does not import, mirror, proxy or re-serve MediaWiki
  pages or uploaded media.

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
