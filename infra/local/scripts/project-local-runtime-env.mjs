import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ensureRuntimeSecrets } from "./ensure-runtime-secrets.mjs";
import { appApiDevVarsSyncKeys, runtimeKeys } from "./project-local-runtime-env-keys.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(__dirname, "../..", "..");

export async function projectLocalRuntimeEnv(input = {}) {
	const repoRoot = input.repoRoot ?? defaultRepoRoot;
	const repoEnvPath = input.repoEnvPath ?? path.join(repoRoot, ".env");
	const appApiEnvPath = input.appApiEnvPath ?? path.join(repoRoot, "apps/app-api/.env");
	const appApiDevVarsPath = input.appApiDevVarsPath ?? path.join(repoRoot, "apps/app-api/.dev.vars");
	const generatedRuntimeEnvPath =
		input.generatedRuntimeEnvPath ?? path.join(repoRoot, "infra/local/.generated/runtime.env");
	const providerConfigSnapshotHostPath =
		input.providerConfigSnapshotHostPath ??
		path.join(repoRoot, "infra/local/.generated/provider-config-projection.json");
	const composeProjectName =
		input.composeProjectName ?? "campus-execution-control-runtime-local";
	const target = normalizeProjectionTarget(input.target ?? "container");

	await ensureRuntimeSecrets({ envPath: generatedRuntimeEnvPath });

	const env = new Map();
	for (const filePath of [repoEnvPath, appApiEnvPath, appApiDevVarsPath, generatedRuntimeEnvPath]) {
		await mergeEnvFile(env, filePath);
	}
	for (const [key, value] of Object.entries(input.env ?? process.env)) {
		if (typeof value === "string" && value.trim()) {
			env.set(key, value.trim());
		}
	}

	deriveRuntimeEnv(env, { composeProjectName, providerConfigSnapshotHostPath, repoRoot });
	if (!input.skipHindsightProviderConfig) {
		await projectHindsightProviderConfig(env);
	}

	if (input.syncAppApiDevVars) {
		await syncAppApiDevVars(appApiDevVarsPath, env);
	}

	const projectedEnv = {};
	for (const [key, value] of env.entries()) {
		if (runtimeKeys.includes(key) || key.startsWith("EXECUTION_CONTROL_")) {
			projectedEnv[key] = target === "container" ? projectContainerValue(key, value) : value;
		}
	}
	return {
		env: projectedEnv,
		summary: summarizeProjectedEnv(projectedEnv),
	};
}

async function mergeEnvFile(env, filePath) {
	let content = "";
	try {
		content = await readFile(filePath, "utf8");
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return;
		}
		throw error;
	}
	for (const [key, value] of parseEnv(content).entries()) {
		if (shouldSetEnv(env.get(key))) {
			env.set(key, value);
		}
	}
}

