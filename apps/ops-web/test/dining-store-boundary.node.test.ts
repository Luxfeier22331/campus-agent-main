// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const serverRoot = join(import.meta.dirname, "../src/server");

function read(relativePath: string): string {
	return readFileSync(join(serverRoot, relativePath), "utf8");
}

describe("dining store boundary", () => {
	it("keeps menu and review persistence as independent concrete stores", () => {
		const menu = read("dining-menu-store.ts");
		const reviews = read("dining-review-store.ts");

		expect(menu).not.toContain("dining-review-store");
		expect(reviews).not.toContain("dining-menu-store");
		expect(existsSync(join(serverRoot, "dining-content-store.ts"))).toBe(false);
	});

	it("constructs both stores only in the dining assembly", () => {
		const assembly = read("dining-stores.ts");

		expect(assembly).toContain("createPgDiningMenuStore");
		expect(assembly).toContain("createPgDiningReviewStore");
		expect(assembly).toContain("pool: input.pool");
		expect(existsSync(join(serverRoot, "dining-database.ts"))).toBe(false);
	});
});
