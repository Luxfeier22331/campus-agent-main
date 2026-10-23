import { describe, expect, it } from "vitest";
import { formatCalendarTime } from "../src/lib/date-time";

describe("formatCalendarTime", () => {
	const now = new Date("2026-10-18T14:00:00.000Z"); // 22:00 in Shanghai

	it("names today and yesterday by the Shanghai calendar", () => {
		expect(formatCalendarTime("2026-10-18T11:12:00.000Z", now)).toBe("今天 19:12");
		expect(formatCalendarTime("2026-10-17T16:30:00.000Z", now)).toBe("今天 00:30");
		expect(formatCalendarTime("2026-10-17T15:59:00.000Z", now)).toBe("昨天 23:59");
	});

	it("drops the time for older dates and adds the year across years", () => {
		expect(formatCalendarTime("2026-07-16T00:00:00.000Z", now)).toBe("7月16日");
		expect(formatCalendarTime("2025-12-31T16:00:00.000Z", now)).toBe("1月1日");
		expect(formatCalendarTime("2025-12-31T12:00:00.000Z", now)).toBe("2025年12月31日");
	});

	it("returns unparseable input unchanged", () => {
		expect(formatCalendarTime("not-a-date", now)).toBe("not-a-date");
	});
});
