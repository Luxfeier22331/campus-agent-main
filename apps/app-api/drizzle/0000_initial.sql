CREATE SCHEMA IF NOT EXISTS "campus_services_ops";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "docs";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "identity";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "observability";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "profile";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "provider_config";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "runtime";
--> statement-breakpoint
CREATE TABLE "campus_services_ops"."audit_events" (
	"audit_event_id" text PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"object_type" text NOT NULL,
	"object_id" text NOT NULL,
	"summary" text NOT NULL,
	"before_json" jsonb,
	"after_json" jsonb,
	"actor_json" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campus_services_ops"."releases" (
	"release_id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"notes" text,
	"item_count" integer NOT NULL,
	"current_effective_json" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by_json" jsonb NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"published_by_json" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campus_services_ops"."source_attestations" (
	"attestation_id" text PRIMARY KEY NOT NULL,
	"source_type" text NOT NULL,
	"summary" text NOT NULL,
	"operator_notes" text,
	"confirmed_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by_json" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campus_services_ops"."transport_overrides" (
	"override_id" text PRIMARY KEY NOT NULL,
	"route_id" text NOT NULL,
	"display_name" text NOT NULL,
	"service_status" text NOT NULL,
	"message" text NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_until" timestamp with time zone NOT NULL,
	"source_attestation_ids_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"review_state" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by_json" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by_json" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "docs"."collections" (
	"collection" text NOT NULL,
	"corpus" text NOT NULL,
	"description" text,
	"display_name" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "collections_corpus_collection_pk" PRIMARY KEY("corpus","collection")
);
--> statement-breakpoint
CREATE TABLE "docs"."document_versions" (
	"delivery_mode" text DEFAULT 'gated_asset' NOT NULL,
	"doc_id" text NOT NULL,
	"effective_from" text,
	"entitlement_groups_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"label" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version_id" text PRIMARY KEY NOT NULL,
	"version_slug" text NOT NULL,
	"visibility_level" text DEFAULT 'restricted' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "docs"."documents" (
	"canonical_url" text NOT NULL,
	"collection" text NOT NULL,
	"corpus" text NOT NULL,
	"current_version_id" text NOT NULL,
	"current_version_slug" text NOT NULL,
	"doc_id" text PRIMARY KEY NOT NULL,
	"document_slug" text NOT NULL,
	"title" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "docs"."reader_assets" (
	"content_url" text NOT NULL,
	"manifest_url" text,
	"outline_url" text NOT NULL,
	"source_objects_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"static_prefix" text NOT NULL,
	"target_objects_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version_id" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "docs"."search_units" (
	"anchor" text NOT NULL,
	"canonical_url" text NOT NULL,
	"doc_id" text NOT NULL,
	"highlight_root_unit_ids_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"search_text" text NOT NULL,
	"search_unit_id" text PRIMARY KEY NOT NULL,
	"snippet" text NOT NULL,
	"title" text NOT NULL,
	"unit_order" integer NOT NULL,
	"version_id" text NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE "observability"."ops_observability_read_audit" (
	"audit_id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"operator_id" text NOT NULL,
	"operator_principal_class" text NOT NULL,
	"read_at" timestamp with time zone NOT NULL,
	"record_count" integer NOT NULL,
	"request_id" text NOT NULL,
	"trace_id" text NOT NULL,
	"truncated" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile"."memory_items" (
	"item_id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"key" text NOT NULL,
	"runtime_episode_uuid" text NOT NULL,
	"value" text NOT NULL,
	"source_type" text DEFAULT 'user_declared' NOT NULL,
	"confidence" text DEFAULT 'low' NOT NULL,
	"visibility" text DEFAULT 'user_visible' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"last_verified_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile"."memory_settings" (
	"owner_user_id" text PRIMARY KEY NOT NULL,
	"profile_memory_enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_config"."connections" (
	"connection_id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"base_url" text NOT NULL,
	"features_json" jsonb NOT NULL,
	"feature_config_json" jsonb NOT NULL,
	"api_key_secret_json" jsonb NOT NULL,
	"revision" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by_json" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by_json" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_config"."profiles" (
	"profile_id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"role" text NOT NULL,
	"connection_id" text NOT NULL,
	"provider" text,
	"transport" text NOT NULL,
	"base_url" text,
	"model" text NOT NULL,
	"dimensions" integer,
	"timeout_ms" integer NOT NULL,
	"api_key_secret_json" jsonb,
	"status" text NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"revision" integer NOT NULL,
	"validation_json" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"created_by_json" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by_json" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runtime"."request_observability_fact" (
	"request_id" text PRIMARY KEY NOT NULL,
	"trace_id" text NOT NULL,
	"safety_identifier" text,
	"conversation_id" text NOT NULL,
	"surface" text NOT NULL,
	"principal_type" text NOT NULL,
	"entitlement_snapshot_id" text,
	"policy_projection_version" text,
	"policy_reason" text,
	"requested_tool" text,
	"resolved_targets_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"selected_tool" text,
	"status" text NOT NULL,
	"error_code" text,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"duration_ms" integer,
	"supporting_sources_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"refusal_class" text,
	"semantic_outcome" text,
	"acl_decision" text,
	"acl_anomaly_code" text,
	"fail_closed" boolean,
	"workflow_trace_summary_json" jsonb,
	"stage_timing_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"model_provider" text,
	"model_name" text,
	"prompt_id" text,
	"prompt_version" text,
	"template_sha256" text,
	"trace_available" boolean DEFAULT false NOT NULL,
	"projection_lag_ms" integer,
	"measured_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "docs"."document_versions" ADD CONSTRAINT "document_versions_doc_id_documents_doc_id_fk" FOREIGN KEY ("doc_id") REFERENCES "docs"."documents"("doc_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs"."reader_assets" ADD CONSTRAINT "reader_assets_version_id_document_versions_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "docs"."document_versions"("version_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs"."search_units" ADD CONSTRAINT "search_units_doc_id_documents_doc_id_fk" FOREIGN KEY ("doc_id") REFERENCES "docs"."documents"("doc_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs"."search_units" ADD CONSTRAINT "search_units_version_id_document_versions_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "docs"."document_versions"("version_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_config"."profiles" ADD CONSTRAINT "provider_config_profiles_connection_id_connections_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "provider_config"."connections"("connection_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campus_services_ops_audit_action_occurred_idx" ON "campus_services_ops"."audit_events" USING btree ("action","occurred_at");--> statement-breakpoint
CREATE INDEX "campus_services_ops_audit_object_occurred_idx" ON "campus_services_ops"."audit_events" USING btree ("object_type","object_id","occurred_at");--> statement-breakpoint
CREATE INDEX "campus_services_ops_releases_published_at_idx" ON "campus_services_ops"."releases" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "campus_services_ops_attestations_confirmed_at_idx" ON "campus_services_ops"."source_attestations" USING btree ("confirmed_at");--> statement-breakpoint
CREATE INDEX "campus_services_ops_attestations_source_confirmed_idx" ON "campus_services_ops"."source_attestations" USING btree ("source_type","confirmed_at");--> statement-breakpoint
CREATE INDEX "campus_services_ops_transport_effective_window_idx" ON "campus_services_ops"."transport_overrides" USING btree ("effective_from","effective_until");--> statement-breakpoint
CREATE INDEX "campus_services_ops_transport_review_updated_idx" ON "campus_services_ops"."transport_overrides" USING btree ("review_state","updated_at");--> statement-breakpoint
CREATE INDEX "campus_services_ops_transport_route_updated_idx" ON "campus_services_ops"."transport_overrides" USING btree ("route_id","updated_at");--> statement-breakpoint
CREATE INDEX "docs_document_versions_doc_current_idx" ON "docs"."document_versions" USING btree ("doc_id","is_current");--> statement-breakpoint
CREATE UNIQUE INDEX "docs_document_versions_doc_slug_idx" ON "docs"."document_versions" USING btree ("doc_id","version_slug");--> statement-breakpoint
CREATE INDEX "docs_document_versions_delivery_visibility_idx" ON "docs"."document_versions" USING btree ("delivery_mode","visibility_level","is_current");--> statement-breakpoint
CREATE UNIQUE INDEX "docs_documents_collection_slug_idx" ON "docs"."documents" USING btree ("corpus","collection","document_slug");--> statement-breakpoint
CREATE INDEX "docs_documents_collection_title_idx" ON "docs"."documents" USING btree ("corpus","collection","title");--> statement-breakpoint
CREATE INDEX "docs_reader_assets_static_prefix_idx" ON "docs"."reader_assets" USING btree ("static_prefix");--> statement-breakpoint
CREATE INDEX "docs_search_units_doc_version_order_idx" ON "docs"."search_units" USING btree ("doc_id","version_id","unit_order");--> statement-breakpoint
CREATE INDEX "identity_access_snapshots_account_created_at_idx" ON "identity"."access_snapshots" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "identity_access_snapshots_principal_idx" ON "identity"."access_snapshots" USING btree ("principal_id");--> statement-breakpoint
CREATE INDEX "identity_accounts_primary_email_idx" ON "identity"."accounts" USING btree ("primary_email");--> statement-breakpoint
CREATE INDEX "identity_accounts_status_idx" ON "identity"."accounts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "identity_federation_clients_enabled_idx" ON "identity"."federation_clients" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "identity_federation_clients_claims_policy_idx" ON "identity"."federation_clients" USING btree ("claims_policy_id");--> statement-breakpoint
CREATE INDEX "identity_federation_user_grants_account_client_idx" ON "identity"."federation_user_grants" USING btree ("account_id","client_id");--> statement-breakpoint
CREATE INDEX "identity_federation_user_grants_client_idx" ON "identity"."federation_user_grants" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "identity_profiles_principal_idx" ON "identity"."identity_profiles" USING btree ("principal_id");--> statement-breakpoint
CREATE INDEX "identity_profiles_verification_status_idx" ON "identity"."identity_profiles" USING btree ("verification_status");--> statement-breakpoint
CREATE INDEX "observability_ops_read_at_idx" ON "observability"."ops_observability_read_audit" USING btree ("read_at");--> statement-breakpoint
CREATE INDEX "observability_ops_read_request_at_idx" ON "observability"."ops_observability_read_audit" USING btree ("request_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "profile_memory_items_owner_key_uidx" ON "profile"."memory_items" USING btree ("owner_user_id","key");--> statement-breakpoint
CREATE INDEX "profile_memory_items_owner_updated_at_idx" ON "profile"."memory_items" USING btree ("owner_user_id","updated_at");--> statement-breakpoint
CREATE INDEX "provider_config_connections_provider_updated_idx" ON "provider_config"."connections" USING btree ("provider","updated_at");--> statement-breakpoint
CREATE INDEX "provider_config_profiles_active_role_idx" ON "provider_config"."profiles" USING btree ("role","active","updated_at");--> statement-breakpoint
CREATE INDEX "provider_config_profiles_kind_role_updated_idx" ON "provider_config"."profiles" USING btree ("kind","role","updated_at");--> statement-breakpoint
CREATE INDEX "runtime_request_observability_started_at_idx" ON "runtime"."request_observability_fact" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "runtime_request_observability_status_started_at_idx" ON "runtime"."request_observability_fact" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "runtime_request_observability_surface_started_at_idx" ON "runtime"."request_observability_fact" USING btree ("surface","started_at");--> statement-breakpoint
CREATE INDEX "runtime_request_observability_selected_tool_started_at_idx" ON "runtime"."request_observability_fact" USING btree ("selected_tool","started_at");--> statement-breakpoint
CREATE INDEX "runtime_request_observability_principal_type_started_at_idx" ON "runtime"."request_observability_fact" USING btree ("principal_type","started_at");--> statement-breakpoint
CREATE INDEX "runtime_request_observability_model_name_started_at_idx" ON "runtime"."request_observability_fact" USING btree ("model_name","started_at");--> statement-breakpoint
CREATE INDEX "runtime_request_observability_safety_identifier_started_at_idx" ON "runtime"."request_observability_fact" USING btree ("safety_identifier","started_at");
