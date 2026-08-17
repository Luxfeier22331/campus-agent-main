// @vitest-environment node

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const serverRoot = join(import.meta.dirname, "../src/server");

function read(relativePath: string): string {
	return readFileSync(join(serverRoot, relativePath), "utf8");
}

describe("ops status store boundary", () => {
	it("keeps types independent from concrete store implementations", () => {
		const source = read("ops-status-types.ts");
		expect(source).not.toContain("pg-ops-status-store");
		expect(source).not.toContain("fixture-ops-status-store");
	});

	it("keeps implementation selection in the factory", () => {
		const factory = read("ops-status-factory.ts");
		const pgStore = read("pg-ops-status-store.ts");

		expect(factory).toContain("createPgOpsStatusStore");
		expect(pgStore).toContain('from "./ops-status-types.ts"');
		expect(pgStore).not.toContain("ops-status-factory");
	});
});
