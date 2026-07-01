import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { projectLocalRuntimeEnv } from "./project-local-runtime-env.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

test("projectLocalRuntimeEnv projects Hindsight provider env from local projection", async () => {
	const tmp = await mkdtemp(path.join(tmpdir(), "campus-runtime-projection-"));
	const providerConfigSnapshotHostPath = path.join(
		tmp,
		"infra/local/.generated/provider-config-projection.json",
	);
	const repoEnvPath = path.join(tmp, ".env");
	const appApiEnvPath = path.join(tmp, "app-api.env");
	const appApiDevVarsPath = path.join(tmp, ".dev.vars");
	const generatedRuntimeEnvPath = path.join(tmp, "runtime.env");

	await writeFile(
		repoEnvPath,
		[
				"LLM_BASE_URL=https://llm.example/v1",
				"LLM_API_KEY=llm-secret",
				"LLM_MODEL=gpt-local",
				"EMBEDDING_BASE_URL=https://embedding.example/v1",
				"EMBEDDING_API_KEY=embedding-secret",
				"EMBEDDING_MODEL=embedding-local",
				"EMBEDDING_DIMENSIONS=2560",
				"CAMPUS_SHARED_POSTGRES_URL=postgresql://postgres.<project-ref>:<url-encoded-password>@<session-pooler-host>:5432/postgres?sslmode=require",
				"",
			].join("\n"),
	);
	await writeProviderConfigProjection(providerConfigSnapshotHostPath);
	await writeFile(appApiEnvPath, "");
	await writeFile(
		appApiDevVarsPath,
		[
			"APP_API_INTERNAL_SHARED_SECRET=",
			"APP_API_PROVIDER_CONFIG_ENCRYPTION_KEY=replace-with-provider-key",
			"APP_API_OPERATOR_EMAIL_ALLOWLIST=ops@example.com",
			"",
		].join("\n"),
	);
	await writeFile(
		generatedRuntimeEnvPath,
		[
			"APP_API_INTERNAL_SHARED_SECRET=generated-internal-secret",
			"APP_API_PROVIDER_CONFIG_ENCRYPTION_KEY=generated-provider-secret",
			"QDRANT_READ_ONLY_API_KEY=readonly-qdrant-secret",
			"EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT=workflow-salt",
			"TEMPORAL_POSTGRES_PASSWORD=temporal-password",
			"HINDSIGHT_POSTGRES_PASSWORD=hindsight-password",
			"PERSONAL_MEMORY_API_SECRET=memory-secret",
			"PERSONAL_MEMORY_OWNER_SALT=memory-salt",
			"EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET=query-secret",
			"",
		].join("\n"),
		);

	try {
		const result = await projectLocalRuntimeEnv({
			appApiDevVarsPath,
			appApiEnvPath,
			composeProjectName: "campus-runtime-test",
			env: {},
			generatedRuntimeEnvPath,
			providerConfigSnapshotHostPath,
			repoEnvPath,
			repoRoot: tmp,
			syncAppApiDevVars: true,
		});

		assert.equal(result.env.HINDSIGHT_API_LLM_PROVIDER, "openai");
		assert.equal(result.env.HINDSIGHT_API_LLM_API_KEY, "active-llm-secret");
		assert.equal(result.env.HINDSIGHT_API_LLM_BASE_URL, "https://active-llm.example/v1");
		assert.equal(result.env.HINDSIGHT_API_LLM_MODEL, "gpt-active-memory");
		assert.equal(result.env.HINDSIGHT_API_EMBEDDINGS_PROVIDER, "openai");
		assert.equal(result.env.HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY, "active-embedding-secret");
		assert.equal(
			result.env.HINDSIGHT_API_EMBEDDINGS_OPENAI_BASE_URL,
			"https://active-embedding.example/v1",
		);
		assert.equal(result.env.HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL, "embedding-active-memory");
		assert.equal(result.env.HINDSIGHT_API_RERANKER_PROVIDER, "rrf");
		assert.equal(result.env.QDRANT_QUERY_API_KEY, "readonly-qdrant-secret");
		assert.equal(
			result.env.CAMPUS_SHARED_POSTGRES_URL,
			"postgresql://postgres:postgres@campus-agent-postgres:5432/campus_agent?sslmode=disable",
		);
		assert.equal(result.env.EXECUTION_CONTROL_COMPOSE_PROJECT_NAME, "campus-runtime-test");
		assert.match(result.env.EXECUTION_CONTROL_RUNTIME_RELEASE, /^execution-control@/);
		assert.equal(result.env.EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS, "30000");
		assert.equal(result.env.EXECUTION_CONTROL_TIMEOUT_MS, "30000");
		assert.equal(result.env.LANGFUSE_BASE_URL, "http://127.0.0.1:3000");
		assert.equal(
			result.env.OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT,
			"http://langfuse-web:3000/api/public/otel",
		);
		assert.equal(result.env.OTEL_COLLECTOR_LANGFUSE_INGESTION_VERSION, "4");
		assert.match(result.env.OTEL_COLLECTOR_LANGFUSE_AUTH_HEADER, /^Basic [A-Za-z0-9+/=]+$/);
		assert.equal(result.env.APP_API_OTEL_INGEST_ENDPOINT, "http://127.0.0.1:4318");
		assert.equal(
			result.env.EXECUTION_CONTROL_OTEL_EXPORTER_OTLP_HEADERS,
			`authorization=Bearer ${result.env.APP_API_OTEL_INGEST_SHARED_SECRET}`,
		);
		assert.equal(result.env.LANGFUSE_INIT_PROJECT_NAME, "campus-agent-dev");
		assert.match(result.env.LANGFUSE_INIT_PROJECT_PUBLIC_KEY, /^pk-lf-local-/);
		assert.match(result.env.LANGFUSE_INIT_PROJECT_SECRET_KEY, /^sk-lf-local-/);

		const syncedDevVars = await readFile(appApiDevVarsPath, "utf8");
		assert.match(syncedDevVars, /^APP_API_INTERNAL_SHARED_SECRET=generated-internal-secret$/m);
		assert.match(
			syncedDevVars,
			/^APP_API_PROVIDER_CONFIG_ENCRYPTION_KEY=generated-provider-secret$/m,
		);
		assert.match(syncedDevVars, /^EXECUTION_CONTROL_TIMEOUT_MS=30000$/m);
	} finally {
		await rm(tmp, { force: true, recursive: true });
	}
});

