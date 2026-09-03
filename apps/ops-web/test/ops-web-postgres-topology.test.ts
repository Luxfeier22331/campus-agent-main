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
		expect(setup).not.toContain("migrateNotices");
		expect(setup).not.toContain("installAppApiSchema");
		expect(setup).not.toContain("run-projection-schema");
	});

	it("keeps historical runners behind the legacy profile", async () => {
		const setup = await readAppFile("test/ops-web-postgres-legacy.global-setup.ts");
		const config = await readAppFile("vitest.database-legacy-integration.config.mts");
		expect(setup).toContain("migrateNotices");
		expect(setup).toContain("installAppApiSchema");
		expect(setup).toContain("run-projection-schema");
		expect(config).toContain("ops-web-postgres-legacy.global-setup.ts");
		expect(config).toContain("ops-web-database-legacy.integration.test.ts");
	});

	it("keeps current and legacy test files in disjoint profiles", async () => {
		const currentConfig = await readAppFile("vitest.database-integration.config.mts");
		const legacyConfig = await readAppFile("vitest.database-legacy-integration.config.mts");
		expect(currentConfig).toContain("ops-web-database.integration.test.ts");
		expect(currentConfig).not.toContain("ops-web-database-legacy.integration.test.ts");
		expect(currentConfig).not.toContain("ops-web-postgres-legacy.global-setup.ts");
		expect(legacyConfig).not.toContain("ops-web-database.integration.test.ts");
		expect(legacyConfig).toContain("ops-web-database-legacy.integration.test.ts");
	});
});