function deriveRuntimeEnv(env, input) {
	setDefault(env, "DEPLOYMENT_ENVIRONMENT", "local");
	setDefault(env, "EXECUTION_CONTROL_RUNTIME_PROFILE", "local");
	setDefault(env, "EXECUTION_CONTROL_RUNTIME_CONFIG_PATH", "/etc/campus-agent/runtime-profile.local-real-provider.json");
	setDefault(env, "EXECUTION_CONTROL_RUNTIME_RELEASE", deriveRuntimeRelease(input.repoRoot));
	setValue(env, "EXECUTION_CONTROL_COMPOSE_PROJECT_DIRECTORY", input.repoRoot);
	setValue(env, "EXECUTION_CONTROL_COMPOSE_PROJECT_NAME", input.composeProjectName);
	const providerConfigSnapshotHostPath =
		read(env, "CAMPUS_PROVIDER_CONFIG_SNAPSHOT_HOST_PATH") ||
		read(env, "CAMPUS_PROVIDER_CONFIG_SNAPSHOT_PATH") ||
		input.providerConfigSnapshotHostPath;
	setValue(env, "CAMPUS_PROVIDER_CONFIG_SNAPSHOT_HOST_PATH", providerConfigSnapshotHostPath);
	setDefault(env, "CAMPUS_PROVIDER_CONFIG_SNAPSHOT_PATH", "/run/campus-agent/provider-config-projection.json");
	setDefault(
		env,
		"EXECUTION_CONTROL_PROVIDER_CONFIG_SNAPSHOT_PATH",
		read(env, "CAMPUS_PROVIDER_CONFIG_SNAPSHOT_PATH"),
	);
	projectProviderConfigProjectionFile(env, providerConfigSnapshotHostPath);

	const workerSharedSecret =
		read(env, "API_WORKER_SHARED_SECRET") ||
		read(env, "EXECUTION_CONTROL_SHARED_SECRET") ||
		"execution-control-local-placeholder";
	setValue(env, "API_WORKER_SHARED_SECRET", workerSharedSecret);

	const internalQuerySharedSecret = read(env, "EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET");
	const agentRuntimeExecutionControlSharedSecret =
		read(env, "AGENT_RUNTIME_EXECUTION_CONTROL_SHARED_SECRET") || internalQuerySharedSecret;
	if (
		agentRuntimeExecutionControlSharedSecret &&
		internalQuerySharedSecret &&
		agentRuntimeExecutionControlSharedSecret !== internalQuerySharedSecret
	) {
		throw new Error(
			"AGENT_RUNTIME_EXECUTION_CONTROL_SHARED_SECRET must match EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET",
		);
	}
	if (internalQuerySharedSecret) {
		setValue(env, "AGENT_RUNTIME_EXECUTION_CONTROL_SHARED_SECRET", internalQuerySharedSecret);
	}

	const appApiInternalBaseUrl =
		read(env, "EXECUTION_CONTROL_APP_API_INTERNAL_BASE_URL") ||
		read(env, "APP_API_INTERNAL_BASE_URL") ||
		"http://host.docker.internal:27031";
	setValue(env, "EXECUTION_CONTROL_APP_API_INTERNAL_BASE_URL", trimTrailingSlash(appApiInternalBaseUrl));
	setDefault(env, "EXECUTION_CONTROL_APP_API_INTERNAL_TIMEOUT_MS", "30000");
	setDefault(env, "EXECUTION_CONTROL_APP_API_BASE_URL", trimTrailingSlash(appApiInternalBaseUrl));
	const appApiInternalSharedSecret =
		read(env, "EXECUTION_CONTROL_APP_API_INTERNAL_SHARED_SECRET") ||
		read(env, "APP_API_INTERNAL_SHARED_SECRET");
	if (appApiInternalSharedSecret) {
		setValue(env, "APP_API_INTERNAL_SHARED_SECRET", appApiInternalSharedSecret);
		setValue(env, "EXECUTION_CONTROL_APP_API_INTERNAL_SHARED_SECRET", appApiInternalSharedSecret);
	}

	setDefault(
		env,
		"EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL",
		"postgresql://postgres:postgres@campus-agent-postgres:5432/campus_agent?sslmode=disable",
	);
	setDefault(
		env,
		"CAMPUS_SHARED_POSTGRES_URL",
		"postgresql://postgres:postgres@campus-agent-postgres:5432/campus_agent?sslmode=disable",
	);
	setDefault(
		env,
		"DOCUMENT_REGISTRY_DATABASE_URL",
		"postgresql://postgres:postgres@campus-agent-postgres:5432/campus_agent?sslmode=disable",
	);
	setDefault(env, "QDRANT_URL", "http://qdrant:6333");
	setDefault(env, "QDRANT_TIMEOUT_SECONDS", "60");
	if (!read(env, "QDRANT_QUERY_API_KEY") && read(env, "QDRANT_READ_ONLY_API_KEY")) {
		setValue(env, "QDRANT_QUERY_API_KEY", read(env, "QDRANT_READ_ONLY_API_KEY"));
	}

	setDefault(env, "OBJECT_STORE_ENDPOINT", "http://127.0.0.1:9000");
	setDefault(env, "OBJECT_STORE_ACCESS_KEY", "minioadmin");
	setDefault(env, "OBJECT_STORE_SECRET_KEY", "minioadmin");
	setDefault(env, "OBJECT_STORE_REGION", "us-east-1");
	setDefault(env, "OBJECT_STORE_BUCKET_SOURCE", "campus-agent-source");
	setDefault(env, "OBJECT_STORE_BUCKET_DERIVED", "campus-agent-derived");

	setDefault(env, "EXECUTION_CONTROL_AGENT_RUNTIME_BASE_URL", "http://agent-runtime:27062");
	setDefault(env, "EXECUTION_CONTROL_AGENT_RUNTIME_TIMEOUT_MS", "180000");
	setDefault(env, "AGENT_RUNTIME_PORT", "27062");
	setDefault(env, "AGENT_RUNTIME_TOOL_CATALOG_PATH", "configs/runtime/tool-catalog.v1.json");
	setDefault(env, "AGENT_RUNTIME_EXECUTION_CONTROL_BASE_URL", "http://execution-control:8000");
	const agentRuntimeSharedSecret =
		read(env, "EXECUTION_CONTROL_AGENT_RUNTIME_SHARED_SECRET") ||
		read(env, "AGENT_RUNTIME_SHARED_SECRET") ||
		deriveAgentRuntimeSharedSecret(workerSharedSecret, internalQuerySharedSecret);
	if (agentRuntimeSharedSecret) {
		setValue(env, "EXECUTION_CONTROL_AGENT_RUNTIME_SHARED_SECRET", agentRuntimeSharedSecret);
		setValue(env, "AGENT_RUNTIME_SHARED_SECRET", agentRuntimeSharedSecret);
	}

	const appApiOtelIngestSharedSecret =
		read(env, "APP_API_OTEL_INGEST_SHARED_SECRET") ||
		deriveOtelIngestSecret(workerSharedSecret, internalQuerySharedSecret);
	if (appApiOtelIngestSharedSecret) {
		setValue(env, "APP_API_OTEL_INGEST_SHARED_SECRET", appApiOtelIngestSharedSecret);
		setDefault(
			env,
			"EXECUTION_CONTROL_OTEL_EXPORTER_OTLP_HEADERS",
			`authorization=Bearer ${appApiOtelIngestSharedSecret}`,
		);
	}
	setDefault(env, "APP_API_OTEL_INGEST_ENDPOINT", "http://127.0.0.1:4318");

	const explicitLangfuseBaseURL = read(env, "LANGFUSE_BASE_URL");
	setDefault(env, "LANGFUSE_HOST_PORT", "3000");
	setDefault(env, "LANGFUSE_MINIO_HOST_PORT", "9090");
	setDefault(env, "LANGFUSE_BASE_URL", `http://127.0.0.1:${read(env, "LANGFUSE_HOST_PORT") || "3000"}`);
	setDefault(env, "LANGFUSE_NEXTAUTH_URL", read(env, "LANGFUSE_BASE_URL"));
	setDefault(env, "LANGFUSE_MINIO_ROOT_USER", "minio");
	setDefault(env, "LANGFUSE_INIT_ORG_ID", "campus-agent-local");
	setDefault(env, "LANGFUSE_INIT_ORG_NAME", "campus-agent-local");
	setDefault(env, "LANGFUSE_INIT_PROJECT_ID", "campus-agent-dev");
	setDefault(env, "LANGFUSE_INIT_PROJECT_NAME", "campus-agent-dev");
	setDefault(env, "LANGFUSE_INIT_USER_EMAIL", "langfuse-local@campus-agent.local");
	setDefault(env, "LANGFUSE_INIT_USER_NAME", "Campus Agent Local");
	setDefault(env, "LANGFUSE_ENVIRONMENT", read(env, "DEPLOYMENT_ENVIRONMENT") || "local");
	setDefault(env, "LANGFUSE_PUBLIC_KEY", read(env, "LANGFUSE_INIT_PROJECT_PUBLIC_KEY"));
	setDefault(env, "LANGFUSE_SECRET_KEY", read(env, "LANGFUSE_INIT_PROJECT_SECRET_KEY"));
	setDefault(env, "LANGFUSE_INIT_PROJECT_PUBLIC_KEY", read(env, "LANGFUSE_PUBLIC_KEY"));
	setDefault(env, "LANGFUSE_INIT_PROJECT_SECRET_KEY", read(env, "LANGFUSE_SECRET_KEY"));
	const langfuseCollectorBaseURL = explicitLangfuseBaseURL || "http://langfuse-web:3000";
	setDefault(
		env,
		"OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT",
		`${trimTrailingSlash(langfuseCollectorBaseURL)}/api/public/otel`,
	);
	const langfusePublicKey = read(env, "LANGFUSE_PUBLIC_KEY");
	const langfuseSecretKey = read(env, "LANGFUSE_SECRET_KEY");
	if (langfusePublicKey && langfuseSecretKey) {
		setDefault(
			env,
			"OTEL_COLLECTOR_LANGFUSE_AUTH_HEADER",
			`Basic ${Buffer.from(`${langfusePublicKey}:${langfuseSecretKey}`).toString("base64")}`,
		);
	}
	setDefault(env, "OTEL_COLLECTOR_LANGFUSE_INGESTION_VERSION", "4");

	setDefault(env, "EXECUTION_CONTROL_TEMPORAL_ADDRESS", "temporal:7233");
	setDefault(env, "EXECUTION_CONTROL_TEMPORAL_NAMESPACE", "campus-agent-staging");
	setDefault(env, "EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS", "30000");
	setDefault(env, "EXECUTION_CONTROL_TIMEOUT_MS", read(env, "EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS"));
	setDefault(env, "EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY", "local:execution-control:001");
	setDefault(env, "EXECUTION_CONTROL_TEMPORAL_WORKFLOW_WORKER_IDENTITY", "local:workflow-worker:001");
	setDefault(env, "EXECUTION_CONTROL_TEMPORAL_CORE_WORKER_IDENTITY", "local:activity-core:001");
	setDefault(env, "EXECUTION_CONTROL_TEMPORAL_AGENT_WORKER_IDENTITY", "local:activity-agent:001");
	setDefault(env, "EXECUTION_CONTROL_TEMPORAL_KNOWLEDGE_WORKER_IDENTITY", "local:activity-knowledge:001");
	setDefault(
		env,
		"EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE_SAMPLER_IDENTITY",
		"local:temporal-task-queue-sampler:001",
	);

	setDefault(env, "PERSONAL_MEMORY_BASE_URL", "http://hindsight-api:8888");
	setDefault(env, "HINDSIGHT_API_IMAGE", "ghcr.io/vectorize-io/hindsight-api:0.8.2");
	setDefault(env, "HINDSIGHT_API_RERANKER_PROVIDER", "rrf");
}

