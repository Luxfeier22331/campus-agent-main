---
created: 2026-05-07T16:23:31+08:00
title: Batch Cloudflare operator prereqs for hub and public surfaces
area: planning
files:
  - apps/hub-web/scripts/verify-staging-config.mjs
  - apps/hub-web/scripts/deploy-staging.mjs
  - docs/environment/provider-and-secret-inventory.md
  - docs/runbooks/staging-worker-deploy-runbook.md
---

## Problem

`hub-web` staging preflight is currently blocked by missing external Cloudflare
operator configuration, specifically a real Turnstile widget site key admitted
for `hub-muc-wiki.ayafeed.com` now, and later for the final `hub.muc.wiki`
hostname. This should not be handled as an ad hoc one-off ask to the `muc.wiki`
domain owner every time a surface is ready. The real gap is that repo rollout
still lacks a single batched operator checklist covering Cloudflare-managed
prerequisites across hub and other public browser surfaces.

The request should also be framed correctly: Turnstile does not require zone
ownership of `muc.wiki`; it requires a Cloudflare account operator to create or
manage a widget whose hostname allowlist includes the active hub hostname, plus
the corresponding runtime values to be handed back to campus-agent operators.

## Solution

Create a repo-owned external-operator backlog item and later execute it as one
batched request. The batched checklist should include at least:

- Turnstile widget provisioning for `hub-muc-wiki.ayafeed.com`
- later Turnstile widget/domain provisioning for `hub.muc.wiki`
- confirmation of the exact staging site key returned to campus-agent operators
- any matching `app-api` secret-side Turnstile prerequisites if hub auth rollout
  still depends on them
- any remaining staging publish prerequisites for public browser surfaces that
  currently require Cloudflare dashboard/operator action rather than repo code

Deliverables for the later closeout:

- a single human-forwardable operator request template
- a normalized inventory of per-surface Cloudflare prerequisites
- runbook updates so future staging/prod rollouts do not rediscover the same
  external dependency piecemeal
