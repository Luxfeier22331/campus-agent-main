import { describe, expect, it } from "vitest";

import { inferImageExtension } from "../src/capture-media.ts";

describe("WeChat capture media helpers", () => {
	it("infers image extensions through MIME data before URL suffix fallback", () => {
		expect(
			inferImageExtension({
				contentType: "image/jpeg; charset=utf-8",
				sourceUrl: "https://mmbiz.qpic.cn/example/media?wx_fmt=jpeg",
			}),
		).toBe(".jpg");
		expect(
			inferImageExtension({
				contentType: "image/avif",
				sourceUrl: "https://mmbiz.qpic.cn/example/media",
			}),
		).toBe(".avif");
		expect(
			inferImageExtension({
				contentType: "application/octet-stream",
				sourceUrl: "https://mmbiz.qpic.cn/example/media.bin?wx_fmt=png",
			}),
		).toBe(".bin");
	});
});
