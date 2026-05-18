---
doc_type: requirements
status: active
created: 2026-05-02
updated: 2026-05-02
---

# Requirements: Hub Product Entry And Legacy Wiki Identity

## Objective

Create a new product hub surface at `hub.muc.wiki/[slug]` for the campus-agent
app set, while preserving the existing `muc.wiki` MediaWiki service and
designing a controlled compatibility path for the legacy MediaWiki user system.
MediaWiki page content and uploaded media remain owned and served by the
existing `muc.wiki` deployment.

## Goals

- Establish `hub.muc.wiki/[slug]` as the flat app entry model:
  - `/`
  - `/account`
  - `/account/login`
  - `/account/register`
  - `/account/forgot-password`
  - `/account/reset-password`
  - `/chat`
  - `/docs`
  - `/map`
  - `/services`
  - `/notices`
  - `/panel`
  - external legacy Wiki card linking to `https://muc.wiki`
- Move public account shell ownership from chat-local product framing into the
  hub product shell, without moving canonical auth truth out of `apps/app-api`.
- Keep `muc.wiki` MediaWiki operational as a sibling legacy service.
- Decide and document MediaWiki account compatibility:
  - external-link-only as the initial posture
  - optional legacy account linking if explicitly admitted
  - optional future login federation / SSO if explicitly admitted
- Keep app-api as the only canonical product-layer identity/session/principal
  owner for the new app set.
- Prevent MediaWiki session cookies, user tables or password hashes from becoming
  supervisor/agent/retrieval identity truth.

## Non-Goals

- No replacement of `muc.wiki` MediaWiki.
- No migration of MediaWiki page content.
- No migration of MediaWiki uploaded media.
- No mirroring, proxying or re-serving of MediaWiki pages or uploaded media from
  hub.
- No import of `/var/www/html/images` into repo object storage, ingestion or
  retrieval data-plane semantics.
- No direct import of MediaWiki password hashes into Better Auth.
- No MediaWiki account migration in this workstream.
- No direct app-api trust in MediaWiki cookies or sessions.
- No supervisor-api or agent ownership of end-user auth.
- No opening of unfinished product capabilities just because hub exposes an
  entry card.
- No panel self-serve signup or password productization unless separately
  admitted.

## Functional Requirements

- Hub route namespace must be path-based under `hub.muc.wiki/[slug]`.
- `/` is the launcher/home route.
- `/:slug` is the app entry route family.
- `/wiki` is intentionally not a hub app slug; legacy Wiki is only an external
  card.
- The repo-owned hub surface is `apps/hub-web`; using another existing surface
  requires an explicit architecture decision before implementation.
- `apps/hub-web` runtime and build stack are fixed as Cloudflare Worker + Vite
  React SPA.
- Hub UI stack should reuse the public-facing React/Tailwind/Radix/lucide
  conventions already used by `apps/public-chat-web`.
- Hub browser routing is TanStack React Router. Changing router libraries
  requires an explicit architecture decision before Phase 3 implementation.
- Hub must not use Next.js, Rspress, React Admin, MUI panel shell or Cloudflare
  Pages as the default implementation substrate.
- Hub same-site API routes must be allowlisted one-by-one and call
  `apps/app-api` through Worker `APP_API` Service Binding. Public URLs such as
  `APP_API_BASE_URL` are not the product contract for Worker-to-Worker calls.
- Hub app launcher must show capability availability from a controlled manifest
  or app-api policy projection, not from UI-only claims.
- Account shell must consume app-api auth routes and `/api/me`.
- Existing public chat auth routes must either redirect to hub account routes or
  remain as compatibility shims during a bounded transition.
- Hub must expose `muc.wiki` as a legacy Wiki external link/card, not as an
  internal app slug that shares auth state by assumption.
- Hub must not use MediaWiki content or uploaded media as repo-owned app content.
- Identity compatibility must model MediaWiki account linkage as external
  identity metadata, not canonical app principal truth.
- Any future login federation / SSO must use an explicit federation protocol or
  MediaWiki auth extension, with app-api/hub as the preferred new product
  identity owner.
