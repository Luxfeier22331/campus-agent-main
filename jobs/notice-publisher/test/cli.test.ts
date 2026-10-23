import { describe, expect, it } from "vitest";

import { parsePublishArgs, parseRepublishArgs } from "../src/cli.ts";

describe("notice publisher CLI", () => {
	it("publishes all pending notices by default", () => {
		expect(parsePublishArgs([])).toEqual({ noticeIds: [] });
	});

	it("accepts repeated selected notice IDs", () => {
		expect(
			parsePublishArgs([
				"--notice-id",
				"358159",
				"--notice-id",
				"358160",
			]),
		).toEqual({
			noticeIds: [358159, 358160],
		});
	});

	it("allows republishing all published notices or selected notice IDs", () => {
		expect(parseRepublishArgs([])).toEqual({ noticeIds: [] });
		expect(parseRepublishArgs(["--notice-id", "358159"])).toEqual({ noticeIds: [358159] });
	});

	it.each([
		["--unknown"],
		["--notice-id"],
		["--notice-id", "0"],
		["--notice-id", "not-a-number"],
	])("rejects malformed arguments", (...args) => {
		expect(() => parsePublishArgs(args)).toThrow(/unknown or invalid argument/u);
	});
});
