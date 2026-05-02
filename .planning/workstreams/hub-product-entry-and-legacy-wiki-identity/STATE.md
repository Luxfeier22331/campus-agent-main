---
doc_type: state
workstream: hub-product-entry-and-legacy-wiki-identity
status: active
created: 2026-05-02
updated: 2026-05-02
---

# Project State

## Current Position

**Status:** Active
**Current Phase:** Phase 1
**Current Phase Name:** Product Hub Boundary And IA Freeze
**Current Plan:** `./phases/phase-01-product-hub-boundary-and-ia-freeze/PLAN.md`
**Total Phases:** 8
**Progress:** 0/8 phases complete
**Last Activity:** 2026-05-02
**Last Activity Description:** Reviewed and tightened workstream scope after
live MediaWiki read-only inventory; initial MediaWiki posture is
external-link-only, and content/uploaded-media/account migration are explicitly
out of scope.

## Current Slice

The next step is Phase 1 execution:

- confirm route namespace and app launcher IA
- freeze `muc.wiki` as legacy MediaWiki sibling service
- define hub account shell ownership
- identify architecture docs to update before implementation
- decide whether `hub.muc.wiki/wiki` is intentionally omitted in favor of an
  external `muc.wiki` card
- keep legacy Wiki page content and uploaded media outside hub scope

## Key Decisions Already Assumed

- `hub.muc.wiki/[slug]` is path-based.
- `muc.wiki` is an existing MediaWiki service and is not replaced by this
  workstream.
- Existing MediaWiki page content and uploaded media remain in the legacy
  `muc.wiki` service.
- Existing MediaWiki user system must be considered for compatibility.
- New campus-agent app-set canonical identity remains app-api-owned.
- Initial MediaWiki runtime posture is external-link-only.
- Account-link metadata and login federation are later candidates, not default
  runtime behavior.
- Direct password migration and account migration are out of scope for this
  workstream.
- MediaWiki local upload storage is legacy service implementation detail, not
  repo object-storage, ingestion or retrieval truth.
- Phase 6 linkage runtime may only proceed if Phase 2 explicitly admits
  account-link metadata; otherwise Phase 6 records a no-op/defer decision.

## MediaWiki Live Inventory Snapshot

Read-only inspection through Windows OpenSSH alias `wiki` on 2026-05-02 found:

- host: `vultr.guest`
- live root: `/var/www/html`
- sibling candidate directory: `/var/www/mw142`
- public site: `https://muc.wiki`
- MediaWiki version: `1.36.1`
- web stack: nginx `1.22.1`, PHP-FPM `7.4`, MariaDB `10.3`
- auth posture: native MediaWiki account system; no enabled OAuth, OIDC, LDAP,
  PluggableAuth or CentralAuth path observed in live config
- site scale: 82 pages, 37 articles, 112 users, 39 images
- upload storage: `/var/www/html/images`, about 429 MB

This inventory is only for identity compatibility planning. It is not a content
or media migration inventory.

## Blockers

- Need final decision during Phase 2 on whether MediaWiki compatibility remains
  external-link-only or admits account-link metadata planning.
- Need cookie domain/name/SameSite posture decision before relocating account
  shell routes to hub.
- Need Phase 7 decision before any MediaWiki login federation work.

## Verification Plan

Planning-level verification:

```bash
pnpm docs:lint
pnpm yaml:lint
git diff --check
```

Future implementation verification will include focused `hub-web`, `app-api`,
public-chat redirect and browser smoke lanes after Phase 3+.

## Session Continuity

**Stopped At:** Workstream reviewed; Phase 1 and Phase 2 plans tightened.
**Resume File:** `./phases/phase-01-product-hub-boundary-and-ia-freeze/PLAN.md`
