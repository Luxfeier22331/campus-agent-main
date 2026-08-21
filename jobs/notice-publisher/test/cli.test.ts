import { describe, expect, it } from "vitest";

import { parsePublishArgs } from "../src/cli.ts";

describe("notice publisher CLI", () => {
	it("uses online classification artifacts for an unfiltered publish", () => {
		expect(parsePublishArgs([])).toEqual({ classifications: null, noticeIds: [] });
	});

	it("retains local JSONL input and repeated selected notice IDs", () => {
		expect(
			parsePublishArgs([
				"--classifications",
				"/tmp/classifications.jsonl",
				"--notice-id",
				"358159",
				"--notice-id",
				"358160",
			]),
		).toEqual({
			classifications: "/tmp/classifications.jsonl",
			noticeIds: [358159, 358160],
		});
	});

	it.each([
		["--unknown"],
		["--classifications"],
		["--notice-id"],
		["--notice-id", "0"],
		["--notice-id", "not-a-number"],
	])("rejects malformed arguments", (...args) => {
		expect(() => parsePublishArgs(args)).toThrow(/unknown or invalid argument/u);
	});
});
