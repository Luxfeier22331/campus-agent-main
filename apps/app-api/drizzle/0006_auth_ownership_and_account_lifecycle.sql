CREATE TABLE IF NOT EXISTS "app_auth"."user" (
	"banExpires" timestamp with time zone,
	"banReason" text,
	"banned" boolean DEFAULT false NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"emailVerified" boolean DEFAULT false NOT NULL,
	"image" text,
	"passwordChangeRequired" boolean DEFAULT false NOT NULL,
	"role" text DEFAULT 'user',
	"temporaryPasswordExpiresAt" timestamp with time zone,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_auth"."session" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"userId" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"impersonatedBy" text,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_auth"."account" (
	"id" text PRIMARY KEY NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"userId" text NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamp with time zone,
	"refreshTokenExpiresAt" timestamp with time zone,
	"scope" text,
	"password" text,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_auth"."verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_auth"."rateLimit" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"lastRequest" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_auth"."jwks" (
	"id" text PRIMARY KEY NOT NULL,
	"publicKey" text NOT NULL,
	"privateKey" text NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"expiresAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_auth"."oauthClient" (
	"id" text PRIMARY KEY NOT NULL,
	"clientId" text NOT NULL,
	"clientSecret" text,
	"disabled" boolean DEFAULT false,
	"skipConsent" boolean,
	"enableEndSession" boolean,
	"subjectType" text,
	"scopes" jsonb,
	"userId" text,
	"createdAt" timestamp with time zone,
	"updatedAt" timestamp with time zone,
	"name" text,
	"uri" text,
	"icon" text,
	"contacts" jsonb,
	"tos" text,
	"policy" text,
	"softwareId" text,
	"softwareVersion" text,
	"softwareStatement" text,
	"redirectUris" jsonb NOT NULL,
	"postLogoutRedirectUris" jsonb,
	"tokenEndpointAuthMethod" text,
	"grantTypes" jsonb,
	"responseTypes" jsonb,
	"public" boolean,
	"type" text,
	"requirePKCE" boolean,
	"referenceId" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_auth"."oauthRefreshToken" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"clientId" text NOT NULL,
	"sessionId" text,
	"userId" text NOT NULL,
	"referenceId" text,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"revoked" timestamp with time zone,
	"authTime" timestamp with time zone,
	"scopes" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_auth"."oauthAccessToken" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"clientId" text NOT NULL,
	"sessionId" text,
	"userId" text,
	"referenceId" text,
	"refreshId" text,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"scopes" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_auth"."oauthConsent" (
	"id" text PRIMARY KEY NOT NULL,
	"clientId" text NOT NULL,
	"userId" text,
	"referenceId" text,
	"scopes" jsonb NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_auth"."user" ADD COLUMN IF NOT EXISTS "passwordChangeRequired" boolean;
--> statement-breakpoint
ALTER TABLE "app_auth"."user" ADD COLUMN IF NOT EXISTS "temporaryPasswordExpiresAt" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "app_auth"."session" ADD COLUMN IF NOT EXISTS "impersonatedBy" text;
--> statement-breakpoint
UPDATE "app_auth"."user"
SET "role" = 'user'
WHERE "role" IS NULL;
--> statement-breakpoint
UPDATE "app_auth"."user"
SET "banned" = false
WHERE "banned" IS NULL;
--> statement-breakpoint
UPDATE "app_auth"."user"
SET "passwordChangeRequired" = false
WHERE "passwordChangeRequired" IS NULL;
--> statement-breakpoint
ALTER TABLE "app_auth"."user" ALTER COLUMN "emailVerified" SET DEFAULT false;
--> statement-breakpoint
ALTER TABLE "app_auth"."user" ALTER COLUMN "banned" SET DEFAULT false;
--> statement-breakpoint
ALTER TABLE "app_auth"."user" ALTER COLUMN "banned" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "app_auth"."user" ALTER COLUMN "role" SET DEFAULT 'user';
--> statement-breakpoint
ALTER TABLE "app_auth"."user" ALTER COLUMN "passwordChangeRequired" SET DEFAULT false;
--> statement-breakpoint
ALTER TABLE "app_auth"."user" ALTER COLUMN "passwordChangeRequired" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "app_auth"."user" ALTER COLUMN "createdAt" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "app_auth"."user" ALTER COLUMN "updatedAt" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "app_auth"."session" ALTER COLUMN "createdAt" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "app_auth"."account" ALTER COLUMN "createdAt" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "app_auth"."verification" ALTER COLUMN "createdAt" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "app_auth"."verification" ALTER COLUMN "updatedAt" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "app_auth"."user" DROP CONSTRAINT IF EXISTS "user_email_key";
--> statement-breakpoint
ALTER TABLE "app_auth"."session" DROP CONSTRAINT IF EXISTS "session_token_key";
--> statement-breakpoint
ALTER TABLE "app_auth"."account" DROP CONSTRAINT IF EXISTS "account_userId_fkey";
--> statement-breakpoint
ALTER TABLE "app_auth"."oauthClient" DROP CONSTRAINT IF EXISTS "oauthClient_clientId_key";
--> statement-breakpoint
ALTER TABLE "app_auth"."oauthClient" DROP CONSTRAINT IF EXISTS "oauthClient_userId_fkey";
--> statement-breakpoint
ALTER TABLE "app_auth"."oauthRefreshToken" DROP CONSTRAINT IF EXISTS "oauthRefreshToken_token_key";
--> statement-breakpoint
ALTER TABLE "app_auth"."oauthRefreshToken" DROP CONSTRAINT IF EXISTS "oauthRefreshToken_clientId_fkey";
--> statement-breakpoint
ALTER TABLE "app_auth"."oauthRefreshToken" DROP CONSTRAINT IF EXISTS "oauthRefreshToken_sessionId_fkey";
--> statement-breakpoint
ALTER TABLE "app_auth"."oauthRefreshToken" DROP CONSTRAINT IF EXISTS "oauthRefreshToken_userId_fkey";
--> statement-breakpoint
ALTER TABLE "app_auth"."oauthAccessToken" DROP CONSTRAINT IF EXISTS "oauthAccessToken_token_key";
--> statement-breakpoint
ALTER TABLE "app_auth"."oauthAccessToken" DROP CONSTRAINT IF EXISTS "oauthAccessToken_clientId_fkey";
--> statement-breakpoint
ALTER TABLE "app_auth"."oauthAccessToken" DROP CONSTRAINT IF EXISTS "oauthAccessToken_sessionId_fkey";
--> statement-breakpoint
ALTER TABLE "app_auth"."oauthAccessToken" DROP CONSTRAINT IF EXISTS "oauthAccessToken_userId_fkey";
--> statement-breakpoint
ALTER TABLE "app_auth"."oauthAccessToken" DROP CONSTRAINT IF EXISTS "oauthAccessToken_refreshId_fkey";
--> statement-breakpoint
ALTER TABLE "app_auth"."oauthConsent" DROP CONSTRAINT IF EXISTS "oauthConsent_clientId_fkey";
--> statement-breakpoint
ALTER TABLE "app_auth"."oauthConsent" DROP CONSTRAINT IF EXISTS "oauthConsent_userId_fkey";
--> statement-breakpoint
CREATE UNIQUE INDEX "oauthClient_clientId_uidx" ON "app_auth"."oauthClient" USING btree ("clientId");
--> statement-breakpoint
ALTER TABLE "app_auth"."account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "app_auth"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app_auth"."oauthClient" ADD CONSTRAINT "oauthClient_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "app_auth"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app_auth"."oauthRefreshToken" ADD CONSTRAINT "oauthRefreshToken_clientId_oauthClient_clientId_fk" FOREIGN KEY ("clientId") REFERENCES "app_auth"."oauthClient"("clientId") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app_auth"."oauthRefreshToken" ADD CONSTRAINT "oauthRefreshToken_sessionId_session_id_fk" FOREIGN KEY ("sessionId") REFERENCES "app_auth"."session"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app_auth"."oauthRefreshToken" ADD CONSTRAINT "oauthRefreshToken_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "app_auth"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app_auth"."oauthAccessToken" ADD CONSTRAINT "oauthAccessToken_clientId_oauthClient_clientId_fk" FOREIGN KEY ("clientId") REFERENCES "app_auth"."oauthClient"("clientId") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app_auth"."oauthAccessToken" ADD CONSTRAINT "oauthAccessToken_sessionId_session_id_fk" FOREIGN KEY ("sessionId") REFERENCES "app_auth"."session"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app_auth"."oauthAccessToken" ADD CONSTRAINT "oauthAccessToken_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "app_auth"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app_auth"."oauthAccessToken" ADD CONSTRAINT "oauthAccessToken_refreshId_oauthRefreshToken_id_fk" FOREIGN KEY ("refreshId") REFERENCES "app_auth"."oauthRefreshToken"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app_auth"."oauthConsent" ADD CONSTRAINT "oauthConsent_clientId_oauthClient_clientId_fk" FOREIGN KEY ("clientId") REFERENCES "app_auth"."oauthClient"("clientId") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app_auth"."oauthConsent" ADD CONSTRAINT "oauthConsent_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "app_auth"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app_auth"."session" DROP CONSTRAINT IF EXISTS "session_userId_fkey";
--> statement-breakpoint
ALTER TABLE "app_auth"."session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "app_auth"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
DROP INDEX IF EXISTS "app_auth"."session_userId_idx";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_userId_idx" ON "app_auth"."account" USING btree ("userId");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "oauthAccessToken_token_uidx" ON "app_auth"."oauthAccessToken" USING btree ("token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauthAccessToken_clientId_idx" ON "app_auth"."oauthAccessToken" USING btree ("clientId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauthAccessToken_sessionId_idx" ON "app_auth"."oauthAccessToken" USING btree ("sessionId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauthAccessToken_userId_idx" ON "app_auth"."oauthAccessToken" USING btree ("userId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauthAccessToken_refreshId_idx" ON "app_auth"."oauthAccessToken" USING btree ("refreshId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauthClient_userId_idx" ON "app_auth"."oauthClient" USING btree ("userId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauthConsent_clientId_idx" ON "app_auth"."oauthConsent" USING btree ("clientId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauthConsent_userId_idx" ON "app_auth"."oauthConsent" USING btree ("userId");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "oauthRefreshToken_token_uidx" ON "app_auth"."oauthRefreshToken" USING btree ("token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauthRefreshToken_clientId_idx" ON "app_auth"."oauthRefreshToken" USING btree ("clientId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauthRefreshToken_sessionId_idx" ON "app_auth"."oauthRefreshToken" USING btree ("sessionId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauthRefreshToken_userId_idx" ON "app_auth"."oauthRefreshToken" USING btree ("userId");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "session_token_uidx" ON "app_auth"."session" USING btree ("token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_user_id_expires_at_idx" ON "app_auth"."session" USING btree ("userId","expiresAt");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_banned_idx" ON "app_auth"."user" USING btree ("banned");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_created_at_id_idx" ON "app_auth"."user" USING btree ("createdAt" DESC NULLS LAST,"id" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_email_prefix_idx" ON "app_auth"."user" USING btree (lower("email") text_pattern_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_email_uidx" ON "app_auth"."user" USING btree ("email");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_name_prefix_idx" ON "app_auth"."user" USING btree (lower("name") text_pattern_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "app_auth"."verification" USING btree ("identifier");
--> statement-breakpoint
CREATE TABLE "app_auth"."account_admin_event" (
	"action" text NOT NULL,
	"actor_id" text NOT NULL,
	"error_code" text,
	"event_id" text PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"outcome" text NOT NULL,
	"reason" text,
	"request_fingerprint" text NOT NULL,
	"target_user_id" text,
	CONSTRAINT "account_admin_event_outcome_check" CHECK ("app_auth"."account_admin_event"."outcome" in ('started', 'succeeded', 'failed', 'indeterminate'))
);
--> statement-breakpoint
CREATE TABLE "app_auth"."email_access_grant" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"kind" text NOT NULL,
	"environment" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"user_id" text,
	"claim_expires_at" timestamp with time zone NOT NULL,
	"access_expires_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	"revoked_by" text,
	"revoked_at" timestamp with time zone,
	"last_invitation_sent_at" timestamp with time zone,
	CONSTRAINT "email_access_grant_kind_check" CHECK ("app_auth"."email_access_grant"."kind" in ('invitation', 'test')),
	CONSTRAINT "email_access_grant_environment_check" CHECK ("app_auth"."email_access_grant"."environment" in ('development', 'test', 'staging', 'production')),
	CONSTRAINT "email_access_grant_state_check" CHECK ("app_auth"."email_access_grant"."state" in ('pending', 'active', 'revoked', 'expired')),
	CONSTRAINT "email_access_grant_test_boundary_check" CHECK ("app_auth"."email_access_grant"."kind" <> 'test' or ("app_auth"."email_access_grant"."environment" <> 'production' and "app_auth"."email_access_grant"."access_expires_at" is not null)),
	CONSTRAINT "email_access_grant_state_shape_check" CHECK (("app_auth"."email_access_grant"."state" = 'pending' and "app_auth"."email_access_grant"."user_id" is null and "app_auth"."email_access_grant"."claimed_at" is null and "app_auth"."email_access_grant"."revoked_at" is null)
				or ("app_auth"."email_access_grant"."state" = 'active' and "app_auth"."email_access_grant"."user_id" is not null and "app_auth"."email_access_grant"."claimed_at" is not null and "app_auth"."email_access_grant"."revoked_at" is null)
				or ("app_auth"."email_access_grant"."state" = 'revoked' and "app_auth"."email_access_grant"."revoked_at" is not null)
				or "app_auth"."email_access_grant"."state" = 'expired')
);
--> statement-breakpoint
CREATE TABLE "app_auth"."email_access_grant_event" (
	"id" text PRIMARY KEY NOT NULL,
	"grant_id" text NOT NULL,
	"action" text NOT NULL,
	"actor_id" text NOT NULL,
	"idempotency_key" text,
	"payload_hash" text,
	"outcome" text NOT NULL,
	"error_code" text,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "email_access_grant_event_action_check" CHECK ("app_auth"."email_access_grant_event"."action" in ('created', 'invitation_sent', 'claimed', 'revoked', 'expired')),
	CONSTRAINT "email_access_grant_event_outcome_check" CHECK ("app_auth"."email_access_grant_event"."outcome" in ('started', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "profile"."account_deletion_requests" (
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"request_id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_error_code" text,
	"lease_expires_at" timestamp with time zone,
	"lease_token" text,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "profile_account_deletion_owner_status_check" CHECK (("profile"."account_deletion_requests"."status" = 'pending' and "profile"."account_deletion_requests"."owner_user_id" is not null)
				or ("profile"."account_deletion_requests"."status" = 'completed' and "profile"."account_deletion_requests"."owner_user_id" is null)),
	CONSTRAINT "profile_account_deletion_lease_shape_check" CHECK (("profile"."account_deletion_requests"."lease_token" is null and "profile"."account_deletion_requests"."lease_expires_at" is null)
				or ("profile"."account_deletion_requests"."lease_token" is not null and "profile"."account_deletion_requests"."lease_expires_at" is not null and "profile"."account_deletion_requests"."status" = 'pending')),
	CONSTRAINT "profile_account_deletion_status_check" CHECK ("profile"."account_deletion_requests"."status" in ('pending', 'completed'))
);
--> statement-breakpoint
ALTER TABLE "app_auth"."account_admin_event" ADD CONSTRAINT "account_admin_event_target_user_id_user_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "app_auth"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app_auth"."email_access_grant" ADD CONSTRAINT "email_access_grant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app_auth"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app_auth"."email_access_grant_event" ADD CONSTRAINT "email_access_grant_event_grant_id_email_access_grant_id_fk" FOREIGN KEY ("grant_id") REFERENCES "app_auth"."email_access_grant"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "account_admin_event_actor_occurred_idx" ON "app_auth"."account_admin_event" USING btree ("actor_id","occurred_at");
--> statement-breakpoint
CREATE INDEX "account_admin_event_action_occurred_idx" ON "app_auth"."account_admin_event" USING btree ("action","occurred_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "account_admin_event_actor_idempotency_uidx" ON "app_auth"."account_admin_event" USING btree ("actor_id","idempotency_key");
--> statement-breakpoint
CREATE INDEX "account_admin_event_outcome_occurred_idx" ON "app_auth"."account_admin_event" USING btree ("outcome","occurred_at");
--> statement-breakpoint
CREATE INDEX "account_admin_event_occurred_idx" ON "app_auth"."account_admin_event" USING btree ("occurred_at","event_id");
--> statement-breakpoint
CREATE INDEX "account_admin_event_target_occurred_idx" ON "app_auth"."account_admin_event" USING btree ("target_user_id","occurred_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "email_access_grant_live_email_uidx" ON "app_auth"."email_access_grant" USING btree ("environment","email") WHERE "app_auth"."email_access_grant"."state" in ('pending', 'active');
--> statement-breakpoint
CREATE INDEX "email_access_grant_environment_state_idx" ON "app_auth"."email_access_grant" USING btree ("environment","state","updated_at");
--> statement-breakpoint
CREATE INDEX "email_access_grant_user_id_idx" ON "app_auth"."email_access_grant" USING btree ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "email_access_grant_event_idempotency_uidx" ON "app_auth"."email_access_grant_event" USING btree ("actor_id","idempotency_key");
--> statement-breakpoint
CREATE INDEX "email_access_grant_event_grant_occurred_idx" ON "app_auth"."email_access_grant_event" USING btree ("grant_id","occurred_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "profile_account_deletion_owner_uidx" ON "profile"."account_deletion_requests" USING btree ("owner_user_id");
--> statement-breakpoint
CREATE INDEX "profile_account_deletion_status_updated_idx" ON "profile"."account_deletion_requests" USING btree ("status","updated_at");
--> statement-breakpoint
CREATE INDEX "profile_account_deletion_pending_lease_idx" ON "profile"."account_deletion_requests" USING btree ("status","next_attempt_at","lease_expires_at");