test("projectLocalRuntimeEnv keeps non-Hindsight explicit process overrides over local files", async () => {
	const tmp = await mkdtemp(path.join(tmpdir(), "campus-runtime-projection-"));
	const providerConfigSnapshotHostPath = path.join(
		tmp,
		"infra/local/.generated/provider-config-projection.json",
	);
	const repoEnvPath = path.join(tmp, ".env");
	const appApiEnvPath = path.join(tmp, "app-api.env");
	const appApiDevVarsPath = path.join(tmp, ".dev.vars");
	const generatedRuntimeEnvPath = path.join(tmp, "runtime.env");

	await writeFile(repoEnvPath, "LLM_API_KEY=file-llm-key\nLLM_MODEL=file-model\n");
	await writeFile(appApiEnvPath, "");
	await writeFile(appApiDevVarsPath, "APP_API_INTERNAL_SHARED_SECRET=file-internal\n");
	await writeFile(
		generatedRuntimeEnvPath,
		"QDRANT_READ_ONLY_API_KEY=file-qdrant-readonly\nEXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT=salt\n",
	);
	await writeProviderConfigProjection(providerConfigSnapshotHostPath);

	try {
		const result = await projectLocalRuntimeEnv({
			appApiDevVarsPath,
			appApiEnvPath,
			composeProjectName: "campus-runtime-test",
			env: {
				APP_API_INTERNAL_SHARED_SECRET: "process-internal",
				LLM_API_KEY: "process-llm-key",
				QDRANT_QUERY_API_KEY: "process-qdrant-query",
			},
			generatedRuntimeEnvPath,
			providerConfigSnapshotHostPath,
			repoEnvPath,
			repoRoot: tmp,
		});

		assert.equal(result.env.HINDSIGHT_API_LLM_API_KEY, "active-llm-secret");
		assert.equal(result.env.EXECUTION_CONTROL_APP_API_INTERNAL_SHARED_SECRET, "process-internal");
		assert.equal(result.env.QDRANT_QUERY_API_KEY, "process-qdrant-query");
	} finally {
		await rm(tmp, { force: true, recursive: true });
	}
});

