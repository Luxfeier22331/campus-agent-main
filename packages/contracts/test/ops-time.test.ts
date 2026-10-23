import { describe, expect, it } from "vitest";
import {
	dateRangeQuery,
	resolveTimeQuery,
	timeQueryCacheKey,
	timeQuerySchema,
} from "../src/ops-time";

const now = new Date("2026-09-17T04:34:56.000Z");
describe("Ops time ranges", () => {
	it.each([
		["today", "2026-09-16T16:00:00.000Z", now.toISOString()],
		["24h", "2026-09-16T04:34:56.000Z", now.toISOString()],
		["this-week", "2026-09-13T16:00:00.000Z", now.toISOString()],
		["this-month", "2026-08-31T16:00:00.000Z", now.toISOString()],
		["last-month", "2026-07-31T16:00:00.000Z", "2026-08-31T16:00:00.000Z"],
		["30d", "2026-08-18T04:34:56.000Z", now.toISOString()],
	] as const)("resolves %s in Beijing time", (window, from, to) => {
		expect(resolveTimeQuery({ window }, "overview", now)).toEqual({ from, to });
	});
	it.each(["overview", "requests", "conversations", "accountEvents"] as const)(
		"defaults %s to today",
		(scope) => {
			expect(resolveTimeQuery({}, scope, now).from).toBe("2026-09-16T16:00:00.000Z");
		},
	);
	it("starts the week on Monday and permits an empty today at midnight", () => {
		const midnight = new Date("2026-09-13T16:00:00Z");
		expect(resolveTimeQuery({ window: "this-week" }, "overview", midnight)).toEqual({
			from: midnight.toISOString(),
			to: midnight.toISOString(),
		});
	});
	it.each([
		["2024-03-10T00:00:00Z", "2024-01-31T16:00:00.000Z", "2024-02-29T16:00:00.000Z"],
		["2026-01-10T00:00:00Z", "2025-11-30T16:00:00.000Z", "2025-12-31T16:00:00.000Z"],
	])("handles previous month at %s", (at, from, to) => {
		expect(resolveTimeQuery({ window: "last-month" }, "overview", new Date(at))).toEqual({
			from,
			to,
		});
	});
	it("includes both date inputs using an exclusive next-midnight endpoint", () => {
		expect(dateRangeQuery("2026-09-17", "2026-09-17")).toEqual({
			from: "2026-09-16T16:00:00.000Z",
			to: "2026-09-17T16:00:00.000Z",
		});
		expect(() => dateRangeQuery("2026-01-01", "2026-03-31")).not.toThrow();
		expect(() => dateRangeQuery("2026-01-01", "2026-04-01")).toThrow();
		expect(() => dateRangeQuery("2026-02-30", "2026-03-01")).toThrow();
		expect(() => dateRangeQuery("2026-09-18", "2026-09-17")).toThrow();
	});
	it("rejects removed windows, partial bounds, conflicting presets and zero spans", () => {
		for (const query of [
			{ window: "1h" },
			{ from: now.toISOString() },
			{ window: "today", ...dateRangeQuery("2026-09-17", "2026-09-17") },
			{ from: now.toISOString(), to: now.toISOString() },
		]) {
			expect(timeQuerySchema("conversations").safeParse(query).success).toBe(false);
		}
	});
	it("separates calendar periods and custom intervals while sharing rolling cache keys", () => {
		for (const window of ["today", "this-week", "this-month", "last-month"] as const) {
			expect(timeQueryCacheKey({ window }, resolveTimeQuery({ window }, "overview", now))).not.toBe(
				timeQueryCacheKey(
					{ window },
					resolveTimeQuery({ window }, "overview", new Date("2026-10-05T04:00:00Z")),
				),
			);
		}
		expect(
			timeQueryCacheKey({ window: "24h" }, resolveTimeQuery({ window: "24h" }, "overview", now)),
		).toBe("24h");
	});
});
