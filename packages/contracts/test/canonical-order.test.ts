import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { compareCanonicalStrings } from "../src/canonical-order";

describe("compareCanonicalStrings", () => {
	it("orders by UTF-16 code units, independent of runtime locale", () => {
		expect(compareCanonicalStrings("", "")).toBe(0);
		expect(compareCanonicalStrings("a", "a")).toBe(0);
		expect(compareCanonicalStrings("a", "b")).toBe(-1);
		expect(compareCanonicalStrings("b", "a")).toBe(1);
		// "Z" (0x5A) must sort before "a" (0x61); locale collations typically
		// fold case and order them differently.
		expect(compareCanonicalStrings("Z", "a")).toBeLessThan(0);
		// Combining characters must not be compared by collation equivalence.
		expect(compareCanonicalStrings("e\u0301", "\u00e9")).not.toBe(0);
	});

	it("matches Array.prototype.sort default order", () => {
		const values = ["b", "A", "a", "", "\u4e2d\u6587", "e\u0301", "\u00e9", "10", "2"];
		const sorted = [...values].sort(compareCanonicalStrings);
		expect(sorted).toEqual([...values].sort());
	});

	it("is a valid comparator (antisymmetric and transitive)", () => {
		const values = ["b", "A", "a", "", "中", "文", "e\u0301", "10", "2"];
		for (const left of values) {
			for (const right of values) {
				const forward = Math.sign(compareCanonicalStrings(left, right));
				const backward = Math.sign(compareCanonicalStrings(right, left));
				expect(forward + backward).toBe(0);
			}
		}
		expect([...values].sort(compareCanonicalStrings)).toEqual(
			[...values].sort(compareCanonicalStrings).sort(compareCanonicalStrings),
		);
	});

	it("produces the same ordering as a different-locale process", () => {
		const values = ["b", "A", "a", "Z", "中文", "文", "e\u0301", "\u00e9", "10", "2", "æ"];
		const expected = [...values].sort(compareCanonicalStrings);
		const program = `
			const values = ${JSON.stringify(values)};
			console.log(JSON.stringify(values.slice().sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))));
		`;
		for (const locale of ["de_DE.UTF-8", "zh_CN.UTF-8", "C.UTF-8"]) {
			const output = execFileSync(process.execPath, ["-e", program], {
				env: { ...process.env, LC_ALL: locale, LANG: locale },
				encoding: "utf8",
			});
			expect(JSON.parse(output)).toEqual(expected);
		}
	});
});