- The workstream must inventory current MediaWiki authentication plugins,
  username/email constraints, existing account count, and cookie/session names
  before implementing any federation or account-linking runtime.
- `hub.muc.wiki` auth cookies must not collide with MediaWiki cookies. Cookie
  domain, name prefix and SameSite posture must be documented before Phase 4.
- `hub.muc.wiki/[slug]` must not mount unknown slugs to app-api by default;
  unsupported slugs fail closed to a controlled not-found page.
- Hub Worker routes are limited to static asset delivery, SPA route fallback and
  narrow allowlisted same-site API seams to app-api.
- Phase 3 starts with a repo-owned typed static app launcher manifest. App-api
  policy projection is a later enhancement, not a Phase 3 blocker.
- Hub app launcher manifest fields are:
  - `slug`
  - `label`
  - `href`
  - `state`
  - `auth_required`
  - `external`
  - `capability_key`
- Initial entry states are:
  - `/account`: `available`
  - `/chat`: `available`
  - `/docs`: `available`
  - `/panel`: `gated`
  - `/map`: `preview`
  - `/services`: `preview`
  - `/notices`: `preview`
  - legacy Wiki external card: `external_legacy`
- Hub account routes are:
  - `/account`
  - `/account/login`
  - `/account/register`
  - `/account/forgot-password`
  - `/account/reset-password`
- Public-chat auth routes remain as bounded redirects or compatibility shims
  during migration. They should redirect to hub account routes with explicit
  `return_to` handling rather than relying on cross-subdomain cookie sharing.
- Hub auth cookie posture is:
  - scoped to `hub.muc.wiki`
  - no `.muc.wiki` cross-subdomain auth cookie by default
  - no shared cookie domain/name/session with MediaWiki
  - `Secure`
  - `HttpOnly` for server auth cookies
  - `SameSite=Lax`

## Success Criteria

- Architecture docs distinguish `muc.wiki` legacy MediaWiki from
  `hub.muc.wiki/[slug]` product hub.
- `apps/hub-web` has an explicit boundary and does not duplicate app-api auth
  backend.
- `apps/hub-web` technology choice is frozen as Worker + Vite React SPA and is
  aligned with existing public Worker surfaces.
- Public account shell routes are defined under hub.
- Chat/docs/map/services/notices/panel entry states are controlled and do not
  overstate unopened capabilities.
- Launcher manifest, route behavior and account redirect policy are frozen
  before implementation.
- MediaWiki identity strategy is frozen as compatibility-first, while content
  and media migration remain explicitly out of scope.
- The initial MediaWiki runtime posture is external-link-only unless a later
  phase explicitly admits account-link metadata or login federation.
- Focused tests cover app launcher policy, account shell redirect behavior and
  no direct supervisor/agent identity leakage.
- Phase 2 produces a concrete compatibility decision before Phase 6 implements
  linkage runtime.

## External References

- MediaWiki AuthManager / SessionManager supports multiple authentication
  mechanisms and federated login:
  <https://www.mediawiki.org/wiki/Manual:SessionManager_and_AuthManager>
- MediaWiki PluggableAuth supports external identity providers through
  extensions including OpenID Connect, SAML and JWTAuth:
  <https://www.mediawiki.org/wiki/Extension:PluggableAuth>
- MediaWiki OpenID Connect extension integrates through PluggableAuth:
  <https://www.mediawiki.org/wiki/Extension:OpenID_Connect>
- Better Auth OAuth Provider can expose OAuth/OIDC-style provider flows for
  trusted clients:
  <https://www.better-auth.com/docs/plugins/oauth-provider>
- Cloudflare Workers Vite plugin supports Worker applications with Vite-based
  development/build flow:
  <https://developers.cloudflare.com/workers/vite-plugin/>
- Cloudflare Service Bindings provide Worker-to-Worker calls without using the
  public internet as the service contract:
  <https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/>
- Cloudflare Workers static assets support SPA routing behavior:
  <https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/>
