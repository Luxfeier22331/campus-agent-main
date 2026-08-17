import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const sourceRoot = join(import.meta.dirname, "../src");

function read(relativePath: string): string {
	return readFileSync(join(sourceRoot, relativePath), "utf8");
}

describe("eval-langfuse shared module boundary", () => {
	it("keeps the shared entry as an explicit compatibility facade", () => {
		const source = read("shared.ts");

		expect(source).toContain('from "./http"');
		expect(source).toContain('from "./identifiers"');
		expect(source).toContain('from "./json"');
		expect(source).toContain('from "./settings"');
		expect(source).not.toContain("function ");
	});

	it("keeps JSON/file helpers independent from transport and settings", () => {
		const source = read("json.ts");

		expect(source).not.toContain("fetch(");
		expect(source).not.toContain("LANGFUSE_");
		expect(source).not.toContain("createHash");
	});
});
