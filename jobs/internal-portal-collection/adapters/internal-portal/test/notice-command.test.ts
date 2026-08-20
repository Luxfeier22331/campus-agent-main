import { describe, expect, it } from "vitest";

import { parseNoticeCommand } from "../src/notice-command.js";

describe("notice command", () => {
	it("parses the serial sync and backfill commands", () => {
		expect(parseNoticeCommand(["sync"])).toEqual({ name: "sync" });
		expect(parseNoticeCommand(["backfill", "--start-date", "2026-08-01"])).toEqual({
			name: "backfill",
			startDate: "2026-08-01",
		});
		expect(() => parseNoticeCommand(["sync", "--concurrency", "2"])).toThrow(
			"does not accept additional arguments",
		);
		expect(() => parseNoticeCommand(["status"])).toThrow("sync or backfill");
	});
});
