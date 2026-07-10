import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../..");
const defaultStagingEnvFile = "/srv/docker/campus-agent/staging/env/runtime.env";

const requiredStagingEnvKeys = [
	"STAGING_INGESTION_SHARED_POSTGRES_URL",
	"STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL",
	"STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL",
	"STAGING_INGESTION_OBJECT_STORE_ENDPOINT",
	"STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED",
	"STAGING_INGESTION_OBJECT_STORE_REGION",
	"STAGING_INGESTION_EMBEDDING_BASE_URL",
	"STAGING_INGESTION_EMBEDDING_API_KEY",
	"OTEL_COLLECTOR_SENTRY_OTLP_ENDPOINT",
	"OTEL_COLLECTOR_SENTRY_AUTH_VALUE",
	"OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT",
	"OTEL_COLLECTOR_AXIOM_AUTH_HEADER",
	"OTEL_COLLECTOR_AXIOM_EVENTS_DATASET",
	"OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT",
	"OTEL_COLLECTOR_LANGFUSE_AUTH_HEADER",
	"OTEL_COLLECTOR_LANGFUSE_INGESTION_VERSION",
	"EXECUTION_CONTROL_METRICS_BEARER_TOKEN",
	"EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET",
	"EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL",
	"TEMPORAL_POSTGRES_PASSWORD",
	"EXECUTION_CONTROL_TEMPORAL_ADDRESS",
	"EXECUTION_CONTROL_TEMPORAL_NAMESPACE",
	"EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE",
	"EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY",
	"EXECUTION_CONTROL_TEMPORAL_WORKFLOW_WORKER_IDENTITY",
	"EXECUTION_CONTROL_TEMPORAL_CORE_WORKER_IDENTITY",
	"EXECUTION_CONTROL_TEMPORAL_AGENT_WORKER_IDENTITY",
	"EXECUTION_CONTROL_TEMPORAL_KNOWLEDGE_WORKER_IDENTITY",
	"EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS",
];

const objectStoreCredentialSets = [
	[
		"STAGING_INGESTION_OBJECT_STORE_DERIVED_ACCESS_KEY",
		"STAGING_INGESTION_OBJECT_STORE_DERIVED_SECRET_KEY",
	],
	["STAGING_INGESTION_OBJECT_STORE_ACCESS_KEY", "STAGING_INGESTION_OBJECT_STORE_SECRET_KEY"],
];

const expectedStagingValues: Record<string, string> = {
	STAGING_INGESTION_EMBEDDING_BASE_URL: "https://ai.gitee.com/v1",
	EXECUTION_CONTROL_INTERNAL_BASE_URL:
		"http://execution-control.campus-agent-staging.svc.cluster.local:8000",
	EXECUTION_CONTROL_TEMPORAL_ADDRESS: "temporal:7233",
	EXECUTION_CONTROL_TEMPORAL_NAMESPACE: "campus-agent-staging",
	EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE: "campus-agent.workflow",
	EXECUTION_CONTROL_AGENT_RUNTIME_BASE_URL: "http://agent-runtime:27062",
};

const positiveIntegerKeys = ["EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS"];

const urlKeys = [
	"STAGING_INGESTION_SHARED_POSTGRES_URL",
	"STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL",
	"STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL",
	"STAGING_INGESTION_OBJECT_STORE_ENDPOINT",
	"STAGING_INGESTION_QDRANT_URL",
	"STAGING_INGESTION_EMBEDDING_BASE_URL",
	"OTEL_COLLECTOR_SENTRY_OTLP_ENDPOINT",
	"OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT",
	"OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT",
	"EXECUTION_CONTROL_INTERNAL_BASE_URL",
	"EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL",
];

