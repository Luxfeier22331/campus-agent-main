import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { ensureRuntimeSecrets } from "./ensure-runtime-secrets.mjs";

test("ensureRuntimeSecrets creates missing local runtime secrets without overwriting existing values", async () => {
	const tmp = await mkdtemp(path.join(tmpdir(), "campus-runtime-secrets-"));
	const envPath = path.join(tmp, "runtime.env");
	await writeFile(
		envPath,
		[
			"PERSONAL_MEMORY_API_SECRET=existing-api-secret",
			"ZEP_CE_POSTGRES_PASSWORD=retired-zep-password",
			"",
		].join("\n"),
		{ mode: 0o600 },
	);

	try {
		await ensureRuntimeSecrets({ envPath });

		const content = await readFile(envPath, "utf8");
		assert.match(content, /^PERSONAL_MEMORY_API_SECRET=existing-api-secret$/m);
		for (const key of [
			"APP_API_INTERNAL_SHARED_SECRET",
			"APP_API_PROVIDER_CONFIG_ENCRYPTION_KEY",
			"PERSONAL_MEMORY_OWNER_SALT",
			"TEMPORAL_POSTGRES_PASSWORD",
			"EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT",
			"HINDSIGHT_POSTGRES_PASSWORD",
			"EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET",
			"EXECUTION_CONTROL_METRICS_BEARER_TOKEN",
			"QDRANT_API_KEY",
			"QDRANT_READ_ONLY_API_KEY",
			"LANGFUSE_NEXTAUTH_SECRET",
			"LANGFUSE_SALT",
			"LANGFUSE_POSTGRES_PASSWORD",
			"LANGFUSE_CLICKHOUSE_PASSWORD",
			"LANGFUSE_REDIS_AUTH",
			"LANGFUSE_MINIO_ROOT_PASSWORD",
			"LANGFUSE_INIT_USER_PASSWORD",
		]) {
			assert.match(content, new RegExp(`^${key}=.+$`, "m"));
		}
		assert.match(content, /^LANGFUSE_ENCRYPTION_KEY=[0-9a-f]{64}$/m);
		assert.match(content, /^LANGFUSE_INIT_PROJECT_PUBLIC_KEY=pk-lf-local-.+$/m);
		assert.match(content, /^LANGFUSE_INIT_PROJECT_SECRET_KEY=sk-lf-local-.+$/m);
		assert.doesNotMatch(content, /^ZEP_CE_POSTGRES_PASSWORD=/m);

		const firstWrite = content;
		await ensureRuntimeSecrets({ envPath });
		assert.equal(await readFile(envPath, "utf8"), firstWrite);

		if (process.platform !== "win32") {
			assert.equal((await stat(envPath)).mode & 0o777, 0o600);
		}
	} finally {
		await rm(tmp, { force: true, recursive: true });
	}
});
