CREATE TABLE "identity"."access_snapshots" (
    "snapshot_id" text PRIMARY KEY NOT NULL,
    "account_id" text NOT NULL,
    "principal_id" text NOT NULL,
    "entitlement_groups_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "available_apps_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "permissions_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "restricted_surfaces_ready" boolean DEFAULT false NOT NULL,
    "policy_projection_version" text NOT NULL,
    "created_at" timestamp with time zone NOT NULL,
    "expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "identity"."accounts" (
    "account_id" text PRIMARY KEY NOT NULL,
    "primary_email" text NOT NULL,
    "display_name" text NOT NULL,
    "status" text NOT NULL,
    "created_at" timestamp with time zone NOT NULL,
    "updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."federation_claims_policies" (
    "claims_policy_id" text PRIMARY KEY NOT NULL,
    "allowed_scopes_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "allowed_claims_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "campus_claim_namespace_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."federation_clients" (
    "client_id" text PRIMARY KEY NOT NULL,
    "client_type" text NOT NULL,
    "client_name" text NOT NULL,
    "redirect_uris_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "post_logout_redirect_uris_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "allowed_scopes_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "claims_policy_id" text NOT NULL,
    "consent_policy" text NOT NULL,
    "enabled" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone NOT NULL,
    "updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."federation_user_grants" (
    "grant_id" text PRIMARY KEY NOT NULL,
    "account_id" text NOT NULL,
    "client_id" text NOT NULL,
    "granted_scopes_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "grant_state" text NOT NULL,
    "created_at" timestamp with time zone NOT NULL,
    "revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "identity"."preference_settings" (
    "account_id" text PRIMARY KEY NOT NULL,
    "profile_memory_enabled" boolean DEFAULT true NOT NULL,
    "ui_preferences_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."identity_profiles" (
    "account_id" text PRIMARY KEY NOT NULL,
    "principal_id" text NOT NULL,
    "principal_type" text NOT NULL,
    "verification_status" text NOT NULL,
    "claims_version" text NOT NULL,
    "campus_attributes_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "verified_at" timestamp with time zone,
    "expires_at" timestamp with time zone,
    "updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "identity_access_snapshots_account_created_at_idx"
ON "identity"."access_snapshots" USING btree (
    "account_id", "created_at"
);
--> statement-breakpoint
CREATE INDEX "identity_access_snapshots_principal_idx"
ON "identity"."access_snapshots" USING btree (
    "principal_id"
);
--> statement-breakpoint
CREATE INDEX "identity_accounts_primary_email_idx" ON "identity"."accounts" USING btree (
    "primary_email"
);
--> statement-breakpoint
CREATE INDEX "identity_accounts_status_idx" ON "identity"."accounts" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "identity_federation_clients_enabled_idx"
ON "identity"."federation_clients" USING btree (
    "enabled"
);
--> statement-breakpoint
CREATE INDEX "identity_federation_clients_claims_policy_idx"
ON "identity"."federation_clients" USING btree (
    "claims_policy_id"
);
--> statement-breakpoint
CREATE INDEX "identity_federation_user_grants_account_client_idx"
ON "identity"."federation_user_grants" USING btree (
    "account_id", "client_id"
);
--> statement-breakpoint
CREATE INDEX "identity_federation_user_grants_client_idx"
ON "identity"."federation_user_grants" USING btree (
    "client_id"
);
--> statement-breakpoint
CREATE INDEX "identity_profiles_principal_idx" ON "identity"."identity_profiles" USING btree (
    "principal_id"
);
CREATE INDEX "identity_profiles_verification_status_idx"
ON "identity"."identity_profiles" USING btree (
    "verification_status"
);