function projectProviderConfigProjectionFile(env, providerConfigSnapshotHostPath) {
	try {
		chmodSync(providerConfigSnapshotHostPath, 0o600);
		const snapshotStat = statSync(providerConfigSnapshotHostPath);
		setValue(env, "CAMPUS_PROVIDER_CONFIG_SNAPSHOT_OWNER_UID", String(snapshotStat.uid));
		setValue(env, "CAMPUS_PROVIDER_CONFIG_SNAPSHOT_OWNER_GID", String(snapshotStat.gid));
	} catch {
		return;
	}
}

async function projectHindsightProviderConfig(env) {
	const projection = await loadProviderConfigProjection(env);
	const llm = providerProfileFromProjection(projection, "hindsight_llm");
	const embedding = providerProfileFromProjection(projection, "hindsight_embedding");
	requireProviderProfile(llm, {
		kind: "prompt",
		role: "hindsight_llm",
		transports: ["responses", "chat_completions"],
	});
	requireProviderProfile(embedding, {
		kind: "embedding",
		role: "hindsight_embedding",
		transports: ["embeddings"],
	});
	if (!Number.isInteger(embedding.dimensions) || embedding.dimensions <= 0) {
		throw new Error(
			"Hindsight provider-config projection requires hindsight_embedding dimensions",
		);
	}
	setValue(env, "HINDSIGHT_API_LLM_PROVIDER", hindsightProviderSlug(llm.provider));
	setValue(env, "HINDSIGHT_API_LLM_API_KEY", llm.api_key);
	setValue(env, "HINDSIGHT_API_LLM_BASE_URL", llm.base_url);
	setValue(env, "HINDSIGHT_API_LLM_MODEL", llm.model);
	setValue(env, "HINDSIGHT_API_EMBEDDINGS_PROVIDER", hindsightProviderSlug(embedding.provider));
	setValue(env, "HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY", embedding.api_key);
	setValue(env, "HINDSIGHT_API_EMBEDDINGS_OPENAI_BASE_URL", embedding.base_url);
	setValue(env, "HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL", embedding.model);
	setValue(env, "HINDSIGHT_API_RERANKER_PROVIDER", "rrf");
}

