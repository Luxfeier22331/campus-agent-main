// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createPgTransportStore } from "../src/server/transport-store.ts";
import type {
	TransportOpsActor,
	TransportOpsSchedulePeriodInput,
} from "../src/server/transport-store-contract.ts";
import {
	TransportStoreNotFoundError,
	TransportStoreUnavailableError,
} from "../src/server/transport-store-errors.ts";

const NOW = new Date("2026-09-07T08:00:00.000Z");
const ACTOR: TransportOpsActor = { displayName: "值班员", principalId: "ops:1" };
const ROUTE_ID = "route:fengtai-haidian";
const PERIOD_INPUT: TransportOpsSchedulePeriodInput = {
	boardingPointOverride: "丰台校区南门",
	items: [
		{
			boardingPoint: null,
			capacity: null,
			departureTime: "07:30",
			kind: "fixed",
			note: null,
			riderType: "all",
			sortOrder: 0,
		},
		{
			boardingPoint: null,
			capacity: 40,
			firstDepartureTime: "09:00",
			intervalMinutes: 20,
			kind: "interval",
			lastDepartureTime: "10:00",
			note: null,
			riderType: "student",
			sortOrder: 1,
		},
	],
	note: "工作日",
	routeId: ROUTE_ID,
	status: "operating",
	validFrom: "2026-08-31",
	validTo: null,
	weekdays: [1, 2, 3, 4, 5],
};

const ROUTE_ROW = {
	created_at: NOW,
	default_boarding_point: "丰台校区南门",
	destination: "海淀校区",
	display_order: 0,
	origin: "丰台校区",
	route_id: ROUTE_ID,
	service_kind: "commute",
	updated_at: NOW,
	updated_by: ACTOR.principalId,
};

const PERIOD_ROW = {
	boarding_point_override: PERIOD_INPUT.boardingPointOverride,
	created_at: NOW,
	note: PERIOD_INPUT.note,
	route_id: ROUTE_ID,
	schedule_id: "schedule:1",
	status: "operating",
	updated_at: NOW,
	updated_by: ACTOR.principalId,
	valid_from: PERIOD_INPUT.validFrom,
	valid_to: null,
	weekdays: PERIOD_INPUT.weekdays,
};

const ITEM_ROWS = [
	{
		boarding_point: "教师乘车点",
		capacity: null,
		departure_time: "07:30",
		first_departure_time: null,
		interval_minutes: null,
		item_id: "schedule:1:0",
		kind: "fixed",
		last_departure_time: null,
		note: null,
		rider_type: "all",
		schedule_id: "schedule:1",
		sort_order: 0,
	},
	{
		boarding_point: "学生乘车点",
		capacity: 40,
		departure_time: null,
		first_departure_time: "09:00",
		interval_minutes: 20,
		item_id: "schedule:1:1",
		kind: "interval",
		last_departure_time: "10:00",
		note: null,
		rider_type: "student",
		schedule_id: "schedule:1",
		sort_order: 1,
	},
];

