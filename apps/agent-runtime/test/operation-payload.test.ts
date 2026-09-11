import { describe, expect, it } from "vitest";
import { encodeOperationPayload, MAX_OPERATION_PAYLOAD_BYTES } from "../src/operation-payload.ts";

describe("complete operation payload budget", () => {
	it.each([-1, 0, 1])("checks encoded envelope at limit %+d", (delta) => {
		const value = {
			answer: "x".repeat(MAX_OPERATION_PAYLOAD_BYTES - '{"answer":""}'.length + delta),
		};
		const encode = () => encodeOperationPayload(value);
		if (delta > 0) {
			expect(encode).toThrow("byte budget");
		} else {
			expect(Buffer.byteLength(encode())).toBe(MAX_OPERATION_PAYLOAD_BYTES + delta);
		}
	});
	it("counts UTF8 and JSON escaping rather than string characters", () => {
		for (const text of [
			"😀".repeat(MAX_OPERATION_PAYLOAD_BYTES / 4),
			"\n".repeat(MAX_OPERATION_PAYLOAD_BYTES / 2),
		]) {
			expect(() => encodeOperationPayload({ answer: text })).toThrow("byte budget");
		}
	});
});