const retiredStagingEnvKeys = [
	"EXECUTION_CONTROL_DURABLE_WORKER_LOOP_ENABLED",
	"EXECUTION_CONTROL_DURABLE_WORKER_LOOP_WORKER_ID",
	"EXECUTION_CONTROL_DURABLE_WORKER_LOOP_LANE",
	"EXECUTION_CONTROL_DURABLE_WORKER_LOOP_STEP_ID",
	"EXECUTION_CONTROL_DURABLE_WORKER_LOOP_POLL_INTERVAL_MS",
	"EXECUTION_CONTROL_DURABLE_WORKER_LOOP_LEASE_TTL_MS",
	"EXECUTION_CONTROL_DURABLE_WORKER_LOOP_LEASE_HEARTBEAT_INTERVAL_MS",
	"EXECUTION_CONTROL_DURABLE_RECOVERY_LOOP_ENABLED",
	"EXECUTION_CONTROL_DURABLE_RECOVERY_LOOP_INTERVAL_MS",
	"EXECUTION_CONTROL_DURABLE_RECOVERY_LOOP_MAX_RETRY_ATTEMPTS",
];

interface PreflightReport {
	blockers: string[];
	repo_root: string;
	staging_env_path: string;
	status: "blocked" | "ready";
}

export function buildTemporalStagingPreflightReport(
	root: string,
	env: Record<string, string | undefined>,
): PreflightReport {
	const configuredEnvPath = env.EXECUTION_CONTROL_STAGING_ENV_FILE?.trim() ?? "";
	const stagingEnvPath = isAbsolute(configuredEnvPath || defaultStagingEnvFile)
		? configuredEnvPath || defaultStagingEnvFile
		: join(root, configuredEnvPath);
	const stagingEnv = parseEnvFile(stagingEnvPath);
	const blockers: string[] = [];
	if (!fileExists(stagingEnvPath)) {
		blockers.push("EXECUTION_CONTROL_STAGING_ENV_FILE");
	}
	blockers.push(...missingRequiredKeys(stagingEnv, requiredStagingEnvKeys));
	blockers.push(...missingRequiredKeys(stagingEnv, ["EXECUTION_CONTROL_SHARED_SECRET"]));
	blockers.push(...invalidContractKeys(stagingEnv));
	if (!hasObjectStoreCredentials(stagingEnv)) {
		blockers.push("STAGING_INGESTION_OBJECT_STORE_CREDENTIAL_PAIR");
	}
	if (!env.CLOUDFLARE_API_TOKEN?.trim()) {
		blockers.push("CLOUDFLARE_API_TOKEN");
	}
	const uniqueBlockers = [...new Set(blockers)].sort();
	return {
		blockers: uniqueBlockers,
		repo_root: root,
		staging_env_path: stagingEnvPath,
		status: uniqueBlockers.length === 0 ? "ready" : "blocked",
	};
}

function parseEnvFile(path: string): Record<string, string> {
	if (!fileExists(path)) {
		return {};
	}
	const values: Record<string, string> = {};
	for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#") || !line.includes("=")) {
			continue;
		}
		const [key = "", ...valueParts] = line.split("=");
		const value = valueParts
			.join("=")
			.trim()
			.replace(/^["']|["']$/g, "");
		if (value) {
			values[key.trim()] = value;
		}
	}
	return values;
}

function missingRequiredKeys(values: Record<string, string>, keys: string[]): string[] {
	return keys.filter((key) => !values[key]);
}

function hasObjectStoreCredentials(values: Record<string, string>): boolean {
	return objectStoreCredentialSets.some((set) => set.every((key) => Boolean(values[key])));
}