async function loadProviderConfigProjection(env) {
	const snapshotPath =
		read(env, "CAMPUS_PROVIDER_CONFIG_SNAPSHOT_HOST_PATH") ||
		read(env, "CAMPUS_PROVIDER_CONFIG_SNAPSHOT_PATH");
	if (!snapshotPath) {
		throw new Error("provider-config projection requires CAMPUS_PROVIDER_CONFIG_SNAPSHOT_PATH");
	}
	try {
		const text = await readFile(snapshotPath, "utf8");
		const payload = text ? JSON.parse(text) : {};
		if (payload.schema_version !== "provider_config_projection.v1") {
			throw new Error("schema_version is unsupported");
		}
		if (!payload.profiles || typeof payload.profiles !== "object" || Array.isArray(payload.profiles)) {
			throw new Error("profiles must be an object");
		}
		return payload;
	} catch (error) {
		throw new Error(
			`provider-config projection is not readable at ${snapshotPath}: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
}

function providerProfileFromProjection(projection, role) {
	const profile = projection.profiles?.[role];
	if (!profile) {
		throw new Error(
			`Hindsight provider-config projection requires active provider profile ${role}`,
		);
	}
	return profile;
}

function requireProviderProfile(profile, expected) {
	if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
		throw new Error(
			`Hindsight provider-config projection requires active provider profile ${expected.role}`,
		);
	}
	for (const key of ["api_key", "base_url", "kind", "model", "provider", "role", "transport"]) {
		if (typeof profile[key] !== "string" || !profile[key].trim()) {
			throw new Error(
				`Hindsight provider-config projection requires ${expected.role} ${key}`,
			);
		}
	}
	const expectedTransports = expected.transports ?? [expected.transport];
	if (
		profile.kind !== expected.kind ||
		profile.role !== expected.role ||
		!expectedTransports.includes(profile.transport)
	) {
		throw new Error(
			`Hindsight provider-config projection expected ${expected.role} ${expected.kind}/${expectedTransports.join("|")}`,
		);
	}
}

function hindsightProviderSlug(provider) {
	const normalized = provider.trim();
	if (normalized === "openai" || normalized === "openai-compatible" || normalized === "gitee") {
		return "openai";
	}
	return normalized;
}

async function syncAppApiDevVars(filePath, env) {
	let content = "";
	try {
		content = await readFile(filePath, "utf8");
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
			throw error;
		}
	}
	const lines = content ? content.split(/\r?\n/) : [];
	const seen = new Set();
	const nextLines = lines.map((line) => {
		const separatorIndex = line.indexOf("=");
		if (separatorIndex <= 0) {
			return line;
		}
		const key = line.slice(0, separatorIndex).trim();
		if (!appApiDevVarsSyncKeys.includes(key)) {
			return line;
		}
		seen.add(key);
		const current = line.slice(separatorIndex + 1).trim();
		const projected = read(env, key);
		if (projected && shouldSetEnv(current)) {
			return `${key}=${projected}`;
		}
		return line;
	});
	for (const key of appApiDevVarsSyncKeys) {
		const projected = read(env, key);
		if (!seen.has(key) && projected) {
			nextLines.push(`${key}=${projected}`);
		}
	}
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(filePath, `${nextLines.join("\n").replace(/\n+$/, "")}\n`);
}

function parseEnv(content) {
	const parsed = new Map();
	for (const rawLine of content.split(/\r?\n/)) {
		const trimmed = rawLine.trim();
		if (!trimmed || trimmed.startsWith("#")) {
			continue;
		}
		const separatorIndex = rawLine.indexOf("=");
		if (separatorIndex <= 0) {
			continue;
		}
		const key = rawLine.slice(0, separatorIndex).trim();
		const value = rawLine.slice(separatorIndex + 1).trim();
		if (key) {
			parsed.set(key, value);
		}
	}
	return parsed;
}

function deriveRuntimeRelease(repoRoot) {
	try {
		const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
			cwd: repoRoot,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		if (sha) {
			return `execution-control@${sha}`;
		}
	} catch {
		// Local projection should remain usable from exported source archives.
	}
	return "execution-control@local";
}

function deriveAgentRuntimeSharedSecret(workerSharedSecret, internalQuerySharedSecret) {
	if (!(workerSharedSecret && internalQuerySharedSecret)) {
		return "";
	}
	return createHash("sha256")
		.update("campus-agent:agent-runtime-shared-secret:v1\0")
		.update(workerSharedSecret)
		.update("\0")
		.update(internalQuerySharedSecret)
		.digest("hex");
}

function deriveOtelIngestSecret(workerSharedSecret, internalQuerySharedSecret) {
	if (!(workerSharedSecret && internalQuerySharedSecret)) {
		return "";
	}
	return createHash("sha256")
		.update("campus-agent:otel-ingest:v1\0")
		.update(workerSharedSecret)
		.update("\0")
		.update(internalQuerySharedSecret)
		.digest("hex");
}

function projectContainerValue(key, value) {
	if (
		key === "DOCUMENT_REGISTRY_DATABASE_URL" ||
		key === "CAMPUS_SHARED_POSTGRES_URL" ||
		key === "EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL"
	) {
		return projectLocalServiceDns(value, "campus-agent-postgres");
	}
	if (key === "OBJECT_STORE_ENDPOINT") {
		return projectLocalServiceDns(value, "minio");
	}
	if (key === "QDRANT_URL") {
		return projectLocalServiceDns(value, "qdrant");
	}
	if (key === "OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT") {
		return projectLocalServiceDns(value, "langfuse-web");
	}
	if (key === "EXECUTION_CONTROL_APP_API_INTERNAL_BASE_URL") {
		return projectLocalServiceDns(value, "host.docker.internal");
	}
	if (key === "HINDSIGHT_API_LLM_BASE_URL" || key === "HINDSIGHT_API_EMBEDDINGS_OPENAI_BASE_URL") {
		return projectLocalServiceDns(value, "host.docker.internal");
	}
	return value;
}

function projectLocalServiceDns(value, serviceName) {
	if (!value) {
		return value;
	}
	try {
		const parsed = new URL(value);
		if (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") {
			parsed.hostname = serviceName;
			return parsed.toString().replace(/\/$/, "");
		}
	} catch {
		return value;
	}
	return value;
}

function summarizeProjectedEnv(env) {
	const keys = [
		"LLM_BASE_URL",
		"LLM_API_KEY",
		"LLM_MODEL",
		"EMBEDDING_BASE_URL",
		"EMBEDDING_API_KEY",
		"EMBEDDING_MODEL",
		"EMBEDDING_DIMENSIONS",
		"RERANK_BASE_URL",
		"RERANK_API_KEY",
		"RERANK_MODEL",
		"OBJECT_STORE_ENDPOINT",
		"OBJECT_STORE_ACCESS_KEY",
		"OBJECT_STORE_SECRET_KEY",
		"OBJECT_STORE_REGION",
		"OBJECT_STORE_BUCKET_SOURCE",
		"OBJECT_STORE_BUCKET_DERIVED",
		"QDRANT_URL",
		"QDRANT_QUERY_API_KEY",
		"HINDSIGHT_API_LLM_API_KEY",
		"HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY",
		"EXECUTION_CONTROL_RUNTIME_RELEASE",
		"EXECUTION_CONTROL_TIMEOUT_MS",
		"EXECUTION_CONTROL_APP_API_INTERNAL_SHARED_SECRET",
		"LANGFUSE_BASE_URL",
		"OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT",
		"OTEL_COLLECTOR_LANGFUSE_AUTH_HEADER",
		"OTEL_COLLECTOR_LANGFUSE_INGESTION_VERSION",
	];
	return Object.fromEntries(
		keys.map((key) => {
			const value = env[key] ?? "";
			return [
				key,
				isSecretKey(key)
					? { present: Boolean(value), length: value.length }
					: { present: Boolean(value), value },
			];
		}),
	);
}

function isSecretKey(key) {
	return /SECRET|TOKEN|API_KEY|PASSWORD|AUTH_HEADER/.test(key);
}

function setDefault(env, key, value) {
	if (value && shouldSetEnv(env.get(key))) {
		env.set(key, value);
	}
}

function setValue(env, key, value) {
	if (typeof value === "string" && value.trim()) {
		env.set(key, value.trim());
	}
}

function read(env, key) {
	return env.get(key)?.trim() || "";
}

function shouldSetEnv(value) {
	const normalized = value?.trim() ?? "";
	return !normalized || normalized.startsWith("replace-with-") || isTemplatePlaceholder(normalized);
}

function normalizeProjectionTarget(value) {
	if (value === "container" || value === "host") {
		return value;
	}
	throw new Error("--target must be container or host");
}

function isTemplatePlaceholder(value) {
	return (
		value.includes("<project-ref>") ||
		value.includes("<url-encoded-password>") ||
		value.includes("<session-pooler-host>") ||
		value.includes("<secret>") ||
		value.includes("<api-key>")
	);
}

function trimTrailingSlash(value) {
	return value.replace(/\/+$/, "");
}

function parseArgs(argv) {
	const args = {
		composeProjectName: "campus-execution-control-runtime-local",
		format: "env",
		repoRoot: defaultRepoRoot,
		syncAppApiDevVars: false,
		target: "container",
	};
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (token === "--sync-app-api-dev-vars") {
			args.syncAppApiDevVars = true;
			continue;
		}
		if (token === "--skip-hindsight-provider-config") {
			args.skipHindsightProviderConfig = true;
			continue;
		}
		const value = argv[index + 1];
		if (!value || value.startsWith("--")) {
			throw new Error(`${token} requires a value`);
		}
		if (token === "--repo-root") {
			args.repoRoot = value;
		} else if (token === "--compose-project-name") {
			args.composeProjectName = value;
		} else if (token === "--format") {
			args.format = value;
		} else if (token === "--target") {
			args.target = normalizeProjectionTarget(value);
		} else {
			throw new Error(`unknown argument ${token}`);
		}
		index += 1;
	}
	return args;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const result = await projectLocalRuntimeEnv(args);
	if (args.format === "summary") {
		process.stdout.write(`${JSON.stringify(result.summary, null, 2)}\n`);
		return;
	}
	if (args.format !== "env") {
		throw new Error("--format must be env or summary");
	}
	for (const [key, value] of Object.entries(result.env)) {
		process.stdout.write(`${key}\0${value}\0`);
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
