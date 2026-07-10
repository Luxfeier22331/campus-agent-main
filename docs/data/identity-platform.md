---
doc_type: data
truth_scope: data
owner_boundary: apps/app-api
status: active
created: 2026-06-02
updated: 2026-06-03
---
# Identity Platform Schema

## 文档边界

本文冻结 MUC Wiki Identity Platform 的 logical data ownership。

它区分：

- auth runtime adapter tables
- app-owned identity product truth
- projection/read-model fields exposed to campus and other first-party surfaces
- federation client policy data

本文不替代 migration files、Better Auth adapter schema docs 或 physical table DDL。

Current implementation note:

- `apps/app-api/src/db/schema/identity.ts` is the first physical
  materialization of the app-owned `identity.*` schema family.
- `apps/app-api/drizzle/0000_current_baseline.sql` creates the current
  `identity.accounts`, `identity.identity_profiles`,
  `identity.access_snapshots`, `identity.preference_settings`,
  `identity.federation_clients`, `identity.federation_claims_policies` and
  `identity.federation_user_grants` tables.
- The first account-center projection may derive account/session fields from
  the resolved Better Auth principal and reads only profile memory summary from
  `profile.*`.
- `PATCH /api/me/preferences` is the first explicit identity materialization
  write path. It updates `profile.memory_settings` and, in the same app-owned
  write boundary, materializes `identity.accounts`,
  `identity.identity_profiles`, `identity.preference_settings` and
  `identity.access_snapshots`.
- Better Auth adapter rows and existing `profile.memory_items` are not migrated
  wholesale into `identity.*` in this batch.
- Federation runtime materializes the controlled `muc-wiki` client into
  `identity.federation_*` product policy tables and Better Auth-owned
  `app_auth.oauthClient` through app-api provision scripts.

## Schema Families

Long-term logical families:

- `app_auth.*`
  - auth runtime adapter tables currently owned by Better Auth
- `identity.account_*`
  - app-owned account lifecycle and product identity records
- `identity.identity_*`
  - verified campus identity and claims versions
- `identity.access_*`
  - entitlements, app availability and authorization projection snapshots
- `identity.preference_*`
  - user preferences and profile memory summary ownership
- `identity.federation_*`
  - client registry, claims policy, user grants and relying-party connections

The default physical schema name is `identity`. Changing it requires an ADR or
contract update; the ownership split must remain.

## Auth Runtime Adapter Tables

Current auth runtime tables live under `app_auth.*` and are Better Auth-owned.

Current logical set:

- `app_auth.user`
- `app_auth.session`
- `app_auth.account`
- `app_auth.verification`
- `app_auth.oauthClient`
- `app_auth.oauthRefreshToken`
- `app_auth.oauthAccessToken`
- `app_auth.oauthConsent`
- `app_auth.jwks`

Rules:

- Better Auth internal column shape is not the product account schema.
- App-domain migrations must not hand-edit Better Auth internal columns unless
  the adapter contract explicitly supports it.
- Runtime code may map Better Auth user/session into app-owned account/session
  projection.
- Product contracts must not expose raw Better Auth rows.

Better Auth OAuth/JWT tables remain runtime substrate. Federation product truth
is not read from these rows directly; the app-owned `identity.federation_*`
tables define client policy, allowed scopes, allowed claims and grant posture.

## `identity.accounts`

Purpose:

- canonical app-owned account lifecycle truth
- stable account identity independent of current session runtime

Minimum fields:

- `account_id`
- `primary_email`
- `display_name`
- `status`
- `created_at`
- `updated_at`

Allowed `status` values:

- `active`
- `suspended`
- `deleted`
- `pending_recovery`

Rules:

- `account_id` may initially match Better Auth user id, but product contracts
  refer to it as app-owned account id.
- Account status does not grant or deny restricted content by itself; access
  remains in entitlement/policy data.
- Deletion/suspension lifecycle must be reflected in session admission and
  federation token issuance.

## `identity.identity_profiles`

Purpose:

- verified campus identity and principal-class truth

Minimum fields:

- `account_id`
- `principal_id`
- `principal_type`
- `verification_status`
- `claims_version`
- `campus_attributes_json`
- `verified_at`
- `expires_at`
- `updated_at`

Allowed end-user `principal_type` values align with app-api campus end-user
principal projection:

- `campus_member`
- `student`
- `staff`
- `faculty`

`operator` and `service` remain valid app principal classes in the runtime, but
they must not be silently folded into ordinary end-user identity profile rows.

Allowed `verification_status` values:

- `unverified`
- `verified`
- `expired`
- `manual_review`

Rules:

- Better Auth sign-in alone does not write `verification_status=verified`.
- Campus attributes must come from accepted identity source, directory sync or
  entitlement snapshot.
- Operator and service identity must not be conflated with end-user campus
  identity.

## `identity.access_snapshots`

Purpose:

- compact app-owned access / entitlement projection snapshot

Minimum fields:

- `snapshot_id`
- `account_id`
- `principal_id`
- `entitlement_groups_json`
- `available_apps_json`
- `permissions_json`
- `restricted_surfaces_ready`
- `policy_projection_version`
- `created_at`
- `expires_at`

Rules:

- Snapshot rows are projection material, not the canonical policy store itself.
- Profile memory and preferences cannot mutate entitlement groups.
- Execution and retrieval receive compact projection, not raw policy store
  objects.

## `identity.preference_settings`

Purpose:

- account-level preferences not owned by auth runtime

Minimum fields:

- `account_id`
- `profile_memory_enabled`
- `ui_preferences_json`
- `updated_at`

Rules:

- Existing `profile.memory_settings` and `profile.memory_items` remain the
  current profile memory durable truth until an implementation explicitly
  migrates or aliases them.
- The current scoped preference mutation writes `profile.memory_settings` and
  mirrors the account-level preference into `identity.preference_settings` as
  Identity Platform product materialization.
- Preferences affect UX and personalization only.
- Preferences cannot grant access or alter federation claims by default.

## `identity.federation_clients`

Purpose:

- controlled relying-party client registry

Minimum fields:

- `client_id`
- `client_type`
- `client_name`
- `redirect_uris_json`
- `post_logout_redirect_uris_json`
- `allowed_scopes_json`
- `claims_policy_id`
- `consent_policy`
- `enabled`
- `created_at`
- `updated_at`

Rules:

- First implementation uses controlled/static client registration.
- The first `muc-wiki` client policy is materialized by
  `apps/app-api/ops/identity/provision-muc-wiki-federation-client.ts`.
- Browser shells and MediaWiki do not create, mutate or own federation client
  policy.
- Client secret values are secret material and must not be committed as schema
  fixture data or documentation examples.
- Dynamic public client registration is out of scope until a new ADR accepts it.

## `identity.federation_claims_policies`

Purpose:

- named policy for which claims each relying party may receive

Minimum fields:

- `claims_policy_id`
- `allowed_scopes_json`
- `allowed_claims_json`
- `campus_claim_namespace_json`
- `updated_at`

Rules:

- Raw entitlement snapshots, profile memory, chat history, operator secrets and
  service principal material must not be emitted as generic relying-party claims.
- Campus-specific claims must be namespaced.

## `identity.federation_user_grants`

Purpose:

- user-facing record of relying-party consent or trusted-client grant state

Minimum fields:

- `grant_id`
- `account_id`
- `client_id`
- `granted_scopes_json`
- `grant_state`
- `created_at`
- `revoked_at`

Rules:

- Grant state is not a substitute for client policy or account/session
  admission.
- Revoking a grant does not mutate MediaWiki-local account linking by itself.

## Relationship To Current `profile.*`

Current profile memory tables remain under `profile.*`. Identity Platform may
project a profile-memory enabled flag and count for account center UX, but it
must not duplicate or reinterpret profile memory values as identity, access or
federation truth.

## Related Documents

- `docs/decisions/adr-0045-identity-platform-and-auth-runtime-boundary.md`
- `docs/architecture/system/identity-platform.md`
- `docs/contracts/app-api/identity.md`
- `docs/contracts/app-api/federation.md`
