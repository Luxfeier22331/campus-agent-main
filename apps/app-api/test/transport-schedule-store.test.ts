import {
	transportRoutes,
	transportScheduleItems,
	transportSchedulePeriods,
} from "@campus-agent/transport/schema";
import { describe, expect, it, vi } from "vitest";
import type { RuntimeDatabase } from "../src/db/runtime";
import { createPgTransportScheduleService } from "../src/modules/transport/schedule-store";

const ROUTE_ID = "route:test";
const DATE = "2026-09-07";

describe("transport schedule public projection", () => {
	it("reads the three tables once for a whole month and applies the same period precedence as Ops", async () => {
		const db = fakeDatabase({
			routes: [route()],
			periods: [
				period({ scheduleId: "a" }),
				{ ...period({ scheduleId: "b" }), updatedAt: new Date("2026-09-01T00:00:00Z") },
			],
			items: [
				item({ scheduleId: "a", itemId: "a:0", departureTime: "07:30" }),
				item({ scheduleId: "b", itemId: "b:0", departureTime: "08:30" }),
			],
		});
		const select = vi.spyOn(db, "select");
		const service = createPgTransportScheduleService({} as never, { getDb: async () => db });
		const range = await service.getRange("2026-09-01", "2026-09-30");
		expect(select).toHaveBeenCalledTimes(3);
		expect(range.days).toHaveLength(30);
		expect(range.days.find((day) => day.date === DATE)?.routes[0]?.departures[0]).toMatchObject({
			departureTime: "08:30",
		});
		for (const day of range.days) {
			expect(await service.getSchedule(day.date)).toEqual(day);
		}
	});
	it.each([
		{
			label: "weekend discovery from a weekday",
			date: "2026-09-09",
			extra: [],
			expected: "2026-09-12",
		},
		{ label: "today is operating", date: "2026-09-12", extra: [], expected: "2026-09-12" },
		{
			label: "suspension longer than a week",
			date: "2026-09-09",
			extra: [
				period({
					scheduleId: "closed",
					validFrom: "2026-09-12",
					validTo: "2026-12-31",
					status: "suspended",
				}),
			],
			expected: "2027-01-02",
		},
		{
			label: "indefinite suspension",
			date: "2026-09-09",
			extra: [period({ scheduleId: "closed", validFrom: "2026-09-12", status: "suspended" })],
			expected: null,
		},
		{
			label: "an operating exception inside suspension",
			date: "2026-09-09",
			extra: [
				period({ scheduleId: "closed", validFrom: "2026-09-12", status: "suspended" }),
				period({ scheduleId: "reopened", validFrom: "2026-10-10", validTo: "2026-10-10" }),
			],
			expected: "2026-10-10",
		},
	])("returns a catalog and resolves $label", async ({ date, extra, expected }) => {
		const periods = [period({ scheduleId: "weekend", weekdays: [6, 7] }), ...extra];
		const db = fakeDatabase({
			routes: [route()],
			periods,
			items: periods
				.filter((p) => p.status === "operating")
				.map((p) => item({ itemId: `${p.scheduleId}:0`, scheduleId: p.scheduleId })),
		});
		const result = await createPgTransportScheduleService({} as never, {
			getDb: async () => db,
		}).getSchedule(date);
		expect(result.routeCatalog).toHaveLength(1);
		expect(result.routeCatalog[0]).toMatchObject({
			routeId: ROUTE_ID,
			nextServiceDate: expected,
			dropOffPoint: "东门",
		});
		if (date === "2026-09-09") {
			expect(result.routes).toHaveLength(0);
		}
	});

	it("keeps expired and unconfigured routes discoverable without inventing future dates", async () => {
		for (const periods of [[], [period({ scheduleId: "ended", validTo: "2026-09-06" })]]) {
			const db = fakeDatabase({
				routes: [route()],
				periods,
				items: periods.map((p) => item({ scheduleId: p.scheduleId, itemId: "ended:0" })),
			});
			const result = await createPgTransportScheduleService({} as never, {
				getDb: async () => db,
			}).getSchedule(DATE);
			expect(result.routes).toEqual([]);
			expect(result.routeCatalog[0]?.nextServiceDate).toBeNull();
		}
	});
	it("selects the most specific applicable complete period", async () => {
		const db = fakeDatabase({
			routes: [route()],
			periods: [
				period({ scheduleId: "baseline", validFrom: "2026-08-31", note: "基础班次" }),
				period({
					scheduleId: "special",
					validFrom: "2026-09-07",
					validTo: "2026-09-07",
					note: "今天调整",
				}),
			],
			items: [
				item({ departureTime: "07:30", itemId: "baseline:0", scheduleId: "baseline" }),
				item({ departureTime: "08:00", itemId: "special:0", scheduleId: "special" }),
			],
		});

		const result = await createPgTransportScheduleService({} as never, {
			getDb: async () => db,
		}).getSchedule(DATE);

		expect(result).toEqual({
			date: DATE,
			routeCatalog: [
				{
					boardingGuide: "企业微信 → 工作台 → 接驳车预约",
					dropOffPoint: "东门",
					defaultBoardingPoint: "默认乘车点",
					origin: "丰台校区",
					destination: "海淀校区",
					routeId: ROUTE_ID,
					serviceKind: "commute",
					nextServiceDate: DATE,
				},
			],
			routes: [
				{
					boardingPoint: "默认乘车点",
					departures: [
						{
							boardingPoint: "默认乘车点",
							capacity: null,
							departureTime: "08:00",
							kind: "fixed",
							note: null,
							riderType: "all",
						},
					],
					destination: "海淀校区",
					note: "今天调整",
					origin: "丰台校区",
					routeId: ROUTE_ID,
					serviceKind: "commute",
					status: "operating",
				},
			],
		});
	});

	it("returns a suspended period without returning schedule items", async () => {
		const db = fakeDatabase({
			routes: [route()],
			periods: [period({ scheduleId: "suspended", status: "suspended" })],
			items: [],
		});

		const result = await createPgTransportScheduleService({} as never, {
			getDb: async () => db,
		}).getSchedule(DATE);

		expect(result.routes[0]).toMatchObject({
			departures: [],
			status: "suspended",
		});
	});

	it("preserves interval items and period boarding point overrides", async () => {
		const db = fakeDatabase({
			routes: [route()],
			periods: [
				period({
					boardingPointOverride: "临时乘车点",
					scheduleId: "interval",
				}),
			],
			items: [
				item({
					boardingPoint: null,
					capacity: 40,
					departureTime: null,
					firstDepartureTime: "08:00",
					intervalMinutes: 30,
					itemId: "interval:0",
					kind: "interval",
					lastDepartureTime: "10:00",
					scheduleId: "interval",
				}),
			],
		});

		const result = await createPgTransportScheduleService({} as never, {
			getDb: async () => db,
		}).getSchedule(DATE);

		expect(result.routes[0]?.boardingPoint).toBe("临时乘车点");
		expect(result.routes[0]?.departures).toEqual([
			{
				boardingPoint: "临时乘车点",
				capacity: 40,
				firstDepartureTime: "08:00",
				intervalMinutes: 30,
				kind: "interval",
				lastDepartureTime: "10:00",
				note: null,
				riderType: "all",
			},
		]);
	});

	it("prefers an item boarding point over period and route defaults", async () => {
		const db = fakeDatabase({
			routes: [route()],
			periods: [period({ boardingPointOverride: "时间段乘车点", scheduleId: "item-point" })],
			items: [
				item({
					boardingPoint: "班次乘车点",
					itemId: "item-point:0",
					scheduleId: "item-point",
				}),
			],
		});

		const result = await createPgTransportScheduleService({} as never, {
			getDb: async () => db,
		}).getSchedule(DATE);

		expect(result.routes[0]).toMatchObject({
			boardingPoint: "时间段乘车点",
			departures: [{ boardingPoint: "班次乘车点" }],
		});
	});
});

