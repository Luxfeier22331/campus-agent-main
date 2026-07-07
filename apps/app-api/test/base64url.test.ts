import { describe, expect, it } from "vitest";

import {
	decodeBase64UrlBytes,
	decodeBase64UrlJson,
	decodeBase64UrlUtf8,
	encodeBase64UrlBytes,
	encodeBase64UrlJson,
	encodeBase64UrlUtf8,
} from "../src/base64url";

describe("base64url helpers", () => {
	it("round-trips arbitrary bytes without Node Buffer encodings", () => {
		const bytes = new Uint8Array([0, 1, 2, 62, 63, 127, 128, 129, 254, 255]);
		const encoded = encodeBase64UrlBytes(bytes);

		expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(Array.from(decodeBase64UrlBytes(encoded))).toEqual(Array.from(bytes));
	});

	it("round-trips utf8 strings", () => {
		const encoded = encodeBase64UrlUtf8("校园助理 staging smoke");

		expect(decodeBase64UrlUtf8(encoded)).toBe("校园助理 staging smoke");
	});

	it("round-trips json payloads used by cursor encoders", () => {
		const payload = {
			occurredAt: "2026-04-04T13:48:00.000Z",
			requestId: "req_01HR8M8N6S5D2P4",
			selectedTool: "curriculum/curriculum_plan",
		};
		const encoded = encodeBase64UrlJson(payload);

		expect(decodeBase64UrlJson<typeof payload>(encoded)).toEqual(payload);
	});
});
