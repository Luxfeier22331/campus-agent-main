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
ALTER TABLE "app_auth"."account_admin_event" ADD CONSTRAINT "account_admin_event_target_user_id_user_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "app_auth"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_auth"."email_access_grant" ADD CONSTRAINT "email_access_grant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app_auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_auth"."email_access_grant_event" ADD CONSTRAINT "email_access_grant_event_grant_id_email_access_grant_id_fk" FOREIGN KEY ("grant_id") REFERENCES "app_auth"."email_access_grant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_admin_event_actor_occurred_idx" ON "app_auth"."account_admin_event" USING btree ("actor_id","occurred_at");--> statement-breakpoint
CREATE INDEX "account_admin_event_action_occurred_idx" ON "app_auth"."account_admin_event" USING btree ("action","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "account_admin_event_actor_idempotency_uidx" ON "app_auth"."account_admin_event" USING btree ("actor_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "account_admin_event_outcome_occurred_idx" ON "app_auth"."account_admin_event" USING btree ("outcome","occurred_at");--> statement-breakpoint
CREATE INDEX "account_admin_event_occurred_idx" ON "app_auth"."account_admin_event" USING btree ("occurred_at","event_id");--> statement-breakpoint
CREATE INDEX "account_admin_event_target_occurred_idx" ON "app_auth"."account_admin_event" USING btree ("target_user_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_access_grant_live_email_uidx" ON "app_auth"."email_access_grant" USING btree ("environment","email") WHERE "app_auth"."email_access_grant"."state" in ('pending', 'active');--> statement-breakpoint
CREATE INDEX "email_access_grant_environment_state_idx" ON "app_auth"."email_access_grant" USING btree ("environment","state","updated_at");--> statement-breakpoint
CREATE INDEX "email_access_grant_user_id_idx" ON "app_auth"."email_access_grant" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_access_grant_event_idempotency_uidx" ON "app_auth"."email_access_grant_event" USING btree ("actor_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "email_access_grant_event_grant_occurred_idx" ON "app_auth"."email_access_grant_event" USING btree ("grant_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "profile_account_deletion_owner_uidx" ON "profile"."account_deletion_requests" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "profile_account_deletion_status_updated_idx" ON "profile"."account_deletion_requests" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "profile_account_deletion_pending_lease_idx" ON "profile"."account_deletion_requests" USING btree ("status","next_attempt_at","lease_expires_at");
--> statement-breakpoint
CREATE INDEX "user_created_at_id_idx" ON "app_auth"."user" USING btree ("createdAt" DESC, "id" DESC);
--> statement-breakpoint
CREATE INDEX "user_email_prefix_idx" ON "app_auth"."user" USING btree (lower("email") text_pattern_ops);
--> statement-breakpoint
CREATE INDEX "user_name_prefix_idx" ON "app_auth"."user" USING btree (lower("name") text_pattern_ops);
--> statement-breakpoint
DROP INDEX IF EXISTS "app_auth"."session_userId_idx";
--> statement-breakpoint
CREATE INDEX "session_user_id_expires_at_idx" ON "app_auth"."session" USING btree ("userId", "expiresAt");