function invalidContractKeys(values: Record<string, string>): string[] {
	const invalid: string[] = [];
	for (const [key, expected] of Object.entries(expectedStagingValues)) {
		if (values[key] && values[key] !== expected) {
			invalid.push(key);
		}
	}
	for (const key of positiveIntegerKeys) {
		if (values[key] && !positiveInteger(values[key])) {
			invalid.push(key);
		}
	}
	for (const key of urlKeys) {
		if (values[key] && !validUrl(values[key])) {
			invalid.push(key);
		}
	}
	for (const key of [
		"EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY",
		"EXECUTION_CONTROL_TEMPORAL_WORKFLOW_WORKER_IDENTITY",
		"EXECUTION_CONTROL_TEMPORAL_CORE_WORKER_IDENTITY",
		"EXECUTION_CONTROL_TEMPORAL_AGENT_WORKER_IDENTITY",
		"EXECUTION_CONTROL_TEMPORAL_KNOWLEDGE_WORKER_IDENTITY",
	]) {
		const identity = values[key] ?? "";
		if (identity && identity.split(":").length - 1 < 2) {
			invalid.push(key);
		}
	}
	for (const key of retiredStagingEnvKeys) {
		if (values[key]) {
			invalid.push(key);
		}
	}
	invalid.push(...invalidQdrantOverrideKeys(values));
	if (
		[
			"STAGING_INGESTION_OBJECT_STORE_ENDPOINT",
			"STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED",
			"STAGING_INGESTION_OBJECT_STORE_REGION",
		].every((key) => values[key]) &&
		!validObjectStoreProfile(values)
	) {
		invalid.push("STAGING_INGESTION_OBJECT_STORE_PROFILE");
	}
	invalid.push(...invalidObservabilityKeys(values));
	return invalid;
}

function invalidQdrantOverrideKeys(values: Record<string, string>): string[] {
	const qdrantKeys = [
		"STAGING_INGESTION_QDRANT_URL",
		"STAGING_INGESTION_QDRANT_API_KEY",
		"STAGING_INGESTION_QDRANT_READ_ONLY_API_KEY",
		"STAGING_INGESTION_QDRANT_TLS_CA_CERT_PATH",
	];
	if (!qdrantKeys.some((key) => values[key])) {
		return [];
	}
	const invalid = [
		"STAGING_INGESTION_QDRANT_URL",
		"STAGING_INGESTION_QDRANT_API_KEY",
		"STAGING_INGESTION_QDRANT_READ_ONLY_API_KEY",
	].filter((key) => !values[key]);
	const qdrantUrl = values.STAGING_INGESTION_QDRANT_URL ?? "";
	if (!validUrl(qdrantUrl)) {
		return invalid;
	}
	const parsed = new URL(qdrantUrl);
	if (parsed.protocol === "https:") {
		if (!values.STAGING_INGESTION_QDRANT_TLS_CA_CERT_PATH) {
			invalid.push("STAGING_INGESTION_QDRANT_TLS_CA_CERT_PATH");
		}
		return invalid;
	}
	if (
		parsed.protocol === "http:" &&
		["qdrant", "127.0.0.1", "localhost"].includes(parsed.hostname)
	) {
		return invalid;
	}
	invalid.push("STAGING_INGESTION_QDRANT_URL");
	return invalid;
}

