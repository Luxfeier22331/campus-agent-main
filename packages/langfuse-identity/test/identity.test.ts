import { describe, expect, it } from "vitest";
import { deriveLangfuseTraceId, traceParentForLangfuseTraceId } from "../src/index.ts";

describe("Langfuse trace identity", () => {
	it("derives a stable Langfuse trace id from the product trace id", async () => {
		const first = await deriveLangfuseTraceId("trace_0001");
		const second = await deriveLangfuseTraceId(" trace_0001 ");

		expect(first).toMatch(/^[0-9a-f]{32}$/u);
		expect(second).toBe(first);
		expect(await deriveLangfuseTraceId("trace_0002")).not.toBe(first);
	});

	it("creates a valid traceparent for the derived trace", async () => {
		const traceId = await deriveLangfuseTraceId("trace_0001");

		expect(traceParentForLangfuseTraceId(traceId)).toBe(`00-${traceId}-0000000000000001-01`);
	});

	it("rejects empty product ids and malformed Langfuse ids", async () => {
		await expect(deriveLangfuseTraceId("  ")).rejects.toThrow("non-empty product trace id");
		expect(() => traceParentForLangfuseTraceId("trace_0001")).toThrow(
			"32 lowercase hex characters",
		);
	});
});
