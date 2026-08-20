import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkProductionArtifact } from "../scripts/check-production-artifact.mjs";

const temporaryDirectories = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
	);
});

async function createArtifact(internalPortalSource = "export {}; ") {
	const directory = await mkdtemp(join(tmpdir(), "ingestion-control-artifact-"));
	temporaryDirectories.push(directory);
	for (const entrypoint of [
		"server.js",
		"migrate.js",
		"schema-bootstrap.js",
		"internal-portal-check.js",
	]) {
		await writeFile(
			join(directory, entrypoint),
			entrypoint === "internal-portal-check.js" ? internalPortalSource : "export {};\n",
		);
	}
	return directory;
}

describe("production artifact check", () => {
	it("requires all runtime entrypoints and loads the portal check entrypoint", async () => {
		const directory = await createArtifact();

		await expect(checkProductionArtifact(directory)).resolves.toEqual({ entrypoints: 4 });
	});

	it("surfaces a missing runtime dependency from the built entrypoint", async () => {
		const directory = await createArtifact('import "missing-production-dependency";\n');

		await expect(checkProductionArtifact(directory)).rejects.toMatchObject({
			code: "ERR_MODULE_NOT_FOUND",
		});
	});
});