function invalidObservabilityKeys(values: Record<string, string>): string[] {
	const invalid: string[] = [];
	const axiomEndpoint = values.OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT ?? "";
	if (
		axiomEndpoint
			.replace(/^https?:\/\//u, "")
			.replace(/\/$/u, "")
			.includes("/")
	) {
		invalid.push("OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT");
	}
	if (values.OTEL_COLLECTOR_AXIOM_EVENTS_DATASET !== "campus-agent-runtime") {
		invalid.push("OTEL_COLLECTOR_AXIOM_EVENTS_DATASET");
	}
	const axiomAuth = values.OTEL_COLLECTOR_AXIOM_AUTH_HEADER ?? "";
	if (axiomAuth && !axiomAuth.startsWith("Bearer ")) {
		invalid.push("OTEL_COLLECTOR_AXIOM_AUTH_HEADER");
	}
	const sentryAuth = values.OTEL_COLLECTOR_SENTRY_AUTH_VALUE ?? "";
	if (sentryAuth && !sentryAuth.startsWith("sentry sentry_key=")) {
		invalid.push("OTEL_COLLECTOR_SENTRY_AUTH_VALUE");
	}
	const langfuseEndpoint = values.OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT ?? "";
	if (langfuseEndpoint && !langfuseEndpoint.replace(/\/$/u, "").endsWith("/api/public/otel")) {
		invalid.push("OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT");
	}
	const langfuseAuth = values.OTEL_COLLECTOR_LANGFUSE_AUTH_HEADER ?? "";
	if (langfuseAuth && !langfuseAuth.startsWith("Basic ")) {
		invalid.push("OTEL_COLLECTOR_LANGFUSE_AUTH_HEADER");
	}
	const langfuseVersion = values.OTEL_COLLECTOR_LANGFUSE_INGESTION_VERSION ?? "";
	if (langfuseVersion && langfuseVersion !== "4") {
		invalid.push("OTEL_COLLECTOR_LANGFUSE_INGESTION_VERSION");
	}
	return invalid;
}

function validObjectStoreProfile(values: Record<string, string>): boolean {
	const endpoint = values.STAGING_INGESTION_OBJECT_STORE_ENDPOINT ?? "";
	if (!validUrl(endpoint)) {
		return false;
	}
	const parsed = new URL(endpoint);
	if (
		parsed.protocol === "http:" &&
		["127.0.0.1", "localhost"].includes(parsed.hostname) &&
		values.STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED === "campus-agent-derived" &&
		values.STAGING_INGESTION_OBJECT_STORE_REGION === "us-east-1"
	) {
		return true;
	}
	return (
		parsed.protocol === "https:" &&
		parsed.hostname.endsWith(".r2.cloudflarestorage.com") &&
		values.STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED === "campus-agent-derived-staging" &&
		values.STAGING_INGESTION_OBJECT_STORE_REGION === "auto"
	);
}

function positiveInteger(value: string): boolean {
	const parsed = Number.parseInt(value, 10);
	return Number.isInteger(parsed) && parsed > 0 && String(parsed) === value;
}

function validUrl(value: string): boolean {
	try {
		const parsed = new URL(value);
		return Boolean(parsed.protocol && parsed.host);
	} catch {
		return false;
	}
}

function fileExists(path: string): boolean {
	try {
		readFileSync(path);
		return true;
	} catch {
		return false;
	}
}

function parseArgs(argv: string[]): { json: boolean; repoRoot: string; selfTest: boolean } {
	let json = false;
	let root = repoRoot;
	let selfTest = false;
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--json") {
			json = true;
			continue;
		}
		if (arg === "--self-test") {
			selfTest = true;
			continue;
		}
		if (arg === "--repo-root") {
			const value = argv[index + 1];
			if (!value) {
				throw new Error("--repo-root requires a value");
			}
			root = resolve(value);
			index += 1;
			continue;
		}
		throw new Error(`unsupported argument: ${arg}`);
	}
	return { json, repoRoot: root, selfTest };
}

function main(argv: string[]): number {
	const args = parseArgs(argv);
	if (args.selfTest) {
		runSelfTest();
		console.log("check_temporal_staging_preflight self-test passed.");
		return 0;
	}
	const report = buildTemporalStagingPreflightReport(args.repoRoot, process.env);
	if (args.json) {
		console.log(JSON.stringify(report, null, 2));
	} else if (report.status === "ready") {
		console.log("Temporal execution-control staging preflight: ready");
	} else {
		console.error("Temporal execution-control staging preflight: blocked");
		for (const blocker of report.blockers) {
			console.error(`  - ${blocker}`);
		}
	}
	return report.status === "ready" ? 0 : 1;
}