describe("PostgreSQL transport store", () => {
	it("maps routes, complete periods", async () => {
		const routeQuery = vi.fn().mockResolvedValue({ rows: [ROUTE_ROW] });
		await expect(createStore(routeQuery).store.listRoutes()).resolves.toEqual([
			{
				createdAt: NOW.toISOString(),
				defaultBoardingPoint: ROUTE_ROW.default_boarding_point,
				destination: ROUTE_ROW.destination,
				displayOrder: 0,
				origin: ROUTE_ROW.origin,
				routeId: ROUTE_ID,
				serviceKind: "commute",
				updatedAt: NOW.toISOString(),
				updatedBy: ACTOR.principalId,
			},
		]);

		const periodQuery = vi
			.fn()
			.mockResolvedValueOnce({ rows: [PERIOD_ROW] })
			.mockResolvedValueOnce({ rows: ITEM_ROWS });
		const period = await createStore(periodQuery).store.listSchedulePeriods();
		expect(period[0]).toMatchObject({
			boardingPointOverride: "丰台校区南门",
			items: [
				expect.objectContaining({
					boardingPoint: "教师乘车点",
					departureTime: "07:30",
					kind: "fixed",
				}),
				expect.objectContaining({
					boardingPoint: "学生乘车点",
					firstDepartureTime: "09:00",
					kind: "interval",
				}),
			],
			scheduleId: "schedule:1",
		});
	});

	it("replaces all period items inside one transaction", async () => {
		let items: Record<string, unknown>[] = [...ITEM_ROWS];
		const query = vi.fn(async (text: string, values: unknown[] = []) => {
			const sql = normalizeSql(text);
			if (["begin", "commit", "rollback"].includes(sql)) {
				return { rows: [] };
			}
			if (sql.startsWith("select schedule_id, route_id")) {
				return { rows: [PERIOD_ROW] };
			}
			if (sql.startsWith("select item_id, schedule_id")) {
				return { rows: items };
			}
			if (sql.startsWith("select route_id, origin")) {
				return { rows: [ROUTE_ROW] };
			}
			if (sql.startsWith("update transport.schedule_periods")) {
				return { rows: [] };
			}
			if (sql.startsWith("delete from transport.schedule_items")) {
				items = [];
				return { rows: [] };
			}
			if (sql.startsWith("insert into transport.schedule_items")) {
				items.push({
					boarding_point: values[3],
					capacity: values[9] === null ? null : Number(values[9]),
					departure_time: values[4] === null ? null : String(values[4]),
					first_departure_time: values[5] === null ? null : String(values[5]),
					interval_minutes: values[7] === null ? null : Number(values[7]),
					item_id: String(values[0]),
					kind: String(values[2]),
					last_departure_time: values[6] === null ? null : String(values[6]),
					note: values[10] === null ? null : String(values[10]),
					rider_type: String(values[8]),
					schedule_id: String(values[1]),
					sort_order: Number(values[11]),
				});
				return { rows: [] };
			}
			throw new Error(`Unexpected SQL: ${sql}`);
		});
		const { client, store } = createStore(query);
		const result = await store.updateSchedulePeriod(ACTOR, "schedule:1", PERIOD_INPUT);

		expect(result.items).toHaveLength(2);
		expect(query.mock.calls.map(([sql]) => normalizeSql(String(sql)))).toEqual(
			expect.arrayContaining(["begin", "commit"]),
		);
		expect(
			query.mock.calls.some(([sql]) =>
				normalizeSql(String(sql)).startsWith("delete from transport.schedule_items"),
			),
		).toBe(true);
		expect(client.release).toHaveBeenCalledOnce();
	});

	it("maps route conflicts, missing rows and transactional failures", async () => {
		const duplicate = Object.assign(new Error("duplicate"), { code: "23505" });
		await expect(
			createStore(vi.fn().mockRejectedValue(duplicate)).store.createRoute(ACTOR, {
				defaultBoardingPoint: null,
				destination: "海淀校区",
				displayOrder: 0,
				origin: "丰台校区",
				routeId: ROUTE_ID,
				serviceKind: "commute",
			}),
		).rejects.toMatchObject({ name: "TransportStoreConflictError" });

		await expect(
			createStore(vi.fn().mockResolvedValue({ rows: [] })).store.updateRoute(ACTOR, ROUTE_ID, {
				origin: "新校区",
			}),
		).rejects.toBeInstanceOf(TransportStoreNotFoundError);

		const failingQuery = vi.fn(async (text: string) => {
			const sql = normalizeSql(text);
			if (sql === "begin" || sql === "rollback") {
				return { rows: [] };
			}
			if (sql.startsWith("select route_id, origin")) {
				return { rows: [ROUTE_ROW] };
			}
			throw new Error("database write failed");
		});
		const { client, store } = createStore(failingQuery);
		await expect(store.createSchedulePeriod(ACTOR, PERIOD_INPUT)).rejects.toBeInstanceOf(
			TransportStoreUnavailableError,
		);
		expect(client.release).toHaveBeenCalledOnce();
	});
});

function createStore(query: ReturnType<typeof vi.fn>) {
	const client = { query, release: vi.fn() };
	const pool = { connect: vi.fn(async () => client), query };
	return { client, store: createPgTransportStore({ now: () => NOW, pool: pool as never }) };
}

function normalizeSql(sql: string): string {
	return sql.replace(/\s+/g, " ").trim().toLowerCase();
}
