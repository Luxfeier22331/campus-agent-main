import { describe, expect, it } from "vitest";

import { parseNoticeClassifierOptions } from "../src/options.ts";

describe("notice classifier CLI options", () => {
	it("defaults to concurrency two and scans all notices", () => {
		expect(parseNoticeClassifierOptions([])).toEqual({
			concurrency: 2,
			noticeIds: undefined,
			modelConfigUrl: undefined,
		});
	});

	it("accepts an explicit concurrency and ordered notice ids", () => {
		expect(
			parseNoticeClassifierOptions([
				"--concurrency",
				"3",
				"--notice-id",
				"12",
				"--notice-id",
				"9",
			]),
		).toEqual({ concurrency: 3, modelConfigUrl: undefined, noticeIds: [12, 9] });
	});

	it("accepts an explicit Model Config URL", () => {
		expect(parseNoticeClassifierOptions(["--model-config-url", "http://127.0.0.1:18003/"])).toEqual({
			concurrency: 2,
			modelConfigUrl: "http://127.0.0.1:18003",
			noticeIds: undefined,
		});
	});

	it.each(["0", "-1", "not-a-number"])('rejects invalid concurrency "%s"', (value) => {
		expect(() => parseNoticeClassifierOptions(["--concurrency", value])).toThrow(
			"invalid concurrency",
		);
	});

	it("rejects duplicate or malformed notice ids", () => {
		expect(() =>
			parseNoticeClassifierOptions(["--notice-id", "12", "--notice-id", "12"]),
		).toThrow("duplicate notice id");
		expect(() => parseNoticeClassifierOptions(["--notice-id", "0"])).toThrow("invalid notice id");
	});

	it("rejects a non-http Model Config URL", () => {
		expect(() => parseNoticeClassifierOptions(["--model-config-url", "file:///tmp/model-config"])).toThrow(
			"invalid Model Config URL",
		);
	});
});
