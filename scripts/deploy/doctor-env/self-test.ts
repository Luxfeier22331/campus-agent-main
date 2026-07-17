import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { collectEnvDoctorStatus } from "./core.ts";
import { surfaceSpecs } from "./specs.ts";

export function runDoctorEnvSelfTest(): number {
	const renderedSpecs = JSON.stringify(surfaceSpecs);
	expect(!renderedSpecs.includes("PROMPT_RUNTIME_"), "retired prompt runtime key leaked");
	expect(
		!renderedSpecs.includes("EXECUTION_PROMPT_MODEL"),
		"retired execution prompt model leaked",
	);
	expect(!renderedSpecs.includes("INTERNAL_NOTICE_"), "retired internal notice runtime leaked");
	selfTestExecutionControlReady();
	selfTestExecutionControlMissing();
	selfTestQuerySurface();
	selfTestWorkerObservabilityLocalSurface();
	selfTestIngestionBucketScopedCredentials();
	selfTestWorkerStagingSurface();
	console.log("doctor_env self-test passed.");
	return 0;
}

function selfTestExecutionControlReady(): void {
	withFixture((root) => {
		writeText(
			join(root, ".env"),
			`${[
				...executionControlRequiredEnv(),
				"EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET=query-secret",
			].join("\n")}\n`,
		);
		writeExecutionControlRuntimeConfig(root);
		const status = collectEnvDoctorStatus({ env: {}, root, surface: "execution-control" });
		expectEqual(status.overall_ready, true, "execution-control should be ready");
		expectEqual(
			status.settings.required.run_projection_database_url.resolved_key,
			"EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL",
			"run projection env key mismatch",
		);
	});
}

function selfTestExecutionControlMissing(): void {
	withFixture((root) => {
		writeText(join(root, ".env"), "LLM_API_KEY=shared-llm-secret\n");
		const status = collectEnvDoctorStatus({ env: {}, root, surface: "execution-control" });
		expectEqual(status.overall_ready, false, "missing execution-control env should not be ready");
		expectEqual(
			status.settings.required.temporal_address.present,
			false,
			"temporal address should be missing",
		);
	});
}

function selfTestQuerySurface(): void {
	withFixture((root) => {
		writeText(
			join(root, ".env"),
			`${[
				"LLM_API_KEY=shared-llm-secret",
				"EMBEDDING_API_KEY=shared-embed-secret",
				"CAMPUS_SHARED_POSTGRES_URL=postgresql://session.example/postgres",
			].join("\n")}\n`,
		);
		writeText(
			join(root, "apps/app-api/.env"),
			`${[
				"CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB=postgresql://app-api-local/postgres",
				"APP_API_SCHEMA_DATABASE_URL=postgresql://app-api-schema-admin/postgres",
			].join("\n")}\n`,
		);
		writeText(
			join(root, "apps/app-api/.dev.vars"),
			`${[
				"BETTER_AUTH_SECRET=dev-secret-dev-secret-dev-secret",
				"AUTH_SHELL_ORIGIN=https://campus.example.com",
				"EXECUTION_CONTROL_BASE_URL=https://execution-control.internal",
				"EXECUTION_CONTROL_SHARED_SECRET=shared-secret",
				"APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST=example.edu",
				"APP_API_PRODUCT_CALLBACK_SHARED_SECRET=product-callback-secret",
			].join("\n")}\n`,
		);
		const status = collectEnvDoctorStatus({ env: {}, root, surface: "query" });
		expectEqual(status.overall_ready, true, "query surface should be ready");
		expectEqual(status.postgres.shared.source, "repo_env", "query postgres source mismatch");
	});
}

function selfTestWorkerObservabilityLocalSurface(): void {
	withFixture((root) => {
		writeText(
			join(root, "apps/app-api/.dev.vars"),
			`${[
				"SENTRY_DSN=https://shared.example",
				"SENTRY_ENVIRONMENT=development",
				"SENTRY_RELEASE=app-api@dev-local",
			].join("\n")}\n`,
		);
		writeText(
			join(root, "apps/campus-web/.dev.vars"),
			`${[
				"SENTRY_BROWSER_DSN=https://browser.example",
				"SENTRY_DSN=https://shared.example",
				"SENTRY_ENVIRONMENT=development",
				"SENTRY_RELEASE=campus-web@dev-local",
			].join("\n")}\n`,
		);
		const status = collectEnvDoctorStatus({
			env: {},
			root,
			surface: "worker-observability-local",
		});
		expectEqual(status.overall_ready, true, "worker observability local surface should be ready");
		expectEqual(
			status.files["apps/app-api/.dev.vars"]?.ready,
			true,
			"app-api observability env should be ready",
		);
	});
	withFixture((root) => {
		writeText(join(root, "apps/app-api/.dev.vars"), "SENTRY_DSN=https://shared.example\n");
		const status = collectEnvDoctorStatus({
			env: {},
			root,
			surface: "worker-observability-local",
		});
		expectEqual(
			status.overall_ready,
			false,
			"missing worker observability env should not be ready",
		);
		expect(
			String(status.files["apps/app-api/.dev.vars"]?.missing_keys).includes("SENTRY_ENVIRONMENT"),
			"missing app-api Sentry environment was not reported",
		);
	});
}