const validStagingEnv = `
STAGING_INGESTION_SHARED_POSTGRES_URL=postgresql://runtime@example/campus_agent
STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL=postgresql://registry@example/campus_agent
STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL=postgresql://raw@example/campus_agent
STAGING_INGESTION_OBJECT_STORE_ENDPOINT=https://5943f31433be5dd57beb3bb92bd1c660.r2.cloudflarestorage.com
STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED=campus-agent-derived-staging
STAGING_INGESTION_OBJECT_STORE_REGION=auto
STAGING_INGESTION_OBJECT_STORE_DERIVED_ACCESS_KEY=access
STAGING_INGESTION_OBJECT_STORE_DERIVED_SECRET_KEY=secret
STAGING_INGESTION_EMBEDDING_BASE_URL=https://ai.gitee.com/v1
STAGING_INGESTION_EMBEDDING_API_KEY=embedding-key
OTEL_COLLECTOR_SENTRY_OTLP_ENDPOINT=https://o4511127794155520.ingest.us.sentry.io/api/4511351503454208/integration/otlp
OTEL_COLLECTOR_SENTRY_AUTH_VALUE=sentry sentry_key=key
OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT=https://us-east-1.aws.edge.axiom.co
OTEL_COLLECTOR_AXIOM_AUTH_HEADER=Bearer axiom-ingest-token
OTEL_COLLECTOR_AXIOM_EVENTS_DATASET=campus-agent-runtime
OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT=https://langfuse.internal/api/public/otel
OTEL_COLLECTOR_LANGFUSE_AUTH_HEADER=Basic cGstbGY6c2stbGY=
OTEL_COLLECTOR_LANGFUSE_INGESTION_VERSION=4
EXECUTION_CONTROL_METRICS_BEARER_TOKEN=metrics
EXECUTION_CONTROL_SHARED_SECRET=worker-secret
EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET=query-secret
EXECUTION_CONTROL_INTERNAL_BASE_URL=http://execution-control.campus-agent-staging.svc.cluster.local:8000
EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL=postgresql://durable@example/campus_agent
TEMPORAL_POSTGRES_PASSWORD=temporal-postgres-password
EXECUTION_CONTROL_TEMPORAL_ADDRESS=temporal:7233
EXECUTION_CONTROL_TEMPORAL_NAMESPACE=campus-agent-staging
EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE=campus-agent.workflow
EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY=staging:execution-control:001
EXECUTION_CONTROL_TEMPORAL_WORKFLOW_WORKER_IDENTITY=staging:workflow-worker:001
EXECUTION_CONTROL_TEMPORAL_CORE_WORKER_IDENTITY=staging:activity-core:001
EXECUTION_CONTROL_TEMPORAL_AGENT_WORKER_IDENTITY=staging:activity-agent:001
EXECUTION_CONTROL_TEMPORAL_KNOWLEDGE_WORKER_IDENTITY=staging:activity-knowledge:001
EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS=5000
`.trim();

