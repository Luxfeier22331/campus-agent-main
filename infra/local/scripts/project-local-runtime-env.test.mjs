import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { projectLocalRuntimeEnv } from "./project-local-runtime-env.mjs";

test("projectLocalRuntimeEnv derives local runtime values from root provider inputs", async () => {
	const tmp = await mkdtemp(path.join(tmpdir(), "campus-runtime-projection-"));
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

		assert.equal(result.env.HINDSIGHT_API_LLM_API_KEY, "llm-secret");
		assert.equal(result.env.HINDSIGHT_API_LLM_BASE_URL, "https://llm.example/v1");
		assert.equal(result.env.HINDSIGHT_API_LLM_MODEL, "gpt-local");
		assert.equal(result.env.HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY, "embedding-secret");
		assert.equal(result.env.HINDSIGHT_API_EMBEDDINGS_OPENAI_BASE_URL, "https://embedding.example/v1");
		assert.equal(result.env.HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL, "embedding-local");
		assert.equal(result.env.QDRANT_QUERY_API_KEY, "readonly-qdrant-secret");
		assert.equal(
			result.env.CAMPUS_SHARED_POSTGRES_URL,
			"postgresql://postgres:postgres@campus-agent-postgres:5432/campus_agent?sslmode=disable",
		);
		assert.equal(result.env.EXECUTION_CONTROL_COMPOSE_PROJECT_NAME, "campus-runtime-test");
		assert.match(result.env.EXECUTION_CONTROL_RUNTIME_RELEASE, /^execution-control@/);

		const syncedDevVars = await readFile(appApiDevVarsPath, "utf8");
		assert.match(syncedDevVars, /^APP_API_INTERNAL_SHARED_SECRET=generated-internal-secret$/m);
		assert.match(
			syncedDevVars,
			/^APP_API_PROVIDER_CONFIG_ENCRYPTION_KEY=generated-provider-secret$/m,
		);
	} finally {
		await rm(tmp, { force: true, recursive: true });
	}
});

test("projectLocalRuntimeEnv keeps explicit process overrides over local files", async () => {
	const tmp = await mkdtemp(path.join(tmpdir(), "campus-runtime-projection-"));
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

		assert.equal(result.env.HINDSIGHT_API_LLM_API_KEY, "process-llm-key");
		assert.equal(result.env.EXECUTION_CONTROL_APP_API_INTERNAL_SHARED_SECRET, "process-internal");
		assert.equal(result.env.QDRANT_QUERY_API_KEY, "process-qdrant-query");
	} finally {
		await rm(tmp, { force: true, recursive: true });
	}
});