function selfTestIngestionBucketScopedCredentials(): void {
	withFixture((root) => {
		writeText(
			join(root, ".env"),
			`${[
				"EMBEDDING_API_KEY=shared-embed-secret",
				"OBJECT_STORE_ENDPOINT=https://s3.cstcloud.cn",
				"OBJECT_STORE_SOURCE_ACCESS_KEY=source-ak",
				"OBJECT_STORE_SOURCE_SECRET_KEY=source-sk",
				"OBJECT_STORE_DERIVED_ACCESS_KEY=derived-ak",
				"OBJECT_STORE_DERIVED_SECRET_KEY=derived-sk",
				"DOCUMENT_REGISTRY_DATABASE_URL=postgresql://registry.example/postgres",
			].join("\n")}\n`,
		);
		const status = collectEnvDoctorStatus({ env: {}, root, surface: "ingestion" });
		expectEqual(status.overall_ready, true, "ingestion surface should be ready");
		expectEqual(
			status.settings.required.object_store_credentials.resolved_key,
			"bucket_scoped:OBJECT_STORE_SOURCE_ACCESS_KEY+OBJECT_STORE_SOURCE_SECRET_KEY;OBJECT_STORE_DERIVED_ACCESS_KEY+OBJECT_STORE_DERIVED_SECRET_KEY",
			"bucket-scoped object store credential source mismatch",
		);
	});
}

function selfTestWorkerStagingSurface(): void {
	withFixture((root) => {
		const status = collectEnvDoctorStatus({
			env: {
				SENTRY_APP_API_PROJECT_SLUG: "app-api",
				SENTRY_AUTH_TOKEN: "sentry-token",
				SENTRY_ORG_SLUG: "muc-wiki",
				STAGING_APP_API_SENTRY_DSN: "https://public@example.ingest.sentry.io/1",
				STAGING_APP_API_DB_FRESH_HYPERDRIVE_ID: "22222222-2222-4222-8222-222222222222",
				STAGING_APP_API_DB_HYPERDRIVE_ID: "11111111-1111-4111-8111-111111111111",
				STAGING_EXECUTION_CONTROL_VPC_SERVICE_ID: "33333333-3333-4333-8333-333333333333",
			},
			root,
			surface: "worker-staging-app-api",
		});
		expectEqual(status.overall_ready, true, "worker staging app-api surface should be ready");
	});
	withFixture((root) => {
		const status = collectEnvDoctorStatus({
			env: {
				SENTRY_APP_API_PROJECT_SLUG: "app-api",
				SENTRY_AUTH_TOKEN: "sentry-token",
				STAGING_APP_API_SENTRY_DSN: "https://public@example.ingest.sentry.io/1",
				STAGING_APP_API_DB_FRESH_HYPERDRIVE_ID: "22222222-2222-4222-8222-222222222222",
				STAGING_APP_API_DB_HYPERDRIVE_ID: "11111111-1111-4111-8111-111111111111",
				STAGING_EXECUTION_CONTROL_VPC_SERVICE_ID: "33333333-3333-4333-8333-333333333333",
			},
			root,
			surface: "worker-staging-app-api",
		});
		expectEqual(status.overall_ready, false, "missing Sentry org slug should block app-api upload");
	});
	withFixture((root) => {
		const status = collectEnvDoctorStatus({
			env: {
				SENTRY_AUTH_TOKEN: "sentry-token",
				SENTRY_CAMPUS_WEB_PROJECT_SLUG: "campus-web",
				SENTRY_ORG_SLUG: "muc-wiki",
				STAGING_CAMPUS_AUTH_TURNSTILE_SITE_KEY: "staging-turnstile-site-key",
				STAGING_CAMPUS_WEB_BROWSER_SENTRY_DSN: "https://browser@example.ingest.sentry.io/1",
				STAGING_CAMPUS_WEB_EDGE_SENTRY_DSN: "https://edge@example.ingest.sentry.io/1",
				STAGING_MAP_DATA_BUCKET_NAME: "campus-agent-derived-staging",
			},
			root,
			surface: "worker-staging-campus-web",
		});
		expectEqual(status.overall_ready, true, "worker staging campus-web surface should be ready");
	});
}

function executionControlRequiredEnv(): string[] {
	return [
		"EXECUTION_CONTROL_RUNTIME_CONFIG_PATH=configs/runtime/execution-control/runtime-config.staging.json",
		"EXECUTION_CONTROL_SHARED_SECRET=control-secret",
		"EXECUTION_CONTROL_METRICS_BEARER_TOKEN=metrics-token",
		"EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL=postgresql://runtime.example/campus_agent",
		"EXECUTION_CONTROL_TEMPORAL_ADDRESS=temporal:7233",
		"EXECUTION_CONTROL_TEMPORAL_NAMESPACE=campus-agent-staging",
		"EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE=campus-agent.workflow",
		"EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY=staging:execution-control:001",
		"EXECUTION_CONTROL_TEMPORAL_WORKFLOW_WORKER_IDENTITY=staging:workflow-worker:001",
		"EXECUTION_CONTROL_TEMPORAL_CORE_WORKER_IDENTITY=staging:activity-core:001",
		"EXECUTION_CONTROL_TEMPORAL_AGENT_WORKER_IDENTITY=staging:activity-agent:001",
		"EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS=5000",
	];
}

function writeExecutionControlRuntimeConfig(root: string): void {
	writeText(
		join(root, "configs/runtime/execution-control/runtime-config.staging.json"),
		`${JSON.stringify({
			schema_version: "campus_execution_control_runtime_config.v1",
		})}\n`,
	);
}

function withFixture(callback: (root: string) => void): void {
	const root = mkdtempSync(join(tmpdir(), "doctor-env-"));
	try {
		callback(join(root, "campus-agent"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function writeText(path: string, text: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, text, "utf8");
}

function expect(condition: boolean, message: string): void {
	if (!condition) {
		throw new Error(message);
	}
}

function expectEqual(actual: unknown, expected: unknown, message: string): void {
	if (actual !== expected) {
		throw new Error(
			`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
		);
	}
}
