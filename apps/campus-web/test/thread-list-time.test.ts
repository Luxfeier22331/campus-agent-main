import { describe, expect, it } from "vitest";

import { formatThreadListTime } from "../src/components/assistant-ui/thread-list-time";

describe("formatThreadListTime", () => {
	const now = new Date(2026, 7, 22, 15, 30);

	it("formats a conversation from today as a clock time", () => {
		expect(formatThreadListTime(new Date(2026, 7, 22, 9, 5), now)).toBe("09:05");
	});

	it("labels yesterday explicitly", () => {
		expect(formatThreadListTime(new Date(2026, 7, 21, 23, 45), now)).toBe("昨天 23:45");
	});

	it("includes the date for older conversations in the current year", () => {
		expect(formatThreadListTime(new Date(2026, 5, 30, 16, 0), now)).toBe("6月30日 16:00");
	});

	it("includes the year for conversations from a previous year", () => {
		expect(formatThreadListTime(new Date(2025, 11, 31, 8, 2), now)).toBe("2025年12月31日 08:02");
	});

	it("uses an explicit label when a conversation has no message time", () => {
		expect(formatThreadListTime(undefined, now)).toBe("未发送");
	});
});
