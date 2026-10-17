import { describe, expect, it } from "vitest";

import { buildSparseVector } from "../src/sparse-vector.ts";

describe("unified Campus RAG sparse vectors", () => {
	it("uses the existing publisher tokenization contract", () => {
		expect(buildSparseVector("通知 Notice 通知")).toEqual({
			indices: [408987057, 834646234, 1040992930],
			values: [Math.log1p(1), Math.log1p(2), Math.log1p(2)],
		});
	});
});
