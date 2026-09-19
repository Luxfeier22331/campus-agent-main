import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CITATION_REASONS, CitationDiagnosticSchema } from "../src/citation-diagnostic.ts";

const fixtures = JSON.parse(
	readFileSync(new URL("../fixtures/citation-diagnostic.v1.json", import.meta.url), "utf8"),
) as { reasons: string[]; cases: { name: string; valid: boolean; citation: unknown }[] };
describe("citation diagnostic v1", () => {
	it("owns the complete reason catalog", () =>
		expect(Object.keys(CITATION_REASONS).sort()).toEqual(fixtures.reasons.sort()));
	it.each(fixtures.cases)("$name", ({ citation, valid }) =>
		expect(CitationDiagnosticSchema.safeParse(citation).success).toBe(valid),
	);
});
