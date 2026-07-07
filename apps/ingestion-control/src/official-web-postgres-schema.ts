import type { PgQueryable } from "./postgres-store";

export async function ensureOfficialWebPostgresSchema(client: PgQueryable): Promise<void> {
	await client.query("CREATE SCHEMA IF NOT EXISTS official_web");
	await client.query("CREATE SCHEMA IF NOT EXISTS operator");
	await client.query(`
CREATE TABLE IF NOT EXISTS official_web.crawl_runs (
	run_id text PRIMARY KEY,
	site_id text NOT NULL,
	scheduler_run_key text NOT NULL,
	run_intent text NOT NULL DEFAULT 'baseline',
	trigger_type text NOT NULL,
	source_adapter_version text NOT NULL,
	config_version text NOT NULL,
	crawl_policy_version text NOT NULL,
	start_fingerprint_sha256 text NOT NULL,
	status text NOT NULL,
	started_at timestamptz NOT NULL,
	last_heartbeat_at timestamptz,
	latest_heartbeat_sequence integer NOT NULL DEFAULT 0,
	finished_at timestamptz,
	host_set_json jsonb NOT NULL,
	seed_set_json jsonb NOT NULL,
	summary_json jsonb,
	terminal_payload_sha256 text,
	terminal_error_code text,
	terminal_error_message text,
	ingestion_dispatch_status text NOT NULL DEFAULT 'pending',
	ingestion_dispatched_at timestamptz,
	ingestion_dispatch_ref text,
	ingestion_execution_status text NOT NULL DEFAULT 'pending',
	ingestion_execution_ref text,
	ingestion_execution_updated_at timestamptz,
	ingestion_execution_error_code text,
	ingestion_execution_error_message text,
	created_at timestamptz NOT NULL,
	updated_at timestamptz NOT NULL
)`);
	await client.query(`
CREATE UNIQUE INDEX IF NOT EXISTS official_web_crawl_runs_site_scheduler_idx
ON official_web.crawl_runs (site_id, scheduler_run_key, run_intent)`);
	await client.query(`
CREATE INDEX IF NOT EXISTS official_web_crawl_runs_status_started_at_idx
ON official_web.crawl_runs (status, started_at)`);
	await client.query(`
CREATE INDEX IF NOT EXISTS official_web_crawl_runs_site_started_at_idx
ON official_web.crawl_runs (site_id, started_at)`);
	await client.query(`
CREATE INDEX IF NOT EXISTS official_web_crawl_runs_dispatch_status_updated_at_idx
ON official_web.crawl_runs (ingestion_dispatch_status, updated_at)`);
	await client.query(`
CREATE TABLE IF NOT EXISTS official_web.run_heartbeats (
	heartbeat_id text PRIMARY KEY,
	run_id text NOT NULL REFERENCES official_web.crawl_runs(run_id) ON DELETE CASCADE,
	sequence integer NOT NULL,
	observed_at timestamptz NOT NULL,
	counts_json jsonb NOT NULL,
	created_at timestamptz NOT NULL
)`);
	await client.query(`
CREATE UNIQUE INDEX IF NOT EXISTS official_web_run_heartbeats_run_sequence_idx
ON official_web.run_heartbeats (run_id, sequence)`);
	await client.query(`
CREATE INDEX IF NOT EXISTS official_web_run_heartbeats_run_observed_at_idx
ON official_web.run_heartbeats (run_id, observed_at)`);
	await client.query(`
CREATE TABLE IF NOT EXISTS official_web.run_artifacts (
	artifact_id text PRIMARY KEY,
	run_id text NOT NULL REFERENCES official_web.crawl_runs(run_id) ON DELETE CASCADE,
	artifact_type text NOT NULL,
	object_key text NOT NULL,
	content_sha256 text NOT NULL,
	byte_size integer,
	record_count integer,
	created_at timestamptz NOT NULL
)`);
	await client.query(`
CREATE INDEX IF NOT EXISTS official_web_run_artifacts_run_type_idx
ON official_web.run_artifacts (run_id, artifact_type)`);
	await client.query(`
CREATE UNIQUE INDEX IF NOT EXISTS official_web_run_artifacts_run_type_key_idx
ON official_web.run_artifacts (run_id, artifact_type, object_key)`);
	await client.query(`
CREATE TABLE IF NOT EXISTS official_web.page_observations (
	observation_id text PRIMARY KEY,
	run_id text NOT NULL REFERENCES official_web.crawl_runs(run_id) ON DELETE CASCADE,
	site_id text NOT NULL,
	run_intent text NOT NULL,
	host text NOT NULL,
	requested_url text NOT NULL,
	final_url text NOT NULL,
	normalized_canonical_url text NOT NULL,
	page_family text NOT NULL,
	page_title_normalized text NOT NULL,
	discovery_method text NOT NULL,
	discovered_from_url text,
	raw_asset_id text,
	raw_version_id text,
	http_status integer,
	content_type text,
	etag text,
	last_modified text,
	response_body_hash text,
	main_content_hash text,
	fetch_disposition text NOT NULL,
	change_status text NOT NULL,
	last_change_reason text NOT NULL,
	cadence_class text NOT NULL,
	priority_score integer NOT NULL,
	next_eligible_fetch_at timestamptz NOT NULL,
	observed_at timestamptz NOT NULL,
	created_at timestamptz NOT NULL
)`);
	await client.query(`
CREATE INDEX IF NOT EXISTS official_web_page_observations_run_observed_at_idx
ON official_web.page_observations (run_id, observed_at)`);
	await client.query(`
CREATE INDEX IF NOT EXISTS official_web_page_observations_site_url_observed_at_idx
ON official_web.page_observations (site_id, normalized_canonical_url, observed_at)`);
	await client.query(`
CREATE INDEX IF NOT EXISTS official_web_page_observations_change_status_observed_at_idx
ON official_web.page_observations (change_status, observed_at)`);
	await client.query(`
CREATE TABLE IF NOT EXISTS official_web.page_freshness (
	site_id text NOT NULL,
	normalized_canonical_url text NOT NULL,
	host text NOT NULL,
	page_family text NOT NULL,
	page_title_normalized text NOT NULL,
	discovered_from_url text,
	discovery_method text NOT NULL,
	last_fetch_disposition text NOT NULL,
	last_http_status integer,
	content_type text,
	etag text,
	last_modified text,
	response_body_hash text,
	main_content_hash text,
	last_seen_at timestamptz NOT NULL,
	last_changed_at timestamptz,
	last_not_modified_at timestamptz,
	cadence_class text NOT NULL,
	priority_score integer NOT NULL,
	next_eligible_fetch_at timestamptz NOT NULL,
	last_successful_run_id text,
	last_change_reason text NOT NULL,
	created_at timestamptz NOT NULL,
	updated_at timestamptz NOT NULL,
	CONSTRAINT official_web_page_freshness_pk PRIMARY KEY (site_id, normalized_canonical_url)
)`);
	await client.query(`
CREATE INDEX IF NOT EXISTS official_web_page_freshness_cadence_eligible_idx
ON official_web.page_freshness (cadence_class, next_eligible_fetch_at)`);
	await client.query(`
CREATE INDEX IF NOT EXISTS official_web_page_freshness_host_updated_at_idx
ON official_web.page_freshness (host, updated_at)`);
	await client.query(`
CREATE INDEX IF NOT EXISTS official_web_page_freshness_last_seen_at_idx
ON official_web.page_freshness (last_seen_at)`);
	await client.query(`
CREATE TABLE IF NOT EXISTS official_web.run_outbox (
	event_id text PRIMARY KEY,
	run_id text NOT NULL REFERENCES official_web.crawl_runs(run_id) ON DELETE CASCADE,
	event_type text NOT NULL,
	payload_json jsonb NOT NULL,
	occurred_at timestamptz NOT NULL,
	available_at timestamptz NOT NULL,
	processed_at timestamptz,
	attempt_count integer NOT NULL DEFAULT 0,
	last_error text
)`);
	await client.query(`
CREATE INDEX IF NOT EXISTS official_web_run_outbox_processed_available_idx
ON official_web.run_outbox (processed_at, available_at)`);
	await client.query(`
CREATE INDEX IF NOT EXISTS official_web_run_outbox_run_occurred_idx
ON official_web.run_outbox (run_id, occurred_at)`);
	await client.query(`
CREATE TABLE IF NOT EXISTS official_web.target_jobs (
	job_id text PRIMARY KEY,
	site_id text NOT NULL,
	target_id text NOT NULL,
	declaration_version text NOT NULL,
	idempotency_key text NOT NULL,
	status text NOT NULL,
	consumer_family text NOT NULL,
	owner_surface text NOT NULL,
	selected_write_target text NOT NULL,
	source_hosts_json jsonb NOT NULL,
	url_hints_json jsonb NOT NULL,
	title_hints_json jsonb NOT NULL,
	required_evidence_json jsonb NOT NULL,
	retention_policy text NOT NULL,
	review_policy text NOT NULL,
	materialization_policy text NOT NULL,
	inventory_only boolean NOT NULL DEFAULT false,
	latest_run_id text REFERENCES official_web.crawl_runs(run_id) ON DELETE SET NULL,
	candidate_count integer NOT NULL DEFAULT 0,
	attempt_count integer NOT NULL DEFAULT 0,
	created_at timestamptz NOT NULL,
	updated_at timestamptz NOT NULL
)`);
	await client.query(`
CREATE UNIQUE INDEX IF NOT EXISTS official_web_target_jobs_idempotency_idx
ON official_web.target_jobs (idempotency_key)`);
	await client.query(`
CREATE INDEX IF NOT EXISTS official_web_target_jobs_site_status_idx
ON official_web.target_jobs (site_id, status, updated_at)`);
	await client.query(`
CREATE UNIQUE INDEX IF NOT EXISTS official_web_target_jobs_site_target_version_idx
ON official_web.target_jobs (site_id, target_id, declaration_version)`);
	await client.query(`
CREATE TABLE IF NOT EXISTS official_web.target_job_candidates (
	candidate_id text PRIMARY KEY,
	job_id text NOT NULL REFERENCES official_web.target_jobs(job_id) ON DELETE CASCADE,
	site_id text NOT NULL,
	target_id text NOT NULL,
	normalized_candidate_url text NOT NULL,
	source_host text NOT NULL,
	eligibility_reason text NOT NULL,
	url_hint text,
	title_hint text,
	status text NOT NULL,
	priority_score integer NOT NULL DEFAULT 0,
	created_at timestamptz NOT NULL,
	updated_at timestamptz NOT NULL
)`);
	await client.query(`
CREATE UNIQUE INDEX IF NOT EXISTS official_web_target_candidates_job_url_idx
ON official_web.target_job_candidates (job_id, normalized_candidate_url)`);
	await client.query(`
CREATE INDEX IF NOT EXISTS official_web_target_candidates_site_status_idx
ON official_web.target_job_candidates (site_id, status, priority_score)`);
	await client.query(`
CREATE TABLE IF NOT EXISTS official_web.target_page_attempts (
	attempt_id text PRIMARY KEY,
	job_id text NOT NULL REFERENCES official_web.target_jobs(job_id) ON DELETE CASCADE,
	candidate_id text REFERENCES official_web.target_job_candidates(candidate_id) ON DELETE SET NULL,
	run_id text REFERENCES official_web.crawl_runs(run_id) ON DELETE SET NULL,
	site_id text NOT NULL,
	target_id text NOT NULL,
	normalized_canonical_url text NOT NULL,
	attempt_status text NOT NULL,
	http_status integer,
	artifact_object_key text,
	attempted_at timestamptz NOT NULL,
	completed_at timestamptz,
	created_at timestamptz NOT NULL,
	updated_at timestamptz NOT NULL
)`);
	await client.query(`
CREATE INDEX IF NOT EXISTS official_web_target_attempts_job_attempted_idx
ON official_web.target_page_attempts (job_id, attempted_at)`);
	await client.query(`
CREATE INDEX IF NOT EXISTS official_web_target_attempts_run_idx
ON official_web.target_page_attempts (run_id)`);
	await client.query(`
CREATE TABLE IF NOT EXISTS official_web.target_artifact_verification_summaries (
	summary_id text PRIMARY KEY,
	job_id text NOT NULL REFERENCES official_web.target_jobs(job_id) ON DELETE CASCADE,
	run_id text NOT NULL,
	source_handoff_id text,
	object_verification_id text,
	canonical_verification boolean NOT NULL DEFAULT false,
	status text NOT NULL,
	summary_json jsonb NOT NULL,
	created_at timestamptz NOT NULL,
	updated_at timestamptz NOT NULL,
	CONSTRAINT official_web_target_artifact_summary_run_fk
		FOREIGN KEY (run_id) REFERENCES official_web.crawl_runs(run_id) ON DELETE CASCADE
)`);
	await client.query(`
DELETE FROM official_web.target_artifact_verification_summaries
WHERE run_id IS NULL`);
	await client.query(`
ALTER TABLE official_web.target_artifact_verification_summaries
ALTER COLUMN run_id SET NOT NULL`);
	await client.query(`
ALTER TABLE official_web.target_artifact_verification_summaries
DROP CONSTRAINT IF EXISTS target_artifact_verification_summaries_run_id_fkey`);
	await client.query(`
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'official_web_target_artifact_summary_run_fk'
			AND conrelid = 'official_web.target_artifact_verification_summaries'::regclass
	) THEN
		ALTER TABLE official_web.target_artifact_verification_summaries
		ADD CONSTRAINT official_web_target_artifact_summary_run_fk
			FOREIGN KEY (run_id) REFERENCES official_web.crawl_runs(run_id) ON DELETE CASCADE;
	END IF;
END $$`);
	await client.query(`
CREATE UNIQUE INDEX IF NOT EXISTS official_web_target_artifact_summary_job_run_idx
ON official_web.target_artifact_verification_summaries (job_id, run_id)`);
	await client.query(`
CREATE INDEX IF NOT EXISTS official_web_target_artifact_summary_canonical_idx
ON official_web.target_artifact_verification_summaries (canonical_verification, updated_at)`);
	await client.query(`
CREATE TABLE IF NOT EXISTS operator.official_web_run_projection (
	run_id text PRIMARY KEY,
	site_id text NOT NULL,
	run_intent text NOT NULL DEFAULT 'baseline',
	status text NOT NULL,
	ingestion_dispatch_status text NOT NULL,
	ingestion_dispatch_ref text,
	ingestion_execution_status text NOT NULL DEFAULT 'pending',
	ingestion_execution_ref text,
	ingestion_execution_updated_at timestamptz,
	ingestion_execution_error_code text,
	ingestion_execution_error_message text,
	source_adapter_version text,
	config_version text,
	started_at timestamptz NOT NULL,
	finished_at timestamptz,
	last_heartbeat_at timestamptz,
	failure_count integer NOT NULL DEFAULT 0,
	summary_json jsonb,
	artifacts_json jsonb NOT NULL,
	projected_at timestamptz NOT NULL
)`);
	await client.query(`
CREATE INDEX IF NOT EXISTS operator_official_web_run_projection_site_started_at_idx
ON operator.official_web_run_projection (site_id, started_at)`);
	await client.query(`
CREATE INDEX IF NOT EXISTS operator_official_web_run_projection_status_started_at_idx
ON operator.official_web_run_projection (status, started_at)`);
	await client.query(`
CREATE INDEX IF NOT EXISTS operator_official_web_run_projection_dispatch_started_at_idx
ON operator.official_web_run_projection (ingestion_dispatch_status, started_at)`);
	await client.query(`
CREATE TABLE IF NOT EXISTS operator.official_web_site_projection (
	site_id text PRIMARY KEY,
	display_name text NOT NULL,
	host_roots_json jsonb NOT NULL,
	latest_run_id text,
	latest_run_status text,
	last_success_at timestamptz,
	last_failure_at timestamptz,
	latest_source_adapter_version text,
	latest_config_version text,
	latest_ingestion_dispatch_status text,
	latest_ingestion_execution_status text,
	latest_ingestion_execution_updated_at timestamptz,
	latest_ingestion_execution_error_code text,
	projected_at timestamptz NOT NULL
)`);
	await client.query(`
CREATE INDEX IF NOT EXISTS operator_official_web_site_projection_status_projected_at_idx
ON operator.official_web_site_projection (latest_run_status, projected_at)`);
}
