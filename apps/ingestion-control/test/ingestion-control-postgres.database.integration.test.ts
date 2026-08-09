// @vitest-environment node

import { randomBytes, randomUUID } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import { Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	applyIngestionControlMigrations,
	loadIngestionControlMigrations,
	runIngestionControlMigrations,
} from "../src/migrate";
import { runIngestionControlSchemaBootstrap } from "../src/schema-bootstrap";

const POSTGRES_IMAGE =
	"postgres:17-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193";
const RYUK_IMAGE =
	"testcontainers/ryuk:0.14.0@sha256:7c1a8a9a47c780ed0f983770a662f80deb115d95cce3e2daa3d12115b8cd28f0";
const DATABASE_NAME = "campus_agent_ingestion_test";

function roleConnectionString(connectionString: string, password: string): string {
	const url = new URL(connectionString);
	url.username = "ingestion_control";
	url.password = password;
	return url.toString();
}

describe("ingestion-control PostgreSQL lifecycle", () => {
	let adminConnectionString = "";
	let container: StartedPostgreSqlContainer;
	let runtimeConnectionString = "";

	beforeAll(async () => {
		process.env.RYUK_CONTAINER_IMAGE = RYUK_IMAGE;
		container = await new PostgreSqlContainer(POSTGRES_IMAGE)
			.withResourcesQuota({ cpu: 1, memory: 0.5 })
			.withDatabase(DATABASE_NAME)
			.withUsername("postgres")
			.withPassword(randomUUID())
			.withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/u, 2))
			.start();
		adminConnectionString = container.getConnectionUri();
		const password = randomBytes(24).toString("hex");
		const admin = new Client({ connectionString: adminConnectionString, ssl: false });
		await admin.connect();
		try {
			await admin.query(`CREATE ROLE ingestion_control LOGIN PASSWORD '${password}'`);
		} finally {
			await admin.end();
		}
		runtimeConnectionString = roleConnectionString(adminConnectionString, password);
	}, 180_000);

	afterAll(async () => {
		await container?.stop();
	}, 60_000);

	it("bootstraps, migrates idempotently, and limits the application role to its schema", async () => {
		const localEnvironment = {
			DEPLOYMENT_ENVIRONMENT: "local",
			INGESTION_CONTROL_DATABASE_SSLMODE: "disable",
			INGESTION_CONTROL_DATABASE_URL: runtimeConnectionString,
			INGESTION_CONTROL_SCHEMA_DATABASE_SSLMODE: "disable",
			INGESTION_CONTROL_SCHEMA_DATABASE_URL: adminConnectionString,
		};

		await runIngestionControlSchemaBootstrap(localEnvironment);
		await runIngestionControlSchemaBootstrap(localEnvironment);
		const migrations = loadIngestionControlMigrations();
		const preResetClient = new Client({ connectionString: runtimeConnectionString, ssl: false });
		await preResetClient.connect();
		try {
			await expect(
				applyIngestionControlMigrations(preResetClient, migrations.slice(0, -3)),
			).resolves.toEqual([
				"0001_tasks.sql",
				"0002_offline_releases.sql",
				"0003_offline_release_checks.sql",
			]);
			await preResetClient.query(`INSERT INTO ingestion_control.offline_release_streams (
				stream_id,
				source_channel,
				source_surface,
				corpus,
				collection,
				checkpoint_json,
				version,
				created_at,
				updated_at,
				last_check_at,
				last_check_mode,
				last_check_outcome,
				last_check_error_code,
				last_reconcile_at,
				last_published_at,
				last_added_count,
				last_updated_count,
				last_withdrawn_count
			) VALUES (
				'internal_portal:migration-reset:notice',
				'internal_portal',
				'notice',
				'campus_notices',
				'internal_notice',
				'{"legacy":true}'::jsonb,
				7,
				'2026-07-24T00:00:00Z',
				'2026-07-24T01:00:00Z',
				'2026-07-24T01:00:00Z',
				'reconcile',
				'published',
				'legacy_status',
				'2026-07-24T01:00:00Z',
				'2026-07-24T01:00:00Z',
				3,
				2,
				1
			)`);
			await preResetClient.query(`INSERT INTO ingestion_control.offline_releases (
				release_id,
				stream_id,
				previous_release_id,
				run_id,
				workflow_id,
				workflow_run_id,
				manifest_ref_json,
				item_count,
				committed_at
			) VALUES (
				'release:migration-reset:v7',
				'internal_portal:migration-reset:notice',
				NULL,
				'migration-reset',
				'ingestion/migration-reset',
				'migration-reset',
				'{"kind":"object_store"}'::jsonb,
				3,
				'2026-07-24T01:00:00Z'
			)`);
			await preResetClient.query(`UPDATE ingestion_control.offline_release_streams
				SET current_release_id = 'release:migration-reset:v7'
				WHERE stream_id = 'internal_portal:migration-reset:notice'`);
			await preResetClient.query(`INSERT INTO ingestion_control.offline_release_streams (
				stream_id,
				source_channel,
				source_surface,
				corpus,
				collection,
				checkpoint_json,
				version,
				created_at,
				updated_at,
				last_check_at,
				last_check_mode,
				last_check_outcome,
				last_check_error_code,
				last_reconcile_at,
				last_added_count,
				last_updated_count,
				last_withdrawn_count
			) VALUES (
				'internal_portal:migration-reset:file-release',
				'internal_portal',
				'file_release',
				'authenticated_documents',
				'file_release_source',
				'{"file_release":646}'::jsonb,
				3,
				'2026-07-24T00:00:00Z',
				'2026-07-24T01:00:00Z',
				'2026-07-24T01:00:00Z',
				'reconcile',
				'failed',
				'legacy_reconcile_failed',
				'2026-07-24T01:00:00Z',
				4,
				3,
					2
				)`);
			await expect(
				applyIngestionControlMigrations(preResetClient, migrations.slice(0, -2)),
			).resolves.toEqual(["0004_internal_portal_ingestion_reset.sql"]);
			await preResetClient.query(`INSERT INTO ingestion_control.internal_portal_notice_sync_state (
				site_id,
				notice_type,
				incremental_head_id,
				min_captured_id,
				max_captured_id,
				history_covered_from,
				updated_at
			) VALUES (
				'muc_internal_portal',
				'5',
				355120,
				350001,
				355120,
				'2026-01-01',
				'2026-07-26T00:00:00Z'
			)`);
			await preResetClient.query(`INSERT INTO ingestion_control.tasks (
				task_id,
				run_id,
				registry_task_id,
				executor_kind,
				source_family,
				source_channel,
				corpus,
				collection,
				input_ref_json,
				input_contract,
				output_contract,
				created_by,
				created_at,
				status,
				workflow_id,
				workflow_run_id,
				pipeline_workflow_id,
				updated_at
			) VALUES
				(
					'legacy-source-task',
					'legacy-source-run',
					'internal_portal.file_release.capture',
					'source_collector',
					'authenticated_documents',
					'internal_portal',
					NULL,
					NULL,
					'{"kind":"object_store"}'::jsonb,
					'internal_portal_file_release_capture_request.v2',
					'internal_portal_file_release_capture_result.v2',
					'legacy:test',
					'2026-07-26T00:00:00Z',
					'running',
					'ingestion/legacy-source-task',
					'legacy-source-workflow-run',
					NULL,
					'2026-07-26T00:00:00Z'
				),
				(
					'legacy-pipeline-task',
					'legacy-pipeline-run',
					'curriculum.curriculum_plan.chunk_prepare',
					'rust_kernel',
					NULL,
					NULL,
					'curriculum',
					'curriculum_plan',
					'{"kind":"object_store"}'::jsonb,
					'canonical_document_units.v1',
					'ingestion_chunk_set.v1',
					'legacy:test',
					'2026-07-26T00:00:00Z',
					'running',
					'ingestion/legacy-pipeline-task',
					'legacy-pipeline-workflow-run',
					'ingestion/internal-portal-file-release/legacy-pipeline-run',
					'2026-07-26T00:00:00Z'
				),
				(
					'retained-rust-task',
					'retained-rust-run',
					'curriculum.curriculum_plan.chunk_prepare',
					'rust_kernel',
					NULL,
					NULL,
					'curriculum',
					'curriculum_plan',
					'{"kind":"object_store"}'::jsonb,
					'canonical_document_units.v1',
					'ingestion_chunk_set.v1',
					'operator:test',
					'2026-07-26T00:00:00Z',
					'running',
					'ingestion/retained-rust-task',
					'retained-rust-workflow-run',
					NULL,
					'2026-07-26T00:00:00Z'
				)`);

			await expect(
				applyIngestionControlMigrations(preResetClient, migrations.slice(0, -1)),
			).resolves.toEqual(["0005_remove_internal_portal_pipeline.sql"]);
			await preResetClient.query(`INSERT INTO ingestion_control.tasks (
				task_id,
				run_id,
				registry_task_id,
				executor_kind,
				input_ref_json,
				input_contract,
				output_contract,
				created_by,
				created_at,
				status,
				workflow_id,
				workflow_run_id,
				updated_at,
				error_code,
				error_message
			) VALUES (
				'legacy-invalid-error-code',
				'legacy-invalid-error-run',
				'curriculum.curriculum_plan.chunk_prepare',
				'rust_kernel',
				'{"kind":"object_store"}'::jsonb,
				'canonical_document_units.v1',
				'ingestion_chunk_set.v1',
				'legacy:test',
				'2026-07-26T00:00:00Z',
				'failed',
				'ingestion/legacy-invalid-error-code',
				'legacy-invalid-error-workflow-run',
				'2026-07-26T00:00:00Z',
				'legacy error code with spaces',
				'legacy provider response must not survive migration'
			)`);
		} finally {
			await preResetClient.end();
		}

		await expect(runIngestionControlMigrations(localEnvironment)).resolves.toEqual([
			"0006_remove_error_message.sql",
		]);
		await expect(runIngestionControlMigrations(localEnvironment)).resolves.toEqual([]);

		const runtime = new Client({ connectionString: runtimeConnectionString, ssl: false });
		await runtime.connect();
		try {
			const retired = await runtime.query<{
				noticeSyncState: string | null;
				offlineReleases: string | null;
				offlineReleaseStreams: string | null;
				seedState: string | null;
				urlFreshness: string | null;
			}>(`SELECT
				to_regclass('ingestion_control.official_web_seed_state')::text AS "seedState",
				to_regclass('ingestion_control.official_web_url_freshness')::text AS "urlFreshness",
				to_regclass('ingestion_control.offline_release_streams')::text AS "offlineReleaseStreams",
				to_regclass('ingestion_control.offline_releases')::text AS "offlineReleases",
				to_regclass('ingestion_control.internal_portal_notice_sync_state')::text AS "noticeSyncState"`);
			expect(retired.rows[0]).toEqual({
				noticeSyncState: null,
				offlineReleases: null,
				offlineReleaseStreams: null,
				seedState: null,
				urlFreshness: null,
			});

			const taskRows = await runtime.query<{
				executorKind: string;
				taskId: string;
			}>(`SELECT task_id AS "taskId", executor_kind AS "executorKind"
				FROM ingestion_control.tasks
				ORDER BY task_id`);
			expect(taskRows.rows).toEqual([
				{ executorKind: "rust_kernel", taskId: "legacy-invalid-error-code" },
				{ executorKind: "rust_kernel", taskId: "retained-rust-task" },
			]);
			const normalizedLegacyError = await runtime.query<{
				errorCode: string;
			}>(`SELECT error_code AS "errorCode"
				FROM ingestion_control.tasks
				WHERE task_id = 'legacy-invalid-error-code'`);
			expect(normalizedLegacyError.rows[0]).toEqual({ errorCode: "legacy_error" });
			const pipelineColumn = await runtime.query<{
				count: number;
			}>(`SELECT count(*)::integer AS count
				FROM information_schema.columns
				WHERE table_schema = 'ingestion_control'
				  AND table_name = 'tasks'
				  AND column_name = 'pipeline_workflow_id'`);
			expect(pipelineColumn.rows[0]).toEqual({ count: 0 });
			const errorMessageColumn = await runtime.query<{
				count: number;
			}>(`SELECT count(*)::integer AS count
				FROM information_schema.columns
				WHERE table_schema = 'ingestion_control'
				  AND table_name = 'tasks'
				  AND column_name = 'error_message'`);
			expect(errorMessageColumn.rows[0]).toEqual({ count: 0 });
			await expect(
				runtime.query(`INSERT INTO ingestion_control.tasks (
					task_id, run_id, registry_task_id, executor_kind,
					source_family, source_channel, corpus, collection,
					input_ref_json, input_contract, output_contract, created_by, created_at,
					status, workflow_id, workflow_run_id, updated_at
				) VALUES (
					'retired-source-task', 'retired-source-run',
					'internal_portal.file_release.capture', 'source_collector',
					'authenticated_documents', 'internal_portal', NULL, NULL,
					'{"kind":"object_store"}'::jsonb,
					'internal_portal_file_release_capture_request.v2',
					'internal_portal_file_release_capture_result.v2',
					'operator:test', '2026-07-26T00:00:00Z', 'running',
					'ingestion/retired-source-task', 'retired-source-workflow-run',
					'2026-07-26T00:00:00Z'
				)`),
			).rejects.toThrow("tasks_executor_kind_check");

			await expect(
				runtime.query(`INSERT INTO ingestion_control.tasks (
					task_id, run_id, registry_task_id, executor_kind,
					input_ref_json, input_contract, output_contract, created_by, created_at,
					status, workflow_id, workflow_run_id, updated_at, error_code
				) VALUES (
					'invalid-error-code-task', 'invalid-error-code-run',
					'curriculum.curriculum_plan.chunk_prepare', 'rust_kernel',
					'{"kind":"object_store"}'::jsonb,
					'canonical_document_units.v1', 'ingestion_chunk_set.v1', 'operator:test',
					'2026-07-26T00:00:00Z', 'failed',
					'ingestion/invalid-error-code-task', 'invalid-error-code-workflow-run',
					'2026-07-26T00:00:00Z', 'invalid error code'
				)`),
			).rejects.toThrow("tasks_error_code_format_check");

			await expect(
				runtime.query("CREATE TABLE ingestion_control.permission_probe (id integer PRIMARY KEY)"),
			).resolves.toMatchObject({ command: "CREATE" });
			await expect(runtime.query("CREATE SCHEMA forbidden_probe")).rejects.toThrow(
				"permission denied for database",
			);
		} finally {
			await runtime.end();
		}
	});
});