test("projectLocalRuntimeEnv fails closed without provider projection artifact", async () => {
	const tmp = await mkdtemp(path.join(tmpdir(), "campus-runtime-projection-"));
	const repoEnvPath = path.join(tmp, ".env");
	const appApiEnvPath = path.join(tmp, "app-api.env");
	const appApiDevVarsPath = path.join(tmp, ".dev.vars");
	const generatedRuntimeEnvPath = path.join(tmp, "runtime.env");

	await writeFile(
		repoEnvPath,
		[
			"LLM_API_KEY=llm-secret",
			"LLM_MODEL=gpt-local",
			"EMBEDDING_API_KEY=embedding-secret",
			"EMBEDDING_MODEL=embedding-local",
			"",
		].join("\n"),
	);
	await writeFile(appApiEnvPath, "");
	await writeFile(appApiDevVarsPath, "APP_API_INTERNAL_SHARED_SECRET=local-secret\n");
	await writeFile(generatedRuntimeEnvPath, "");

	try {
		await assert.rejects(
			() =>
				projectLocalRuntimeEnv({
					appApiDevVarsPath,
					appApiEnvPath,
					composeProjectName: "campus-runtime-test",
					env: {},
					generatedRuntimeEnvPath,
					repoEnvPath,
					repoRoot: tmp,
				}),
			/provider-config projection is not readable/,
		);
	} finally {
		await rm(tmp, { force: true, recursive: true });
	}
});

test("projectLocalRuntimeEnv derives Langfuse collector values from canonical keys", async () => {
	const tmp = await mkdtemp(path.join(tmpdir(), "campus-runtime-projection-"));
	const repoEnvPath = path.join(tmp, ".env");
	const appApiEnvPath = path.join(tmp, "app-api.env");
	const appApiDevVarsPath = path.join(tmp, ".dev.vars");
	const generatedRuntimeEnvPath = path.join(tmp, "runtime.env");

	await writeFile(
		repoEnvPath,
		[
			"LANGFUSE_BASE_URL=https://langfuse.dev.example",
			"LANGFUSE_PUBLIC_KEY=pk-lf-dev",
			"LANGFUSE_SECRET_KEY=sk-lf-dev",
			"",
		].join("\n"),
	);
	await writeFile(appApiEnvPath, "");
	await writeFile(appApiDevVarsPath, "");
	await writeFile(generatedRuntimeEnvPath, "");

	try {
		const result = await projectLocalRuntimeEnv({
			appApiDevVarsPath,
			appApiEnvPath,
			composeProjectName: "campus-runtime-test",
			env: {},
			generatedRuntimeEnvPath,
			repoEnvPath,
			repoRoot: tmp,
			skipHindsightProviderConfig: true,
		});

		assert.equal(
			result.env.OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT,
			"https://langfuse.dev.example/api/public/otel",
		);
		assert.equal(
			result.env.OTEL_COLLECTOR_LANGFUSE_AUTH_HEADER,
			`Basic ${Buffer.from("pk-lf-dev:sk-lf-dev").toString("base64")}`,
		);
		assert.equal(result.env.OTEL_COLLECTOR_LANGFUSE_INGESTION_VERSION, "4");
	} finally {
		await rm(tmp, { force: true, recursive: true });
	}
});

test("projectLocalRuntimeEnv projects repo-local object store defaults for container and host targets", async () => {
	const tmp = await mkdtemp(path.join(tmpdir(), "campus-runtime-projection-"));
	const repoEnvPath = path.join(tmp, ".env");
	const appApiEnvPath = path.join(tmp, "app-api.env");
	const appApiDevVarsPath = path.join(tmp, ".dev.vars");
	const generatedRuntimeEnvPath = path.join(tmp, "runtime.env");

	await writeFile(repoEnvPath, "");
	await writeFile(appApiEnvPath, "");
	await writeFile(appApiDevVarsPath, "");
	await writeFile(generatedRuntimeEnvPath, "");

	try {
		const container = await projectLocalRuntimeEnv({
			appApiDevVarsPath,
			appApiEnvPath,
			composeProjectName: "campus-runtime-test",
			env: {},
			generatedRuntimeEnvPath,
			repoEnvPath,
			repoRoot: tmp,
			skipHindsightProviderConfig: true,
			target: "container",
		});
		const host = await projectLocalRuntimeEnv({
			appApiDevVarsPath,
			appApiEnvPath,
			composeProjectName: "campus-runtime-test",
			env: {},
			generatedRuntimeEnvPath,
			repoEnvPath,
			repoRoot: tmp,
			skipHindsightProviderConfig: true,
			target: "host",
		});

		assert.equal(container.env.OBJECT_STORE_ENDPOINT, "http://minio:9000");
		assert.equal(host.env.OBJECT_STORE_ENDPOINT, "http://127.0.0.1:9000");
		for (const projected of [container.env, host.env]) {
			assert.equal(projected.OBJECT_STORE_ACCESS_KEY, "minioadmin");
			assert.equal(projected.OBJECT_STORE_SECRET_KEY, "minioadmin");
			assert.equal(projected.OBJECT_STORE_REGION, "us-east-1");
			assert.equal(projected.OBJECT_STORE_BUCKET_SOURCE, "campus-agent-source");
			assert.equal(projected.OBJECT_STORE_BUCKET_DERIVED, "campus-agent-derived");
		}
	} finally {
		await rm(tmp, { force: true, recursive: true });
	}
});