function runSelfTest(): void {
	withFixture(validStagingEnv, { CLOUDFLARE_API_TOKEN: "cf-token" }, (report) => {
		expect(report.status === "ready", `valid env should pass: ${report.blockers.join(", ")}`);
		expectJsonEqual(report.blockers, []);
	});
	withFixture(
		validStagingEnv.replace(
			"STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED=campus-agent-derived-staging",
			"STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED=campus-agent-derived",
		),
		{ CLOUDFLARE_API_TOKEN: "cf-token" },
		(report) => {
			expect(report.status === "blocked", "ambiguous object store profile should fail");
			expect(
				report.blockers.includes("STAGING_INGESTION_OBJECT_STORE_PROFILE"),
				"object store blocker missing",
			);
		},
	);
	withFixture(
		validStagingEnv
			.replace(
				"STAGING_INGESTION_OBJECT_STORE_ENDPOINT=https://5943f31433be5dd57beb3bb92bd1c660.r2.cloudflarestorage.com",
				"STAGING_INGESTION_OBJECT_STORE_ENDPOINT=http://127.0.0.1:9000",
			)
			.replace(
				"STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED=campus-agent-derived-staging",
				"STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED=campus-agent-derived",
			)
			.replace(
				"STAGING_INGESTION_OBJECT_STORE_REGION=auto",
				"STAGING_INGESTION_OBJECT_STORE_REGION=us-east-1",
			),
		{ CLOUDFLARE_API_TOKEN: "cf-token" },
		(report) => {
			expect(
				report.status === "ready",
				`local MinIO profile should pass: ${report.blockers.join(", ")}`,
			);
		},
	);
	withFixture(
		validStagingEnv
			.replace(
				"EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY=staging:execution-control:001",
				"EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY=worker-1",
			)
			.concat("\nEXECUTION_CONTROL_DURABLE_WORKER_LOOP_ENABLED=true\n"),
		{},
		(report) => {
			expect(report.status === "blocked", "invalid env should fail");
			expect(report.blockers.includes("CLOUDFLARE_API_TOKEN"), "Cloudflare blocker missing");
			expect(
				report.blockers.includes("EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY"),
				"worker identity blocker missing",
			);
			expect(
				report.blockers.includes("EXECUTION_CONTROL_DURABLE_WORKER_LOOP_ENABLED"),
				"retired worker loop blocker missing",
			);
		},
	);
	withFixture(
		validStagingEnv
			.replace(
				"OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT=https://us-east-1.aws.edge.axiom.co",
				"OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT=https://us-east-1.aws.edge.axiom.co/v1/traces",
			)
			.replace(
				"OTEL_COLLECTOR_AXIOM_EVENTS_DATASET=campus-agent-runtime",
				"OTEL_COLLECTOR_AXIOM_EVENTS_DATASET=campus-agent-metrics",
			)
			.replace(
				"OTEL_COLLECTOR_SENTRY_AUTH_VALUE=sentry sentry_key=key",
				"OTEL_COLLECTOR_SENTRY_AUTH_VALUE=Bearer sentry-token",
			)
			.replace(
				"OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT=https://langfuse.internal/api/public/otel",
				"OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT=https://langfuse.internal/api/public/otel/v1/traces",
			)
			.replace(
				"OTEL_COLLECTOR_LANGFUSE_AUTH_HEADER=Basic cGstbGY6c2stbGY=",
				"OTEL_COLLECTOR_LANGFUSE_AUTH_HEADER=Bearer langfuse-token",
			)
			.replace(
				"OTEL_COLLECTOR_LANGFUSE_INGESTION_VERSION=4",
				"OTEL_COLLECTOR_LANGFUSE_INGESTION_VERSION=3",
			),
		{ CLOUDFLARE_API_TOKEN: "cf-token" },
		(report) => {
			for (const blocker of [
				"OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT",
				"OTEL_COLLECTOR_AXIOM_EVENTS_DATASET",
				"OTEL_COLLECTOR_SENTRY_AUTH_VALUE",
				"OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT",
				"OTEL_COLLECTOR_LANGFUSE_AUTH_HEADER",
				"OTEL_COLLECTOR_LANGFUSE_INGESTION_VERSION",
			]) {
				expect(report.blockers.includes(blocker), `${blocker} blocker missing`);
			}
		},
	);
}

function withFixture(
	envFile: string,
	env: Record<string, string | undefined>,
	assertReport: (report: PreflightReport) => void,
): void {
	const root = mkdtempSync(join(tmpdir(), "temporal-staging-preflight-"));
	try {
		const envPath = join(root, "ops/staging/runtime.env");
		mkdirSync(dirname(envPath), { recursive: true });
		writeFileSync(envPath, `${envFile.trim()}\n`);
		assertReport(
			buildTemporalStagingPreflightReport(root, {
				...env,
				EXECUTION_CONTROL_STAGING_ENV_FILE: envPath,
			}),
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function expect(condition: boolean, message: string): void {
	if (!condition) {
		throw new Error(message);
	}
}

function expectJsonEqual(actual: unknown, expected: unknown): void {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
	}
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	try {
		process.exit(main(process.argv.slice(2)));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
