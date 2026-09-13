import {
	transportRoutes,
	transportScheduleItems,
	transportSchedulePeriods,
} from "@campus-agent/transport/schema";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import {
	MAY_DAY_PERIODS,
	SUMMER_PERIODS,
} from "../../../packages/domains/transport/test/fixtures/history";
import type { RuntimeDatabase } from "../src/db/runtime";
import { createPgTransportScheduleService } from "../src/modules/transport/schedule-store";

const ROUTE_ID = "route:test";
const DATE = "2026-09-07";

describe("transport schedule public projection", () => {
	it("loads candidate-period metadata in one batch and keeps the old shape without include", async () => {
		const execute = vi.fn().mockResolvedValue({
			rows: [
				{
					schedule_id: "special",
					notice_id: "358327",
					title: "恢复运行",
					released_at: "2026-08-28T00:00:00Z",
					is_external: false,
					external_url: null,
				},
				{
					schedule_id: "special",
					notice_id: "357813",
					title: "暑期停运",
					released_at: "2026-07-07T00:00:00Z",
					is_external: true,
					external_url: "https://example.org/notice",
				},
			],
		});
		const db = fakeDatabase({
			routes: [route()],
			periods: [
				period({ scheduleId: "baseline" }),
				period({
					scheduleId: "special",
					validFrom: "2026-09-07",
					validTo: "2026-09-08",
					status: "suspended",
					dropOffPointOverride: "调整下车点",
				}),
			],
			items: [item({ scheduleId: "baseline", itemId: "baseline:0" })],
		});
		db.execute = execute;
		const service = createPgTransportScheduleService({} as never, { getDb: async () => db });
		expect((await service.getSchedule(DATE)).routes[0]).not.toHaveProperty("noticeContext");
		expect(execute).toHaveBeenCalledTimes(1);
		expect(new PgDialect().sqlToQuery(execute.mock.calls[0]?.[0]).sql).not.toContain("n.title");
		execute.mockClear();
		const result = await service.getRange("2026-09-07", "2026-09-09", { includeNotices: true });
		expect(execute).toHaveBeenCalledTimes(1);
		const query = new PgDialect().sqlToQuery(execute.mock.calls[0]?.[0]);
		expect(query.sql).toContain("AND n.is_published");
		expect(query.params).toEqual(["baseline", "special"]);
		expect(query.sql).not.toMatch(/summary|content_html|ocr/);
		const first = result.days[0];
		expect(first?.routes[0]).toMatchObject({
			status: "suspended",
			departures: [],
			noticeContext: {
				validFrom: "2026-09-07",
				validTo: "2026-09-08",
				notices: [
					{ noticeId: "358327", title: "恢复运行" },
					{ noticeId: "357813", isExternal: true },
				],
			},
		});
		expect(first?.routeCatalog[0]?.dropOffPoint).toBe("调整下车点");
		expect(result.days[2]?.routeCatalog[0]?.dropOffPoint).toBe("东门");
		expect(result.days[2]?.routes[0]?.noticeContext?.notices).toEqual([]);
		for (const day of result.days) {
			expect(await service.getSchedule(day.date, { includeNotices: true })).toEqual(day);
		}
	});
	it("prefers the newer notice when two complete periods overlap", async () => {
		const execute = vi.fn().mockResolvedValue({
			rows: [
				{
					schedule_id: "older",
					notice_id: "349494",
					title: "旧安排",
					released_at: "2026-04-24T14:16:00Z",
					is_external: false,
					external_url: null,
				},
				{
					schedule_id: "newer",
					notice_id: "355867",
					title: "新安排",
					released_at: "2026-04-25T05:11:00Z",
					is_external: false,
					external_url: null,
				},
			],
		});
		const db = fakeDatabase({
			routes: [route()],
			periods: [
				period({ scheduleId: "older", validFrom: "2026-04-27", validTo: "2026-05-05" }),
				period({ scheduleId: "newer", validFrom: "2026-04-27", validTo: "2026-05-05" }),
			],
			items: [
				item({ scheduleId: "older", itemId: "older:0", departureTime: "08:00" }),
				item({ scheduleId: "newer", itemId: "newer:0", departureTime: "09:00" }),
			],
		});
		db.execute = execute;
		const service = createPgTransportScheduleService({} as never, { getDb: async () => db });
		const result = await service.getSchedule("2026-04-28", { includeNotices: true });
		const departure = result.routes[0]?.departures[0];
		expect(departure?.kind).toBe("fixed");
		if (departure?.kind === "fixed") {
			expect(departure.departureTime).toBe("09:00");
		}
		expect(result.routes[0]?.noticeContext?.notices.map((notice) => notice.noticeId)).toEqual([
			"355867",
		]);
		const without = await service.getSchedule("2026-04-28");
		expect(without.routes).toEqual(
			result.routes.map(({ noticeContext: _context, ...value }) => value),
		);
		expect(without.routeCatalog).toEqual(result.routeCatalog);
		expect((await service.getRange("2026-04-28", "2026-04-29")).days[0]).toEqual(without);
	});
	it("uses future notice priorities for the next running date", async () => {
		const db = fakeDatabase({
			routes: [route()],
			periods: [
				period({ scheduleId: "old", validFrom: "2026-09-01", validTo: "2026-09-10" }),
				period({
					scheduleId: "closed",
					validFrom: "2026-09-01",
					validTo: "2026-09-10",
					status: "suspended",
				}),
				period({ scheduleId: "restored", validFrom: "2026-09-11", validTo: null }),
			],
			items: [
				item({ scheduleId: "old", itemId: "old:0" }),
				item({ scheduleId: "restored", itemId: "restored:0" }),
			],
		});
		db.execute = vi.fn().mockResolvedValue({
			rows: [
				{
					schedule_id: "closed",
					released_at: "2026-08-30T00:00:00Z",
					notice_id: "357813",
					title: "停运",
					is_external: false,
					external_url: null,
				},
			],
		});
		const service = createPgTransportScheduleService({} as never, { getDb: async () => db });
		for (const includeNotices of [false, true]) {
			const result = await service.getSchedule("2026-08-31", { includeNotices });
			expect(result.routeCatalog[0]?.nextServiceDate).toBe("2026-09-11");
			expect((await service.getSchedule("2026-09-07", { includeNotices })).routes[0]?.status).toBe(
				"suspended",
			);
		}
	});
	it("projects shared complete historical tables without merging overlapping periods", async () => {
		const fixtures = [...MAY_DAY_PERIODS, ...SUMMER_PERIODS];
		const ids = [...new Set(fixtures.map((p) => p.input.routeId))];
		const db = fakeDatabase({
			routes: ids.map((routeId) => ({ ...route(), routeId })),
			periods: fixtures.map(({ scheduleId, input }) => ({ ...period({ scheduleId }), ...input })),
			items: fixtures.flatMap(({ scheduleId, input }) =>
				input.items.map((entry, index) => ({
					...item({ scheduleId, itemId: `${scheduleId}:${index}` }),
					...entry,
				})),
			),
		});
		const service = createPgTransportScheduleService({} as never, { getDb: async () => db });
		expect(
			(await service.getSchedule("2026-04-27")).routes.reduce((n, r) => n + r.departures.length, 0),
		).toBe(24);
		expect(
			(await service.getSchedule("2026-04-28")).routes.reduce((n, r) => n + r.departures.length, 0),
		).toBe(25);
		expect(
			(await service.getSchedule("2026-07-13")).routes.reduce((n, r) => n + r.departures.length, 0),
		).toBe(6);
		expect(
			(await service.getSchedule("2026-08-30")).routes.reduce((n, r) => n + r.departures.length, 0),
		).toBe(4);
	});
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
	dropOffPointOverride?: string | null;
	scheduleId: string;
	status?: "operating" | "suspended";
	validFrom?: string;
	validTo?: string | null;
	note?: string | null;
	weekdays?: number[];
}) {
	return {
		boardingPointOverride: input.boardingPointOverride ?? null,
		dropOffPointOverride: input.dropOffPointOverride ?? null,
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
		execute: vi.fn().mockResolvedValue({ rows: [] }),
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