function route() {
	return {
		boardingGuide: "企业微信 → 工作台 → 接驳车预约",
		dropOffPoint: "东门",
		createdAt: new Date("2026-08-01T00:00:00.000Z"),
		defaultBoardingPoint: "默认乘车点",
		destination: "海淀校区",
		displayOrder: 0,
		origin: "丰台校区",
		routeId: ROUTE_ID,
		serviceKind: "commute",
		updatedAt: new Date("2026-08-01T00:00:00.000Z"),
		updatedBy: "test",
	};
}

function period(input: {
	boardingPointOverride?: string | null;
	scheduleId: string;
	status?: "operating" | "suspended";
	validFrom?: string;
	validTo?: string | null;
	note?: string | null;
	weekdays?: number[];
}) {
	return {
		boardingPointOverride: input.boardingPointOverride ?? null,
		createdAt: new Date("2026-08-01T00:00:00.000Z"),
		note: input.note ?? null,
		routeId: ROUTE_ID,
		scheduleId: input.scheduleId,
		status: input.status ?? "operating",
		updatedAt: new Date("2026-08-01T00:00:00.000Z"),
		updatedBy: "test",
		validFrom: input.validFrom ?? "2026-08-31",
		validTo: input.validTo === undefined ? null : input.validTo,
		weekdays: input.weekdays ?? [1, 2, 3, 4, 5, 6, 7],
	};
}

function item(input: {
	boardingPoint?: string | null;
	capacity?: number | null;
	departureTime?: string | null;
	firstDepartureTime?: string | null;
	intervalMinutes?: number | null;
	itemId: string;
	kind?: "fixed" | "interval";
	lastDepartureTime?: string | null;
	scheduleId: string;
}) {
	const kind = input.kind ?? "fixed";
	return {
		boardingPoint: input.boardingPoint ?? null,
		capacity: input.capacity ?? null,
		departureTime: input.departureTime === undefined ? "07:30" : input.departureTime,
		firstDepartureTime: input.firstDepartureTime ?? null,
		intervalMinutes: input.intervalMinutes ?? null,
		itemId: input.itemId,
		kind,
		lastDepartureTime: input.lastDepartureTime ?? null,
		note: null,
		riderType: "all",
		scheduleId: input.scheduleId,
		sortOrder: 0,
	};
}

function fakeDatabase(input: {
	items: unknown[];
	periods: unknown[];
	routes: unknown[];
}): RuntimeDatabase {
	const rowsFor = (table: unknown) => {
		if (table === transportRoutes) {
			return input.routes;
		}
		if (table === transportSchedulePeriods) {
			return input.periods;
		}
		if (table === transportScheduleItems) {
			return input.items;
		}
		throw new Error("unexpected transport table");
	};
	return {
		select: () => ({
			from: (table: unknown) => {
				const rows = rowsFor(table);
				return Object.assign(Promise.resolve(rows), {
					orderBy: async () => rows,
				});
			},
		}),
	} as never;
}
