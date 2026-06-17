import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { ensureZepCeSecrets } from "./ensure-zep-ce-secrets.mjs";

test("ensureZepCeSecrets creates missing local Zep CE secrets without overwriting existing values", async () => {
	const tmp = await mkdtemp(path.join(tmpdir(), "campus-zep-secrets-"));
	const envPath = path.join(tmp, "zep-ce.env");
	await writeFile(
		envPath,
		[
			"PERSONAL_MEMORY_API_SECRET=existing-api-secret",
			"ZEP_CE_OPENAI_API_KEY=retired-random-provider-key",
			"",
		].join("\n"),
		{ mode: 0o600 },
	);

	try {
		await ensureZepCeSecrets({ envPath });

		const content = await readFile(envPath, "utf8");
		assert.match(content, /^PERSONAL_MEMORY_API_SECRET=existing-api-secret$/m);
		for (const key of [
			"PERSONAL_MEMORY_OWNER_SALT",
			"ZEP_CE_POSTGRES_PASSWORD",
			"ZEP_CE_NEO4J_PASSWORD",
		]) {
			assert.match(content, new RegExp(`^${key}=.+$`, "m"));
		}
		assert.doesNotMatch(content, /^ZEP_CE_OPENAI_API_KEY=/m);

		const firstWrite = content;
		await ensureZepCeSecrets({ envPath });
		assert.equal(await readFile(envPath, "utf8"), firstWrite);

		if (process.platform !== "win32") {
			assert.equal((await stat(envPath)).mode & 0o777, 0o600);
		}
	} finally {
		await rm(tmp, { force: true, recursive: true });
	}
});
