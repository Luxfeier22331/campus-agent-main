CREATE SCHEMA IF NOT EXISTS "campus_services_ops";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "dining";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "docs";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "identity";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "observability";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "observability_config";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "official_web";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "operator";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "profile";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "provider_config";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "runtime";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "wechat_official_account";
--> statement-breakpoint
CREATE TABLE "operator"."authenticated_notice_processing_event_projection" (
	"event_id" text PRIMARY KEY NOT NULL,
	"processing_id" text NOT NULL,
	"notice_key" text NOT NULL,
	"notice_id" text NOT NULL,
	"run_id" text,
	"job_id" text,
	"stage" text NOT NULL,
	"status" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"summary" text NOT NULL,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"projected_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator"."authenticated_notice_processing_projection" (
	"processing_id" text PRIMARY KEY NOT NULL,
	"notice_key" text NOT NULL,
	"source_channel" text NOT NULL,
	"source_surface" text NOT NULL,
	"site_id" text NOT NULL,
	"notice_id" text NOT NULL,
	"title" text NOT NULL,
	"run_id" text,
	"job_id" text,
	"replay_batch_id" text,
	"enqueue_source" text,
	"queue_status" text NOT NULL,
	"lifecycle_status" text NOT NULL,
	"latest_stage" text NOT NULL,
	"target_surface" text,
	"candidate_kind" text,
	"materialization_status" text,
	"release_id" text,
	"current" boolean DEFAULT false NOT NULL,
	"tool_ready" boolean DEFAULT false NOT NULL,
	"read_model_counts_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"child_task_summary_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"timeline_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"downstream_json" jsonb,
	"last_error_code" text,
	"last_error_message" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_observed_at" timestamp with time zone NOT NULL,
	"source_updated_at" timestamp with time zone,
	"projected_at" timestamp with time zone NOT NULL,
	"producer_version" text NOT NULL,
	"redaction_version" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator"."authenticated_notice_run_processing_event_projection" (
	"event_id" text PRIMARY KEY NOT NULL,
	"run_processing_id" text NOT NULL,
	"run_key" text NOT NULL,
	"source_run_token" text NOT NULL,
	"run_id" text NOT NULL,
	"job_id" text,
	"stage" text NOT NULL,
	"status" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"summary" text NOT NULL,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"projected_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator"."authenticated_notice_run_processing_projection" (
	"run_processing_id" text PRIMARY KEY NOT NULL,
	"run_key" text NOT NULL,
	"source_channel" text NOT NULL,
	"source_surface" text NOT NULL,
	"site_id" text NOT NULL,
	"source_run_token" text NOT NULL,
	"run_id" text NOT NULL,
	"replay_batch_id" text,
	"enqueue_source" text,
	"lifecycle_status" text NOT NULL,
	"latest_stage" text NOT NULL,
	"latest_queue_status" text NOT NULL,
	"queue_job_count" integer DEFAULT 0 NOT NULL,
	"queue_status_counts_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"source_truth_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"child_task_summary_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"downstream_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"job_summaries_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"timeline_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_error_code" text,
	"last_error_message" text,
	"first_observed_at" timestamp with time zone NOT NULL,
	"last_observed_at" timestamp with time zone NOT NULL,
	"projected_at" timestamp with time zone NOT NULL,
	"producer_version" text NOT NULL,
	"redaction_version" text NOT NULL
);
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
CREATE TABLE "official_web"."crawl_runs" (
	"run_id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"scheduler_run_key" text NOT NULL,
	"run_intent" text DEFAULT 'baseline' NOT NULL,
	"trigger_type" text NOT NULL,
	"collector_version" text NOT NULL,
	"config_version" text NOT NULL,
	"crawl_policy_version" text NOT NULL,
	"start_fingerprint_sha256" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"last_heartbeat_at" timestamp with time zone,
	"latest_heartbeat_sequence" integer DEFAULT 0 NOT NULL,
	"finished_at" timestamp with time zone,
	"host_set_json" jsonb NOT NULL,
	"seed_set_json" jsonb NOT NULL,
	"summary_json" jsonb,
	"terminal_payload_sha256" text,
	"terminal_error_code" text,
	"terminal_error_message" text,
	"ingestion_dispatch_status" text DEFAULT 'pending' NOT NULL,
	"ingestion_dispatched_at" timestamp with time zone,
	"ingestion_dispatch_ref" text,
	"ingestion_execution_status" text DEFAULT 'pending' NOT NULL,
	"ingestion_execution_ref" text,
	"ingestion_execution_updated_at" timestamp with time zone,
	"ingestion_execution_error_code" text,
	"ingestion_execution_error_message" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dining"."audit_events" (
	"audit_event_id" text PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"actor_display_name" text NOT NULL,
	"actor_principal_id" text NOT NULL,
	"object_id" text NOT NULL,
	"object_kind" text NOT NULL,
	"after_json" jsonb,
	"before_json" jsonb,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dining"."draft_versions" (
	"draft_version_id" text PRIMARY KEY NOT NULL,
	"version_number" integer NOT NULL,
	"summary_json" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dining"."floors" (
	"floor_id" text PRIMARY KEY NOT NULL,
	"hall_id" text NOT NULL,
	"label" text NOT NULL,
	"floorplan_id" text NOT NULL,
	"floorplan_sha256" text NOT NULL,
	"svg_asset_url" text NOT NULL,
	"sort_key" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dining"."halls" (
	"campus" text NOT NULL,
	"hall_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dining"."menu_items" (
	"menu_item_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"tags_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dining"."menu_offerings" (
	"offering_id" text PRIMARY KEY NOT NULL,
	"assignment_id" text NOT NULL,
	"menu_item_id" text NOT NULL,
	"price_label" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dining"."release_candidate_validation_reports" (
	"validation_report_id" text PRIMARY KEY NOT NULL,
	"candidate_id" text NOT NULL,
	"status" text NOT NULL,
	"blockers_json" jsonb NOT NULL,
	"warnings_json" jsonb NOT NULL,
	"summary_json" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dining"."release_candidates" (
	"candidate_id" text PRIMARY KEY NOT NULL,
	"base_draft_version_id" text NOT NULL,
	"status" text NOT NULL,
	"notes" text NOT NULL,
	"publish_mode" text NOT NULL,
	"scheduled_at" timestamp with time zone,
	"expected_predecessor_release_id" text,
	"snapshot_hash" text NOT NULL,
	"floorplan_refs_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"snapshot_payload_json" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"published_release_id" text
);
--> statement-breakpoint
CREATE TABLE "dining"."release_latest_pointer" (
	"scope" text PRIMARY KEY NOT NULL,
	"release_id" text NOT NULL,
	"snapshot_id" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dining"."release_schedule_jobs" (
	"schedule_job_id" text PRIMARY KEY NOT NULL,
	"candidate_id" text NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"attempt_count" integer NOT NULL,
	"last_error_code" text,
	"last_error_message" text,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"executed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "dining"."release_snapshots" (
	"snapshot_id" text PRIMARY KEY NOT NULL,
	"release_id" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"svg_object_refs_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"snapshot_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dining"."releases" (
	"release_id" text PRIMARY KEY NOT NULL,
	"candidate_id" text,
	"notes" text NOT NULL,
	"status" text NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" text,
	"predecessor_release_id" text,
	"snapshot_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dining"."review_projections" (
	"review_id" text PRIMARY KEY NOT NULL,
	"source_record_id" text NOT NULL,
	"campus" text NOT NULL,
	"hall_id" text NOT NULL,
	"hall_name" text NOT NULL,
	"stall_profile_id" text NOT NULL,
	"window_id" text NOT NULL,
	"stall_name" text NOT NULL,
	"dish_name" text NOT NULL,
	"paid_price_label" text,
	"rating" integer,
	"comment" text,
	"contributor_name" text,
	"images_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dining"."source_observations" (
	"observation_id" text PRIMARY KEY NOT NULL,
	"source_type" text NOT NULL,
	"source_base_token" text,
	"source_table_id" text,
	"source_record_id" text,
	"target_kind" text NOT NULL,
	"target_id" text,
	"payload_json" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"status" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"last_seen_run_id" text NOT NULL,
	"stale_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text
);
--> statement-breakpoint
CREATE TABLE "dining"."source_sync_runs" (
	"run_id" text PRIMARY KEY NOT NULL,
	"source_type" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"status" text NOT NULL,
	"total_count" integer NOT NULL,
	"accepted_count" integer NOT NULL,
	"blocked_count" integer NOT NULL,
	"stale_count" integer DEFAULT 0 NOT NULL,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "dining"."stall_profiles" (
	"stall_profile_id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"stall_type" text NOT NULL,
	"tags_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dining"."window_assignments" (
	"assignment_id" text PRIMARY KEY NOT NULL,
	"window_id" text NOT NULL,
	"stall_profile_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"effective_from" timestamp with time zone,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dining"."windows" (
	"window_id" text PRIMARY KEY NOT NULL,
	"hall_id" text NOT NULL,
	"floor_id" text NOT NULL,
	"label" text NOT NULL,
	"location_label" text NOT NULL,
	"svg_anchor_id" text,
	"geometry_json" jsonb NOT NULL,
	"tags_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
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
CREATE TABLE "observability_config"."llm_debug_trace_config" (
	"config_id" text PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"include_model_io" boolean DEFAULT false NOT NULL,
	"raw_capture_policy_json" jsonb,
	"sample_ratio" numeric DEFAULT '1' NOT NULL,
	"otlp_endpoint" text,
	"public_trace_base_url" text,
	"auth_header_secret_json" jsonb,
	"revision" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by_json" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator"."official_web_release_task_event_projection" (
	"event_id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"inventory_id" text NOT NULL,
	"job_id" text NOT NULL,
	"run_id" text NOT NULL,
	"stage" text NOT NULL,
	"status" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"summary" text NOT NULL,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"projected_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator"."official_web_release_task_projection" (
	"task_id" text PRIMARY KEY NOT NULL,
	"task_type" text NOT NULL,
	"source_channel" text NOT NULL,
	"inventory_id" text NOT NULL,
	"job_id" text NOT NULL,
	"run_id" text NOT NULL,
	"selected_write_target" text,
	"lifecycle_status" text NOT NULL,
	"latest_stage" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"input_summary_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output_summary_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"timeline_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_error_code" text,
	"last_error_message" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"projected_at" timestamp with time zone NOT NULL,
	"producer_version" text NOT NULL,
	"redaction_version" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "official_web"."run_admission_decisions" (
	"decision_id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"site_id" text NOT NULL,
	"decision" text NOT NULL,
	"reason_code" text NOT NULL,
	"reason" text NOT NULL,
	"decided_by" text NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"evidence_json" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator"."official_web_run_projection" (
	"run_id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"run_intent" text DEFAULT 'baseline' NOT NULL,
	"status" text NOT NULL,
	"ingestion_dispatch_status" text NOT NULL,
	"ingestion_dispatch_ref" text,
	"ingestion_execution_status" text DEFAULT 'pending' NOT NULL,
	"ingestion_execution_ref" text,
	"ingestion_execution_updated_at" timestamp with time zone,
	"ingestion_execution_error_code" text,
	"ingestion_execution_error_message" text,
	"collector_version" text,
	"config_version" text,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"last_heartbeat_at" timestamp with time zone,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"summary_json" jsonb,
	"artifacts_json" jsonb NOT NULL,
	"projected_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator"."official_web_site_projection" (
	"site_id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"host_roots_json" jsonb NOT NULL,
	"latest_run_id" text,
	"latest_run_status" text,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"latest_collector_version" text,
	"latest_config_version" text,
	"latest_ingestion_dispatch_status" text,
	"latest_ingestion_execution_status" text,
	"latest_ingestion_execution_updated_at" timestamp with time zone,
	"latest_ingestion_execution_error_code" text,
	"projected_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "official_web"."target_artifact_verification_summaries" (
	"summary_id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"run_id" text,
	"source_handoff_id" text,
	"object_verification_id" text,
	"canonical_verification" boolean DEFAULT false NOT NULL,
	"status" text NOT NULL,
	"summary_json" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "official_web"."target_job_candidates" (
	"candidate_id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"site_id" text NOT NULL,
	"target_id" text NOT NULL,
	"normalized_candidate_url" text NOT NULL,
	"source_host" text NOT NULL,
	"eligibility_reason" text NOT NULL,
	"url_hint" text,
	"title_hint" text,
	"status" text NOT NULL,
	"priority_score" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "official_web"."target_jobs" (
	"job_id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"target_id" text NOT NULL,
	"declaration_version" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text NOT NULL,
	"consumer_family" text NOT NULL,
	"owner_surface" text NOT NULL,
	"selected_write_target" text NOT NULL,
	"source_hosts_json" jsonb NOT NULL,
	"url_hints_json" jsonb NOT NULL,
	"title_hints_json" jsonb NOT NULL,
	"required_evidence_json" jsonb NOT NULL,
	"retention_policy" text NOT NULL,
	"review_policy" text NOT NULL,
	"materialization_policy" text NOT NULL,
	"inventory_only" boolean DEFAULT false NOT NULL,
	"latest_run_id" text,
	"candidate_count" integer DEFAULT 0 NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "official_web"."target_page_attempts" (
	"attempt_id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"candidate_id" text,
	"run_id" text,
	"site_id" text NOT NULL,
	"target_id" text NOT NULL,
	"normalized_canonical_url" text NOT NULL,
	"attempt_status" text NOT NULL,
	"http_status" integer,
	"artifact_object_key" text,
	"attempted_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "official_web"."target_release_gates" (
	"release_id" text PRIMARY KEY NOT NULL,
	"inventory_id" text NOT NULL,
	"job_id" text NOT NULL,
	"run_id" text,
	"summary_id" text,
	"decision" text NOT NULL,
	"status" text NOT NULL,
	"publish_alias" boolean DEFAULT false NOT NULL,
	"decided_by" text NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"notes" text,
	"evidence_json" jsonb NOT NULL,
	"execution_json" jsonb,
	"error_json" jsonb,
	"created_at" timestamp with time zone NOT NULL,
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
CREATE TABLE "official_web"."page_freshness" (
	"site_id" text NOT NULL,
	"normalized_canonical_url" text NOT NULL,
	"host" text NOT NULL,
	"page_family" text NOT NULL,
	"page_title_normalized" text NOT NULL,
	"discovered_from_url" text,
	"discovery_method" text NOT NULL,
	"last_fetch_disposition" text NOT NULL,
	"last_http_status" integer,
	"content_type" text,
	"etag" text,
	"last_modified" text,
	"response_body_hash" text,
	"main_content_hash" text,
	"last_seen_at" timestamp with time zone NOT NULL,
	"last_changed_at" timestamp with time zone,
	"last_not_modified_at" timestamp with time zone,
	"cadence_class" text NOT NULL,
	"priority_score" integer NOT NULL,
	"next_eligible_fetch_at" timestamp with time zone NOT NULL,
	"last_successful_run_id" text,
	"last_change_reason" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "official_web_page_freshness_pk" PRIMARY KEY("site_id","normalized_canonical_url")
);
--> statement-breakpoint
CREATE TABLE "official_web"."page_observations" (
	"observation_id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"site_id" text NOT NULL,
	"run_intent" text NOT NULL,
	"host" text NOT NULL,
	"requested_url" text NOT NULL,
	"final_url" text NOT NULL,
	"normalized_canonical_url" text NOT NULL,
	"page_family" text NOT NULL,
	"page_title_normalized" text NOT NULL,
	"discovery_method" text NOT NULL,
	"discovered_from_url" text,
	"raw_asset_id" text,
	"raw_version_id" text,
	"http_status" integer,
	"content_type" text,
	"etag" text,
	"last_modified" text,
	"response_body_hash" text,
	"main_content_hash" text,
	"fetch_disposition" text NOT NULL,
	"change_status" text NOT NULL,
	"last_change_reason" text NOT NULL,
	"cadence_class" text NOT NULL,
	"priority_score" integer NOT NULL,
	"next_eligible_fetch_at" timestamp with time zone NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL
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
CREATE TABLE "operator"."quality_grade_projection" (
	"grade_id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"trace_id" text NOT NULL,
	"surface" text NOT NULL,
	"request_started_at" timestamp with time zone NOT NULL,
	"selected_tool" text,
	"requested_tool" text,
	"principal_type" text NOT NULL,
	"collection" text,
	"model_name" text,
	"grade_source" text NOT NULL,
	"grade_domain" text NOT NULL,
	"verdict" text NOT NULL,
	"score_milli" integer,
	"grader_version" text NOT NULL,
	"rationale_summary" text,
	"sampled_at" timestamp with time zone NOT NULL,
	"projected_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "observability"."replay_packet_access_audit" (
	"access_id" text PRIMARY KEY NOT NULL,
	"packet_id" text NOT NULL,
	"request_id" text NOT NULL,
	"trace_id" text NOT NULL,
	"access_kind" text NOT NULL,
	"actor_principal" text NOT NULL,
	"purpose" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "observability"."replay_packet_index" (
	"packet_id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"request_id" text NOT NULL,
	"trace_id" text NOT NULL,
	"object_ref" text NOT NULL,
	"object_checksum_sha256" text NOT NULL,
	"sensitivity_classification" text NOT NULL,
	"capture_policy_json" jsonb NOT NULL,
	"llm_io_fingerprint_json" jsonb NOT NULL,
	"answer_eval_fingerprint_json" jsonb,
	"deletion_linkage_json" jsonb NOT NULL,
	"retention_json" jsonb NOT NULL,
	"access_audit_json" jsonb NOT NULL,
	"evidence_replay_index_json" jsonb NOT NULL,
	"sink_identity_projection_json" jsonb,
	"encryption_key_ref" text NOT NULL,
	"approval_ref" text,
	"operator_principal" text,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_accessed_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"deletion_marker_json" jsonb
);
--> statement-breakpoint
CREATE TABLE "operator"."request_audit_projection" (
	"audit_event_id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"trace_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"event_type" text NOT NULL,
	"surface" text NOT NULL,
	"principal_type" text NOT NULL,
	"entitlement_snapshot_id" text,
	"policy_projection_version" text,
	"requested_tool" text,
	"selected_tool" text,
	"status" text NOT NULL,
	"terminal_code" text,
	"summary" text NOT NULL,
	"diagnostics_json" jsonb NOT NULL,
	"projected_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runtime"."request_execution" (
	"request_id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"user_message_id" text NOT NULL,
	"assistant_message_id" text,
	"turn_sequence" integer DEFAULT 0 NOT NULL,
	"surface" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_principal_id" text NOT NULL,
	"actor_roles_json" jsonb NOT NULL,
	"actor_departments_json" jsonb NOT NULL,
	"principal_type" text NOT NULL,
	"principal_label" text,
	"entitlement_snapshot_id" text,
	"entitlement_groups_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"visibility_scope" text,
	"applicability_scope" text,
	"idempotency_key" text,
	"request_fingerprint_sha256" text,
	"trace_id" text NOT NULL,
	"run_id" text,
	"safety_identifier" text,
	"requested_tool" text,
	"requested_scope" text,
	"version_query_json" jsonb,
	"resolved_scope" text,
	"selected_tool" text,
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
	"requested_scope_summary" text,
	"version_query_mode" text,
	"version_query_summary" text,
	"resolved_scope_summary" text,
	"selected_tool" text,
	"status" text NOT NULL,
	"error_code" text,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"duration_ms" integer,
	"supporting_sources_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"refusal_class" text,
	"semantic_outcome" text,
	"scope_class" text,
	"acl_decision" text,
	"acl_anomaly_code" text,
	"fail_closed" boolean,
	"workflow_trace_summary_json" jsonb,
	"stage_timing_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"debug_trace_refs_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"answer_eval_fingerprint_json" jsonb,
	"llm_io_fingerprint_json" jsonb,
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
CREATE TABLE "operator"."request_projection" (
	"request_id" text PRIMARY KEY NOT NULL,
	"trace_id" text NOT NULL,
	"surface" text NOT NULL,
	"conversation_id" text NOT NULL,
	"principal_type" text NOT NULL,
	"principal_id" text NOT NULL,
	"principal_label" text,
	"entitlement_snapshot_id" text,
	"entitlement_groups_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"visibility_scope" text,
	"applicability_scope" text,
	"requested_tool" text,
	"requested_scope" text,
	"version_query_json" jsonb,
	"resolved_scope" text,
	"selected_tool" text,
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
CREATE TABLE "official_web"."run_artifacts" (
	"artifact_id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"artifact_type" text NOT NULL,
	"object_key" text NOT NULL,
	"content_sha256" text NOT NULL,
	"byte_size" integer,
	"record_count" integer,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "official_web"."run_heartbeats" (
	"heartbeat_id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"counts_json" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "official_web"."run_outbox" (
	"event_id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "operator"."temporal_task_queue_current" (
	"current_id" text PRIMARY KEY NOT NULL,
	"snapshot_id" text NOT NULL,
	"namespace" text NOT NULL,
	"task_queue" text NOT NULL,
	"task_queue_kind" text NOT NULL,
	"source" text NOT NULL,
	"poller_count" integer NOT NULL,
	"poller_identities_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"backlog_json" jsonb NOT NULL,
	"oldest_task_age_json" jsonb NOT NULL,
	"schedule_to_start_latency_json" jsonb NOT NULL,
	"sampled_at" timestamp with time zone NOT NULL,
	"projected_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator"."temporal_task_queue_snapshot" (
	"snapshot_id" text PRIMARY KEY NOT NULL,
	"namespace" text NOT NULL,
	"task_queue" text NOT NULL,
	"task_queue_kind" text NOT NULL,
	"source" text NOT NULL,
	"poller_count" integer NOT NULL,
	"poller_identities_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"backlog_json" jsonb NOT NULL,
	"oldest_task_age_json" jsonb NOT NULL,
	"schedule_to_start_latency_json" jsonb NOT NULL,
	"sampled_at" timestamp with time zone NOT NULL,
	"projected_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator"."trace_backlink_projection" (
	"request_id" text PRIMARY KEY NOT NULL,
	"trace_id" text NOT NULL,
	"trace_link" text,
	"issue_link" text,
	"issue_fingerprint" text,
	"projected_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wechat_official_account"."capture_runs" (
	"run_id" text PRIMARY KEY NOT NULL,
	"source_channel" text NOT NULL,
	"provider" text NOT NULL,
	"account_name" text NOT NULL,
	"account_slug" text NOT NULL,
	"scheduler_run_key" text NOT NULL,
	"trigger_type" text NOT NULL,
	"collector_version" text NOT NULL,
	"provider_base_url" text NOT NULL,
	"request_summary_json" jsonb NOT NULL,
	"start_fingerprint_sha256" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"last_heartbeat_at" timestamp with time zone,
	"latest_heartbeat_sequence" integer DEFAULT 0 NOT NULL,
	"finished_at" timestamp with time zone,
	"summary_json" jsonb,
	"terminal_payload_sha256" text,
	"terminal_error_code" text,
	"terminal_error_message" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wechat_official_account"."run_artifacts" (
	"artifact_id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"artifact_type" text NOT NULL,
	"object_key" text NOT NULL,
	"content_sha256" text NOT NULL,
	"byte_size" integer,
	"record_count" integer,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wechat_official_account"."run_heartbeats" (
	"heartbeat_id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"counts_json" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator"."worker_autoscaler_actuation" (
	"actuation_id" text PRIMARY KEY NOT NULL,
	"decision_id" text NOT NULL,
	"target_service" text NOT NULL,
	"actuator_kind" text NOT NULL,
	"action" text NOT NULL,
	"status" text NOT NULL,
	"from_replicas" integer NOT NULL,
	"to_replicas" integer NOT NULL,
	"error_code" text,
	"acted_at" timestamp with time zone NOT NULL,
	"projected_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator"."worker_autoscaler_decision" (
	"decision_id" text PRIMARY KEY NOT NULL,
	"task_queue" text NOT NULL,
	"task_queue_kind" text NOT NULL,
	"target_service" text NOT NULL,
	"decision" text NOT NULL,
	"current_replicas" integer NOT NULL,
	"desired_replicas" integer NOT NULL,
	"budget_state" text NOT NULL,
	"reason" text NOT NULL,
	"source_snapshot_id" text NOT NULL,
	"evidence_json" jsonb NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"projected_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator"."worker_autoscaler_decision_current" (
	"current_id" text PRIMARY KEY NOT NULL,
	"decision_id" text NOT NULL,
	"task_queue" text NOT NULL,
	"task_queue_kind" text NOT NULL,
	"target_service" text NOT NULL,
	"decision" text NOT NULL,
	"current_replicas" integer NOT NULL,
	"desired_replicas" integer NOT NULL,
	"budget_state" text NOT NULL,
	"reason" text NOT NULL,
	"source_snapshot_id" text NOT NULL,
	"evidence_json" jsonb NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"projected_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator"."worker_autoscaler_posture" (
	"posture_id" text PRIMARY KEY NOT NULL,
	"target_service" text NOT NULL,
	"task_queue" text NOT NULL,
	"task_queue_kind" text NOT NULL,
	"scaler_kind" text NOT NULL,
	"scaler_status" text NOT NULL,
	"metric_freshness_json" jsonb NOT NULL,
	"current_replicas" integer NOT NULL,
	"desired_replicas" integer NOT NULL,
	"min_replicas" integer NOT NULL,
	"max_replicas" integer NOT NULL,
	"last_scale_event_id" text,
	"last_scale_event_at" timestamp with time zone,
	"reason" text NOT NULL,
	"evidence_json" jsonb NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"projected_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "docs"."document_versions" ADD CONSTRAINT "document_versions_doc_id_documents_doc_id_fk" FOREIGN KEY ("doc_id") REFERENCES "docs"."documents"("doc_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs"."reader_assets" ADD CONSTRAINT "reader_assets_version_id_document_versions_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "docs"."document_versions"("version_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs"."search_units" ADD CONSTRAINT "search_units_doc_id_documents_doc_id_fk" FOREIGN KEY ("doc_id") REFERENCES "docs"."documents"("doc_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs"."search_units" ADD CONSTRAINT "search_units_version_id_document_versions_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "docs"."document_versions"("version_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_web"."run_admission_decisions" ADD CONSTRAINT "run_admission_decisions_run_id_crawl_runs_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "official_web"."crawl_runs"("run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_web"."target_artifact_verification_summaries" ADD CONSTRAINT "target_artifact_verification_summaries_job_id_target_jobs_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "official_web"."target_jobs"("job_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_web"."target_artifact_verification_summaries" ADD CONSTRAINT "target_artifact_verification_summaries_run_id_crawl_runs_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "official_web"."crawl_runs"("run_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_web"."target_job_candidates" ADD CONSTRAINT "target_job_candidates_job_id_target_jobs_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "official_web"."target_jobs"("job_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_web"."target_jobs" ADD CONSTRAINT "target_jobs_latest_run_id_crawl_runs_run_id_fk" FOREIGN KEY ("latest_run_id") REFERENCES "official_web"."crawl_runs"("run_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_web"."target_page_attempts" ADD CONSTRAINT "target_page_attempts_job_id_target_jobs_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "official_web"."target_jobs"("job_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_web"."target_page_attempts" ADD CONSTRAINT "target_page_attempts_candidate_id_target_job_candidates_candidate_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "official_web"."target_job_candidates"("candidate_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_web"."target_page_attempts" ADD CONSTRAINT "target_page_attempts_run_id_crawl_runs_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "official_web"."crawl_runs"("run_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_web"."target_release_gates" ADD CONSTRAINT "target_release_gates_job_id_target_jobs_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "official_web"."target_jobs"("job_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_web"."target_release_gates" ADD CONSTRAINT "target_release_gates_run_id_crawl_runs_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "official_web"."crawl_runs"("run_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_web"."target_release_gates" ADD CONSTRAINT "target_release_gates_summary_id_target_artifact_verification_summaries_summary_id_fk" FOREIGN KEY ("summary_id") REFERENCES "official_web"."target_artifact_verification_summaries"("summary_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_web"."page_observations" ADD CONSTRAINT "page_observations_run_id_crawl_runs_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "official_web"."crawl_runs"("run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_config"."profiles" ADD CONSTRAINT "provider_config_profiles_connection_id_connections_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "provider_config"."connections"("connection_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_web"."run_artifacts" ADD CONSTRAINT "run_artifacts_run_id_crawl_runs_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "official_web"."crawl_runs"("run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_web"."run_heartbeats" ADD CONSTRAINT "run_heartbeats_run_id_crawl_runs_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "official_web"."crawl_runs"("run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_web"."run_outbox" ADD CONSTRAINT "run_outbox_run_id_crawl_runs_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "official_web"."crawl_runs"("run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wechat_official_account"."run_artifacts" ADD CONSTRAINT "run_artifacts_run_id_capture_runs_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "wechat_official_account"."capture_runs"("run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wechat_official_account"."run_heartbeats" ADD CONSTRAINT "run_heartbeats_run_id_capture_runs_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "wechat_official_account"."capture_runs"("run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operator_auth_notice_event_processing_occurred_idx" ON "operator"."authenticated_notice_processing_event_projection" USING btree ("processing_id","occurred_at");--> statement-breakpoint
CREATE INDEX "operator_auth_notice_event_notice_occurred_idx" ON "operator"."authenticated_notice_processing_event_projection" USING btree ("notice_id","occurred_at");--> statement-breakpoint
CREATE INDEX "operator_auth_notice_processing_notice_projected_idx" ON "operator"."authenticated_notice_processing_projection" USING btree ("notice_id","projected_at");--> statement-breakpoint
CREATE INDEX "operator_auth_notice_processing_notice_key_projected_idx" ON "operator"."authenticated_notice_processing_projection" USING btree ("notice_key","projected_at");--> statement-breakpoint
CREATE INDEX "operator_auth_notice_processing_status_projected_idx" ON "operator"."authenticated_notice_processing_projection" USING btree ("lifecycle_status","projected_at");--> statement-breakpoint
CREATE INDEX "operator_auth_notice_processing_target_projected_idx" ON "operator"."authenticated_notice_processing_projection" USING btree ("target_surface","candidate_kind","projected_at");--> statement-breakpoint
CREATE INDEX "operator_auth_notice_processing_run_projected_idx" ON "operator"."authenticated_notice_processing_projection" USING btree ("run_id","projected_at");--> statement-breakpoint
CREATE INDEX "operator_auth_notice_run_event_processing_occurred_idx" ON "operator"."authenticated_notice_run_processing_event_projection" USING btree ("run_processing_id","occurred_at");--> statement-breakpoint
CREATE INDEX "operator_auth_notice_run_event_source_run_occurred_idx" ON "operator"."authenticated_notice_run_processing_event_projection" USING btree ("source_run_token","occurred_at");--> statement-breakpoint
CREATE INDEX "operator_auth_notice_run_processing_source_run_projected_idx" ON "operator"."authenticated_notice_run_processing_projection" USING btree ("source_run_token","projected_at");--> statement-breakpoint
CREATE INDEX "operator_auth_notice_run_processing_run_projected_idx" ON "operator"."authenticated_notice_run_processing_projection" USING btree ("run_id","projected_at");--> statement-breakpoint
CREATE INDEX "operator_auth_notice_run_processing_site_status_idx" ON "operator"."authenticated_notice_run_processing_projection" USING btree ("site_id","lifecycle_status","projected_at");--> statement-breakpoint
CREATE INDEX "operator_auth_notice_run_processing_queue_status_idx" ON "operator"."authenticated_notice_run_processing_projection" USING btree ("latest_queue_status","projected_at");--> statement-breakpoint
CREATE INDEX "campus_services_ops_audit_action_occurred_idx" ON "campus_services_ops"."audit_events" USING btree ("action","occurred_at");--> statement-breakpoint
CREATE INDEX "campus_services_ops_audit_object_occurred_idx" ON "campus_services_ops"."audit_events" USING btree ("object_type","object_id","occurred_at");--> statement-breakpoint
CREATE INDEX "campus_services_ops_releases_published_at_idx" ON "campus_services_ops"."releases" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "campus_services_ops_attestations_confirmed_at_idx" ON "campus_services_ops"."source_attestations" USING btree ("confirmed_at");--> statement-breakpoint
CREATE INDEX "campus_services_ops_attestations_source_confirmed_idx" ON "campus_services_ops"."source_attestations" USING btree ("source_type","confirmed_at");--> statement-breakpoint
CREATE INDEX "campus_services_ops_transport_effective_window_idx" ON "campus_services_ops"."transport_overrides" USING btree ("effective_from","effective_until");--> statement-breakpoint
CREATE INDEX "campus_services_ops_transport_review_updated_idx" ON "campus_services_ops"."transport_overrides" USING btree ("review_state","updated_at");--> statement-breakpoint
CREATE INDEX "campus_services_ops_transport_route_updated_idx" ON "campus_services_ops"."transport_overrides" USING btree ("route_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "official_web_crawl_runs_site_scheduler_idx" ON "official_web"."crawl_runs" USING btree ("site_id","scheduler_run_key","run_intent");--> statement-breakpoint
CREATE INDEX "official_web_crawl_runs_status_started_at_idx" ON "official_web"."crawl_runs" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "official_web_crawl_runs_site_started_at_idx" ON "official_web"."crawl_runs" USING btree ("site_id","started_at");--> statement-breakpoint
CREATE INDEX "official_web_crawl_runs_dispatch_status_updated_at_idx" ON "official_web"."crawl_runs" USING btree ("ingestion_dispatch_status","updated_at");--> statement-breakpoint
CREATE INDEX "dining_audit_events_action_occurred_idx" ON "dining"."audit_events" USING btree ("action","occurred_at");--> statement-breakpoint
CREATE INDEX "dining_audit_events_object_occurred_idx" ON "dining"."audit_events" USING btree ("object_kind","object_id","occurred_at");--> statement-breakpoint
CREATE INDEX "dining_draft_versions_version_idx" ON "dining"."draft_versions" USING btree ("version_number");--> statement-breakpoint
CREATE INDEX "dining_floors_hall_idx" ON "dining"."floors" USING btree ("hall_id");--> statement-breakpoint
CREATE INDEX "dining_menu_items_name_idx" ON "dining"."menu_items" USING btree ("name");--> statement-breakpoint
CREATE INDEX "dining_menu_items_status_idx" ON "dining"."menu_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "dining_menu_offerings_assignment_idx" ON "dining"."menu_offerings" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "dining_menu_offerings_menu_item_idx" ON "dining"."menu_offerings" USING btree ("menu_item_id");--> statement-breakpoint
CREATE INDEX "dining_release_candidate_reports_candidate_idx" ON "dining"."release_candidate_validation_reports" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "dining_release_candidates_status_created_idx" ON "dining"."release_candidates" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "dining_release_schedule_jobs_status_scheduled_idx" ON "dining"."release_schedule_jobs" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "dining_release_snapshots_release_idx" ON "dining"."release_snapshots" USING btree ("release_id");--> statement-breakpoint
CREATE INDEX "dining_releases_status_created_idx" ON "dining"."releases" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "dining_releases_published_idx" ON "dining"."releases" USING btree ("published","published_at");--> statement-breakpoint
CREATE INDEX "dining_review_projections_hall_idx" ON "dining"."review_projections" USING btree ("hall_id");--> statement-breakpoint
CREATE INDEX "dining_review_projections_source_record_idx" ON "dining"."review_projections" USING btree ("source_record_id");--> statement-breakpoint
CREATE INDEX "dining_review_projections_stall_profile_idx" ON "dining"."review_projections" USING btree ("stall_profile_id");--> statement-breakpoint
CREATE INDEX "dining_review_projections_window_idx" ON "dining"."review_projections" USING btree ("window_id");--> statement-breakpoint
CREATE INDEX "dining_source_observations_source_record_idx" ON "dining"."source_observations" USING btree ("source_type","source_table_id","source_record_id");--> statement-breakpoint
CREATE INDEX "dining_source_observations_status_observed_idx" ON "dining"."source_observations" USING btree ("status","observed_at");--> statement-breakpoint
CREATE INDEX "dining_source_observations_stale_idx" ON "dining"."source_observations" USING btree ("source_type","stale_at");--> statement-breakpoint
CREATE INDEX "dining_source_observations_target_idx" ON "dining"."source_observations" USING btree ("target_kind","target_id");--> statement-breakpoint
CREATE INDEX "dining_source_sync_runs_source_started_idx" ON "dining"."source_sync_runs" USING btree ("source_type","started_at");--> statement-breakpoint
CREATE INDEX "dining_source_sync_runs_status_started_idx" ON "dining"."source_sync_runs" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "dining_stall_profiles_status_idx" ON "dining"."stall_profiles" USING btree ("status");--> statement-breakpoint
CREATE INDEX "dining_window_assignments_window_status_idx" ON "dining"."window_assignments" USING btree ("window_id","status");--> statement-breakpoint
CREATE INDEX "dining_window_assignments_stall_profile_idx" ON "dining"."window_assignments" USING btree ("stall_profile_id");--> statement-breakpoint
CREATE INDEX "dining_windows_floor_idx" ON "dining"."windows" USING btree ("hall_id","floor_id");--> statement-breakpoint
CREATE INDEX "dining_windows_status_idx" ON "dining"."windows" USING btree ("status");--> statement-breakpoint
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
CREATE INDEX "operator_ow_release_task_event_task_occurred_idx" ON "operator"."official_web_release_task_event_projection" USING btree ("task_id","occurred_at");--> statement-breakpoint
CREATE INDEX "operator_ow_release_task_event_run_occurred_idx" ON "operator"."official_web_release_task_event_projection" USING btree ("run_id","occurred_at");--> statement-breakpoint
CREATE INDEX "operator_ow_release_task_inventory_projected_idx" ON "operator"."official_web_release_task_projection" USING btree ("inventory_id","projected_at");--> statement-breakpoint
CREATE INDEX "operator_ow_release_task_job_projected_idx" ON "operator"."official_web_release_task_projection" USING btree ("job_id","projected_at");--> statement-breakpoint
CREATE INDEX "operator_ow_release_task_run_projected_idx" ON "operator"."official_web_release_task_projection" USING btree ("run_id","projected_at");--> statement-breakpoint
CREATE INDEX "operator_ow_release_task_status_projected_idx" ON "operator"."official_web_release_task_projection" USING btree ("lifecycle_status","projected_at");--> statement-breakpoint
CREATE INDEX "operator_ow_release_task_target_projected_idx" ON "operator"."official_web_release_task_projection" USING btree ("selected_write_target","projected_at");--> statement-breakpoint
CREATE UNIQUE INDEX "official_web_run_admission_decisions_run_idx" ON "official_web"."run_admission_decisions" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "official_web_run_admission_decisions_site_decision_idx" ON "official_web"."run_admission_decisions" USING btree ("site_id","decision","decided_at");--> statement-breakpoint
CREATE INDEX "operator_official_web_run_projection_site_started_at_idx" ON "operator"."official_web_run_projection" USING btree ("site_id","started_at");--> statement-breakpoint
CREATE INDEX "operator_official_web_run_projection_status_started_at_idx" ON "operator"."official_web_run_projection" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "operator_official_web_run_projection_dispatch_started_at_idx" ON "operator"."official_web_run_projection" USING btree ("ingestion_dispatch_status","started_at");--> statement-breakpoint
CREATE INDEX "operator_official_web_site_projection_status_projected_at_idx" ON "operator"."official_web_site_projection" USING btree ("latest_run_status","projected_at");--> statement-breakpoint
CREATE UNIQUE INDEX "official_web_target_artifact_summary_job_run_idx" ON "official_web"."target_artifact_verification_summaries" USING btree ("job_id","run_id");--> statement-breakpoint
CREATE INDEX "official_web_target_artifact_summary_canonical_idx" ON "official_web"."target_artifact_verification_summaries" USING btree ("canonical_verification","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "official_web_target_candidates_job_url_idx" ON "official_web"."target_job_candidates" USING btree ("job_id","normalized_candidate_url");--> statement-breakpoint
CREATE INDEX "official_web_target_candidates_site_status_idx" ON "official_web"."target_job_candidates" USING btree ("site_id","status","priority_score");--> statement-breakpoint
CREATE UNIQUE INDEX "official_web_target_jobs_idempotency_idx" ON "official_web"."target_jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "official_web_target_jobs_site_status_idx" ON "official_web"."target_jobs" USING btree ("site_id","status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "official_web_target_jobs_site_target_version_idx" ON "official_web"."target_jobs" USING btree ("site_id","target_id","declaration_version");--> statement-breakpoint
CREATE INDEX "official_web_target_attempts_job_attempted_idx" ON "official_web"."target_page_attempts" USING btree ("job_id","attempted_at");--> statement-breakpoint
CREATE INDEX "official_web_target_attempts_run_idx" ON "official_web"."target_page_attempts" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "official_web_target_release_gates_inventory_run_decision_idx" ON "official_web"."target_release_gates" USING btree ("inventory_id","run_id","decision");--> statement-breakpoint
CREATE INDEX "official_web_target_release_gates_status_updated_at_idx" ON "official_web"."target_release_gates" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "observability_ops_read_at_idx" ON "observability"."ops_observability_read_audit" USING btree ("read_at");--> statement-breakpoint
CREATE INDEX "observability_ops_read_request_at_idx" ON "observability"."ops_observability_read_audit" USING btree ("request_id","read_at");--> statement-breakpoint
CREATE INDEX "official_web_page_freshness_cadence_eligible_idx" ON "official_web"."page_freshness" USING btree ("cadence_class","next_eligible_fetch_at");--> statement-breakpoint
CREATE INDEX "official_web_page_freshness_host_updated_at_idx" ON "official_web"."page_freshness" USING btree ("host","updated_at");--> statement-breakpoint
CREATE INDEX "official_web_page_freshness_last_seen_at_idx" ON "official_web"."page_freshness" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "official_web_page_observations_run_observed_at_idx" ON "official_web"."page_observations" USING btree ("run_id","observed_at");--> statement-breakpoint
CREATE INDEX "official_web_page_observations_site_url_observed_at_idx" ON "official_web"."page_observations" USING btree ("site_id","normalized_canonical_url","observed_at");--> statement-breakpoint
CREATE INDEX "official_web_page_observations_change_status_observed_at_idx" ON "official_web"."page_observations" USING btree ("change_status","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "profile_memory_items_owner_key_uidx" ON "profile"."memory_items" USING btree ("owner_user_id","key");--> statement-breakpoint
CREATE INDEX "profile_memory_items_owner_updated_at_idx" ON "profile"."memory_items" USING btree ("owner_user_id","updated_at");--> statement-breakpoint
CREATE INDEX "runtime_projection_outbox_processed_available_idx" ON "runtime"."projection_outbox" USING btree ("processed_at","available_at");--> statement-breakpoint
CREATE INDEX "runtime_projection_outbox_request_occurred_idx" ON "runtime"."projection_outbox" USING btree ("request_id","occurred_at");--> statement-breakpoint
CREATE INDEX "provider_config_connections_provider_updated_idx" ON "provider_config"."connections" USING btree ("provider","updated_at");--> statement-breakpoint
CREATE INDEX "provider_config_profiles_active_role_idx" ON "provider_config"."profiles" USING btree ("role","active","updated_at");--> statement-breakpoint
CREATE INDEX "provider_config_profiles_kind_role_updated_idx" ON "provider_config"."profiles" USING btree ("kind","role","updated_at");--> statement-breakpoint
CREATE INDEX "operator_quality_grade_projection_request_started_at_idx" ON "operator"."quality_grade_projection" USING btree ("request_started_at");--> statement-breakpoint
CREATE INDEX "operator_quality_grade_projection_domain_started_at_idx" ON "operator"."quality_grade_projection" USING btree ("grade_domain","request_started_at");--> statement-breakpoint
CREATE INDEX "operator_quality_grade_projection_request_sampled_at_idx" ON "operator"."quality_grade_projection" USING btree ("request_id","sampled_at");--> statement-breakpoint
CREATE INDEX "operator_quality_grade_projection_domain_surface_started_at_idx" ON "operator"."quality_grade_projection" USING btree ("grade_domain","surface","request_started_at");--> statement-breakpoint
CREATE INDEX "observability_replay_packet_access_actor_occurred_idx" ON "observability"."replay_packet_access_audit" USING btree ("actor_principal","occurred_at");--> statement-breakpoint
CREATE INDEX "observability_replay_packet_access_packet_occurred_idx" ON "observability"."replay_packet_access_audit" USING btree ("packet_id","occurred_at");--> statement-breakpoint
CREATE INDEX "observability_replay_packet_access_request_occurred_idx" ON "observability"."replay_packet_access_audit" USING btree ("request_id","occurred_at");--> statement-breakpoint
CREATE INDEX "observability_replay_packet_request_id_idx" ON "observability"."replay_packet_index" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "observability_replay_packet_run_id_idx" ON "observability"."replay_packet_index" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "observability_replay_packet_trace_id_idx" ON "observability"."replay_packet_index" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "observability_replay_packet_expires_at_idx" ON "observability"."replay_packet_index" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "operator_request_audit_projection_request_occurred_at_idx" ON "operator"."request_audit_projection" USING btree ("request_id","occurred_at");--> statement-breakpoint
CREATE INDEX "operator_request_audit_projection_trace_occurred_at_idx" ON "operator"."request_audit_projection" USING btree ("trace_id","occurred_at");--> statement-breakpoint
CREATE INDEX "operator_request_audit_projection_event_type_occurred_at_idx" ON "operator"."request_audit_projection" USING btree ("event_type","occurred_at");--> statement-breakpoint
CREATE INDEX "operator_request_audit_projection_status_occurred_at_idx" ON "operator"."request_audit_projection" USING btree ("status","occurred_at");--> statement-breakpoint
CREATE INDEX "runtime_request_execution_conversation_started_at_idx" ON "runtime"."request_execution" USING btree ("conversation_id","started_at");--> statement-breakpoint
CREATE INDEX "runtime_request_execution_conversation_turn_sequence_idx" ON "runtime"."request_execution" USING btree ("conversation_id","turn_sequence");--> statement-breakpoint
CREATE INDEX "runtime_request_execution_status_started_at_idx" ON "runtime"."request_execution" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "runtime_request_execution_run_started_at_idx" ON "runtime"."request_execution" USING btree ("run_id","started_at");--> statement-breakpoint
CREATE INDEX "runtime_request_execution_safety_identifier_started_at_idx" ON "runtime"."request_execution" USING btree ("safety_identifier","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_request_execution_actor_idempotency_idx" ON "runtime"."request_execution" USING btree ("actor_user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "runtime_request_observability_started_at_idx" ON "runtime"."request_observability_fact" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "runtime_request_observability_status_started_at_idx" ON "runtime"."request_observability_fact" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "runtime_request_observability_surface_started_at_idx" ON "runtime"."request_observability_fact" USING btree ("surface","started_at");--> statement-breakpoint
CREATE INDEX "runtime_request_observability_selected_tool_started_at_idx" ON "runtime"."request_observability_fact" USING btree ("selected_tool","started_at");--> statement-breakpoint
CREATE INDEX "runtime_request_observability_principal_type_started_at_idx" ON "runtime"."request_observability_fact" USING btree ("principal_type","started_at");--> statement-breakpoint
CREATE INDEX "runtime_request_observability_model_name_started_at_idx" ON "runtime"."request_observability_fact" USING btree ("model_name","started_at");--> statement-breakpoint
CREATE INDEX "runtime_request_observability_safety_identifier_started_at_idx" ON "runtime"."request_observability_fact" USING btree ("safety_identifier","started_at");--> statement-breakpoint
CREATE INDEX "operator_request_projection_started_at_request_id_idx" ON "operator"."request_projection" USING btree ("started_at" DESC NULLS LAST,"request_id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "operator_request_projection_trace_started_at_request_id_idx" ON "operator"."request_projection" USING btree ("trace_id","started_at" DESC NULLS LAST,"request_id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "operator_request_projection_status_started_at_idx" ON "operator"."request_projection" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "operator_request_projection_conversation_started_at_idx" ON "operator"."request_projection" USING btree ("conversation_id","started_at");--> statement-breakpoint
CREATE INDEX "official_web_run_artifacts_run_type_idx" ON "official_web"."run_artifacts" USING btree ("run_id","artifact_type");--> statement-breakpoint
CREATE UNIQUE INDEX "official_web_run_artifacts_run_type_key_idx" ON "official_web"."run_artifacts" USING btree ("run_id","artifact_type","object_key");--> statement-breakpoint
CREATE UNIQUE INDEX "official_web_run_heartbeats_run_sequence_idx" ON "official_web"."run_heartbeats" USING btree ("run_id","sequence");--> statement-breakpoint
CREATE INDEX "official_web_run_heartbeats_run_observed_at_idx" ON "official_web"."run_heartbeats" USING btree ("run_id","observed_at");--> statement-breakpoint
CREATE INDEX "official_web_run_outbox_processed_available_idx" ON "official_web"."run_outbox" USING btree ("processed_at","available_at");--> statement-breakpoint
CREATE INDEX "official_web_run_outbox_run_occurred_idx" ON "official_web"."run_outbox" USING btree ("run_id","occurred_at");--> statement-breakpoint
CREATE INDEX "operator_temporal_tq_current_queue_sampled_idx" ON "operator"."temporal_task_queue_current" USING btree ("task_queue","sampled_at");--> statement-breakpoint
CREATE INDEX "operator_temporal_tq_current_kind_sampled_idx" ON "operator"."temporal_task_queue_current" USING btree ("task_queue_kind","sampled_at");--> statement-breakpoint
CREATE INDEX "operator_temporal_tq_snapshot_queue_sampled_idx" ON "operator"."temporal_task_queue_snapshot" USING btree ("task_queue","sampled_at");--> statement-breakpoint
CREATE INDEX "operator_temporal_tq_snapshot_kind_sampled_idx" ON "operator"."temporal_task_queue_snapshot" USING btree ("task_queue_kind","sampled_at");--> statement-breakpoint
CREATE INDEX "operator_trace_backlink_projection_trace_projected_at_idx" ON "operator"."trace_backlink_projection" USING btree ("trace_id","projected_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wechat_official_account_capture_runs_account_scheduler_idx" ON "wechat_official_account"."capture_runs" USING btree ("provider","account_slug","scheduler_run_key");--> statement-breakpoint
CREATE INDEX "wechat_official_account_capture_runs_status_started_at_idx" ON "wechat_official_account"."capture_runs" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "wechat_official_account_capture_runs_account_started_at_idx" ON "wechat_official_account"."capture_runs" USING btree ("account_slug","started_at");--> statement-breakpoint
CREATE INDEX "wechat_official_account_run_artifacts_run_type_idx" ON "wechat_official_account"."run_artifacts" USING btree ("run_id","artifact_type");--> statement-breakpoint
CREATE UNIQUE INDEX "wechat_official_account_run_artifacts_run_type_key_idx" ON "wechat_official_account"."run_artifacts" USING btree ("run_id","artifact_type","object_key");--> statement-breakpoint
CREATE UNIQUE INDEX "wechat_official_account_run_heartbeats_run_sequence_idx" ON "wechat_official_account"."run_heartbeats" USING btree ("run_id","sequence");--> statement-breakpoint
CREATE INDEX "wechat_official_account_run_heartbeats_run_observed_at_idx" ON "wechat_official_account"."run_heartbeats" USING btree ("run_id","observed_at");--> statement-breakpoint
CREATE INDEX "operator_worker_autoscaler_actuation_decision_idx" ON "operator"."worker_autoscaler_actuation" USING btree ("decision_id","acted_at");--> statement-breakpoint
CREATE INDEX "operator_worker_autoscaler_actuation_target_idx" ON "operator"."worker_autoscaler_actuation" USING btree ("target_service","acted_at");--> statement-breakpoint
CREATE INDEX "operator_worker_autoscaler_target_decided_idx" ON "operator"."worker_autoscaler_decision" USING btree ("target_service","decided_at");--> statement-breakpoint
CREATE INDEX "operator_worker_autoscaler_decision_decided_idx" ON "operator"."worker_autoscaler_decision" USING btree ("decision","decided_at");--> statement-breakpoint
CREATE INDEX "operator_worker_autoscaler_snapshot_idx" ON "operator"."worker_autoscaler_decision" USING btree ("source_snapshot_id");--> statement-breakpoint
CREATE INDEX "operator_worker_autoscaler_current_target_idx" ON "operator"."worker_autoscaler_decision_current" USING btree ("target_service","decided_at");--> statement-breakpoint
CREATE INDEX "operator_worker_autoscaler_current_decision_idx" ON "operator"."worker_autoscaler_decision_current" USING btree ("decision","decided_at");--> statement-breakpoint
CREATE INDEX "operator_worker_autoscaler_posture_target_observed_idx" ON "operator"."worker_autoscaler_posture" USING btree ("target_service","observed_at");--> statement-breakpoint
CREATE INDEX "operator_worker_autoscaler_posture_status_observed_idx" ON "operator"."worker_autoscaler_posture" USING btree ("scaler_status","observed_at");
