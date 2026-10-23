import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

import { describe, expect, it } from "vitest";

const appRoot = existsSync(resolve(process.cwd(), "vitest.database-integration.config.mts"))
	? process.cwd()
	: resolve(process.cwd(), "apps/ops-web");

async function readAppFile(relativePath: string): Promise<string> {
	return readFile(resolve(appRoot, relativePath), "utf8");
}

describe("Ops Web PostgreSQL validation topology", () => {
	it("uses the unified schema job for the current profile", async () => {
		const setup = await readAppFile("test/ops-web-postgres.global-setup.ts");
		expect(setup).toContain("jobs/campus-agent-schema");
		expect(setup).toContain("PGUSER");
		expect(setup).toContain('const SCHEMA_OWNER = "campus_agent"');
	});

	it("exposes only the current database integration profile", async () => {
		const currentConfig = await readAppFile("vitest.database-integration.config.mts");
		expect(currentConfig).toContain("ops-web-database.integration.test.ts");
	});
});
