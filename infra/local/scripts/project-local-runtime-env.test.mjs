import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { projectLocalRuntimeEnv } from "./project-local-runtime-env.mjs";

test("projectLocalRuntimeEnv projects Hindsight provider env from app-api active profiles", async () => {
	const tmp = await mkdtemp(path.join(tmpdir(), "campus-runtime-projection-"));
	const providerConfigServer = new ActiveProviderConfigServer();
	await providerConfigServer.listen();
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
				"APP_API_INTERNAL_BASE_URL=" + providerConfigServer.baseUrl,
				"CAMPUS_SHARED_POSTGRES_URL=postgresql://postgres.<project-ref>:<url-encoded-password>@<session-pooler-host>:5432/postgres?sslmode=require",
				"",
			].join("\n"),
	);
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
			repoEnvPath,
			repoRoot: tmp,
			syncAppApiDevVars: true,
		});

		assert.deepEqual(providerConfigServer.requestedRoles(), [
			"hindsight_llm",
			"hindsight_embedding",
		]);
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
		await providerConfigServer.close();
	}
});

test("projectLocalRuntimeEnv keeps non-Hindsight explicit process overrides over local files", async () => {
	const tmp = await mkdtemp(path.join(tmpdir(), "campus-runtime-projection-"));
	const providerConfigServer = new ActiveProviderConfigServer();
	await providerConfigServer.listen();
	const repoEnvPath = path.join(tmp, ".env");
	const appApiEnvPath = path.join(tmp, "app-api.env");
	const appApiDevVarsPath = path.join(tmp, ".dev.vars");
	const generatedRuntimeEnvPath = path.join(tmp, "runtime.env");

	await writeFile(repoEnvPath, "LLM_API_KEY=file-llm-key\nLLM_MODEL=file-model\n");
	await writeFile(appApiEnvPath, "");
	await writeFile(
		appApiDevVarsPath,
		`APP_API_INTERNAL_SHARED_SECRET=file-internal\nAPP_API_INTERNAL_BASE_URL=${providerConfigServer.baseUrl}\n`,
	);
	await writeFile(
		generatedRuntimeEnvPath,
		"QDRANT_READ_ONLY_API_KEY=file-qdrant-readonly\nEXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT=salt\n",
	);

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
			repoEnvPath,
			repoRoot: tmp,
		});

		assert.equal(result.env.HINDSIGHT_API_LLM_API_KEY, "active-llm-secret");
		assert.equal(result.env.EXECUTION_CONTROL_APP_API_INTERNAL_SHARED_SECRET, "process-internal");
		assert.equal(result.env.QDRANT_QUERY_API_KEY, "process-qdrant-query");
	} finally {
		await rm(tmp, { force: true, recursive: true });
		await providerConfigServer.close();
	}
});

test("projectLocalRuntimeEnv fails closed without active Hindsight provider profiles", async () => {
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
			/Hindsight provider-config projection requires active app-api provider profile/,
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

class ActiveProviderConfigServer {
	#server = createServer((request, response) => {
		const url = new URL(request.url ?? "", "http://127.0.0.1");
		const role = url.searchParams.get("role") ?? "";
		this.requests.push({
			auth: request.headers["x-app-internal-auth"] ?? "",
			role,
		});
		response.setHeader("content-type", "application/json");
		if (role === "hindsight_llm") {
			response.end(
				JSON.stringify({
					profile: {
						api_key: "active-llm-secret",
						base_url: "https://active-llm.example/v1",
						kind: "prompt",
						model: "gpt-active-memory",
						profile_id: "provider_profile_hindsight_llm",
						provider: "openai",
						revision: 3,
						role,
						timeout_ms: 30000,
						transport: "responses",
					},
				}),
			);
			return;
		}
		if (role === "hindsight_embedding") {
			response.end(
				JSON.stringify({
					profile: {
						api_key: "active-embedding-secret",
						base_url: "https://active-embedding.example/v1",
						dimensions: 2560,
						kind: "embedding",
						model: "embedding-active-memory",
						profile_id: "provider_profile_hindsight_embedding",
						provider: "openai",
						revision: 3,
						role,
						timeout_ms: 30000,
						transport: "embeddings",
					},
				}),
			);
			return;
		}
		response.statusCode = 404;
		response.end(JSON.stringify({ error: { code: "provider_profile_missing" } }));
	});

	baseUrl = "";
	requests = [];

	async listen() {
		await new Promise((resolve) => {
			this.#server.listen(0, "127.0.0.1", resolve);
		});
		const address = this.#server.address();
		if (!address || typeof address === "string") {
			throw new Error("test server did not expose a TCP address");
		}
		this.baseUrl = `http://127.0.0.1:${address.port}`;
	}

	async close() {
		await new Promise((resolve, reject) => {
			this.#server.close((error) => {
				if (error) {
					reject(error);
					return;
				}
				resolve();
			});
		});
	}

	requestedRoles() {
		return this.requests.map((request) => request.role);
	}
}
