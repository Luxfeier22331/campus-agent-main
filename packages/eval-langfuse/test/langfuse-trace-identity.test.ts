import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { deriveLangfuseTraceId, traceParentForLangfuseTraceId } from "../src/index";

const repoRoot = resolve(import.meta.dirname, "../../..");

describe("Langfuse trace identity", () => {
	it("matches the shared trace id vectors", async () => {
		const fixture = JSON.parse(
			readFileSync(
				resolve(repoRoot, "packages/eval-langfuse/test/fixtures/langfuse_trace_id_vectors.json"),
				"utf-8",
			),
		) as {
			vectors: Array<{ product_trace_id: string; langfuse_trace_id: string; traceparent: string }>;
		};

		for (const vector of fixture.vectors) {
			expect(await deriveLangfuseTraceId(vector.product_trace_id)).toBe(vector.langfuse_trace_id);
			expect(traceParentForLangfuseTraceId(vector.langfuse_trace_id)).toBe(vector.traceparent);
		}
	});
});
