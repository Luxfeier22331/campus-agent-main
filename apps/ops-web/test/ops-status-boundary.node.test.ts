// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const serverRoot = join(import.meta.dirname, "../src/server");
const opsStatusRoot = join(serverRoot, "ops-status");

function read(relativePath: string): string {
	return readFileSync(join(opsStatusRoot, relativePath), "utf8");
}

describe("ops status store boundary", () => {
	it("keeps the contract independent from concrete store implementations", () => {
		const source = read("contract.ts");
		expect(source).not.toContain("./store/");
		expect(source).not.toContain("./mapping/");
		expect(source).not.toContain("./composition/");
	});

	it("keeps implementation selection in the factory", () => {
		const factory = read("composition/factory.ts");
		const pgStore = read("store/postgres.ts");

		expect(factory).toContain('from "../store/postgres.ts"');
		expect(pgStore).toContain('from "../contract.ts"');
		expect(pgStore).toContain('from "../mapping/request.ts"');
		expect(pgStore).not.toContain("composition/factory");
	});

	it("has no legacy flat modules or mapper barrel", () => {
		const legacyPaths = [
			"fixture-ops-status-store.ts",
			"ops-overview-service.ts",
			"ops-status-execution-mappers.ts",
			"ops-status-factory.ts",
			"ops-status-product-mappers.ts",
			"ops-status-request-mappers.ts",
			"ops-status-types.ts",
			"ops-status-unavailable.ts",
			"ops-status-values.ts",
			"pg-ops-status-store.ts",
			"pg-request-query.ts",
		];

		for (const relativePath of legacyPaths) {
			expect(existsSync(join(serverRoot, relativePath))).toBe(false);
		}
		expect(existsSync(join(opsStatusRoot, "mappers.ts"))).toBe(false);
	});
});