test("projectLocalRuntimeEnv keeps explicit object store env over repo-local defaults", async () => {
	const tmp = await mkdtemp(path.join(tmpdir(), "campus-runtime-projection-"));
	const repoEnvPath = path.join(tmp, ".env");
	const appApiEnvPath = path.join(tmp, "app-api.env");
	const appApiDevVarsPath = path.join(tmp, ".dev.vars");
	const generatedRuntimeEnvPath = path.join(tmp, "runtime.env");

	await writeFile(repoEnvPath, "");
	await writeFile(appApiEnvPath, "");
	await writeFile(appApiDevVarsPath, "");
	await writeFile(generatedRuntimeEnvPath, "");

	try {
		const result = await projectLocalRuntimeEnv({
			appApiDevVarsPath,
			appApiEnvPath,
			composeProjectName: "campus-runtime-test",
			env: {
				OBJECT_STORE_ACCESS_KEY: "explicit-access",
				OBJECT_STORE_BUCKET_DERIVED: "explicit-derived",
				OBJECT_STORE_BUCKET_SOURCE: "explicit-source",
				OBJECT_STORE_ENDPOINT: "http://127.0.0.1:19000",
				OBJECT_STORE_REGION: "local-test",
				OBJECT_STORE_SECRET_KEY: "explicit-secret",
			},
			generatedRuntimeEnvPath,
			repoEnvPath,
			repoRoot: tmp,
			skipHindsightProviderConfig: true,
			target: "host",
		});

		assert.equal(result.env.OBJECT_STORE_ENDPOINT, "http://127.0.0.1:19000");
		assert.equal(result.env.OBJECT_STORE_ACCESS_KEY, "explicit-access");
		assert.equal(result.env.OBJECT_STORE_SECRET_KEY, "explicit-secret");
		assert.equal(result.env.OBJECT_STORE_REGION, "local-test");
		assert.equal(result.env.OBJECT_STORE_BUCKET_SOURCE, "explicit-source");
		assert.equal(result.env.OBJECT_STORE_BUCKET_DERIVED, "explicit-derived");
	} finally {
		await rm(tmp, { force: true, recursive: true });
	}
});

test("repo-local MinIO bucket initialization uses accepted source and derived buckets", async () => {
	const source = await readFile(path.resolve(scriptDir, "../minio/create_buckets.sh"), "utf8");

	assert.match(source, /OBJECT_STORE_BUCKET_SOURCE:-campus-agent-source/);
	assert.match(source, /OBJECT_STORE_BUCKET_DERIVED:-campus-agent-derived/);
	assert.doesNotMatch(source, /campus-agent-raw/);
	assert.doesNotMatch(source, /campus-agent-processed/);
});

async function writeProviderConfigProjection(filePath) {
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(
		filePath,
		`${JSON.stringify(
			{
				schema_version: "provider_config_projection.v1",
				generated_at: "2026-06-22T00:00:00Z",
				profiles: {
					hindsight_llm: {
						api_key: "active-llm-secret",
						base_url: "https://active-llm.example/v1",
						kind: "prompt",
						model: "gpt-active-memory",
						profile_id: "provider_profile_hindsight_llm",
						provider: "openai",
						revision: 3,
						role: "hindsight_llm",
						timeout_ms: 30000,
						transport: "chat_completions",
					},
					hindsight_embedding: {
						api_key: "active-embedding-secret",
						base_url: "https://active-embedding.example/v1",
						dimensions: 2560,
						kind: "embedding",
						model: "embedding-active-memory",
						profile_id: "provider_profile_hindsight_embedding",
						provider: "openai",
						revision: 3,
						role: "hindsight_embedding",
						timeout_ms: 30000,
						transport: "embeddings",
					},
				},
			},
			null,
			2,
		)}\n`,
	);
}
