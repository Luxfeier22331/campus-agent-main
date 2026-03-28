CREATE SCHEMA IF NOT EXISTS "auth";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "chat";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "runtime";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "operator";
--> statement-breakpoint
CREATE TABLE "auth"."accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat"."conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat"."messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"role" text NOT NULL,
	"kind" text,
	"text" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"request_id" text,
	"retryable" boolean
);
--> statement-breakpoint
CREATE TABLE "runtime"."projection_outbox" (
	"event_id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "runtime"."request_execution" (
	"request_id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"user_message_id" text NOT NULL,
	"assistant_message_id" text,
	"surface" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_roles_json" jsonb NOT NULL,
	"actor_departments_json" jsonb NOT NULL,
	"actor_groups_json" jsonb NOT NULL,
	"actor_campus_scope" text,
	"actor_snapshot_json" jsonb NOT NULL,
	"idempotency_key" text,
	"request_fingerprint_sha256" text,
	"trace_id" text NOT NULL,
	"requested_capability" text,
	"requested_scope_json" jsonb,
	"selected_target" text,
	"status" text NOT NULL,
	"error_code" text,
	"question_preview" text NOT NULL,
	"answer_preview" text,
	"source_doc_ids_json" jsonb,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"duration_ms" integer,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator"."request_projection" (
	"request_id" text PRIMARY KEY NOT NULL,
	"trace_id" text NOT NULL,
	"surface" text NOT NULL,
	"conversation_id" text NOT NULL,
	"principal_type" text NOT NULL,
	"principal_id" text NOT NULL,
	"principal_label" text,
	"requested_capability" text,
	"requested_scope_json" jsonb,
	"selected_target" text,
	"status" text NOT NULL,
	"error_code" text,
	"question_preview" text NOT NULL,
	"answer_preview" text,
	"source_doc_ids_json" jsonb,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"duration_ms" integer,
	"projected_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth"."accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "chat"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_accounts_provider_account_idx" ON "auth"."accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_token_idx" ON "auth"."sessions" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_users_email_idx" ON "auth"."users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_verification_identifier_value_idx" ON "auth"."verification" USING btree ("identifier","value");--> statement-breakpoint
CREATE INDEX "chat_conversations_owner_updated_at_idx" ON "chat"."conversations" USING btree ("owner_user_id","updated_at");--> statement-breakpoint
CREATE INDEX "chat_messages_conversation_created_at_idx" ON "chat"."messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_messages_request_id_idx" ON "chat"."messages" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "runtime_projection_outbox_processed_available_idx" ON "runtime"."projection_outbox" USING btree ("processed_at","available_at");--> statement-breakpoint
CREATE INDEX "runtime_projection_outbox_request_occurred_idx" ON "runtime"."projection_outbox" USING btree ("request_id","occurred_at");--> statement-breakpoint
CREATE INDEX "runtime_request_execution_conversation_started_at_idx" ON "runtime"."request_execution" USING btree ("conversation_id","started_at");--> statement-breakpoint
CREATE INDEX "runtime_request_execution_status_started_at_idx" ON "runtime"."request_execution" USING btree ("status","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_request_execution_actor_idempotency_idx" ON "runtime"."request_execution" USING btree ("actor_user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "operator_request_projection_status_started_at_idx" ON "operator"."request_projection" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "operator_request_projection_conversation_started_at_idx" ON "operator"."request_projection" USING btree ("conversation_id","started_at");
