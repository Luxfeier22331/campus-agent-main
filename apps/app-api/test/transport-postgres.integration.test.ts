// @vitest-environment node
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { createPgTransportScheduleService } from "../src/modules/transport/schedule-store";

const postgres = inject("appApiPostgres");
const management = new Pool({ connectionString: postgres.managementConnectionString });
const pool = new Pool({ connectionString: postgres.runtimeConnectionString, max: 1 });
const queries: { sql: string; params: unknown[] }[] = [];
const db = drizzle({
	client: pool,
	logger: {
		logQuery(sql, params) {
			queries.push({ sql, params });
		},
	},
});
const service = createPgTransportScheduleService({ getDb: async () => db });

afterAll(async () => {
	await pool.end();
	await management.end();
});
beforeEach(() => {
	queries.length = 0;
});
beforeAll(async () => {
	await management.query(`
		INSERT INTO transport.routes (route_id, origin, destination, service_kind, display_order, created_at, updated_at, updated_by)
		VALUES ('cpu-route', '起点', '终点', 'commute', 0, now(), now(), 'test'),
		('cpu-empty', '起点', '终点', 'commute', 1, now(), now(), 'test');
		INSERT INTO transport.schedule_periods (schedule_id, route_id, status, valid_from, valid_to, weekdays, created_at, updated_at, updated_by)
		VALUES ('cpu-old', 'cpu-route', 'operating', '2020-01-01', '2020-12-31', ARRAY[1,2,3,4,5,6,7], now(), now(), 'test'),
		('cpu-base', 'cpu-route', 'operating', '2026-09-01', NULL, ARRAY[1,2,3,4,5,6,7], now(), now(), 'test'),
		('cpu-closed', 'cpu-route', 'suspended', '2026-09-19', '2026-09-20', ARRAY[1,2,3,4,5,6,7], now(), now(), 'test'),
		('cpu-future', 'cpu-route', 'operating', '2027-01-01', NULL, ARRAY[1,2,3,4,5,6,7], now(), now(), 'test');
		INSERT INTO transport.schedule_items (item_id, schedule_id, kind, departure_time, rider_type, sort_order)
		VALUES ('cpu-base-late', 'cpu-base', 'fixed', '09:00', 'all', 1),
		('cpu-base-early', 'cpu-base', 'fixed', '08:00', 'all', 0),
		('cpu-future-item', 'cpu-future', 'fixed', '10:00', 'all', 0);
		INSERT INTO notices.notice_types (notice_type, name) VALUES (9524, '测试') ON CONFLICT DO NOTHING;
		INSERT INTO notices.categories (category) VALUES ('cpu-test') ON CONFLICT DO NOTHING;
		INSERT INTO notices.notices (notice_id, notice_type, title, released_at, is_external, category, is_published)
		VALUES (952401, 9524, '停运一', '2026-09-17', false, 'cpu-test', true),
		(952402, 9524, '停运二', '2026-09-18', false, 'cpu-test', true),
		(952403, 9524, '未发布', '2026-09-19', false, NULL, false),
		(952404, 9524, '未来', '2026-09-19', false, 'cpu-test', true),
		(952405, 9524, '已删除', '2026-09-18', false, 'cpu-test', true);
		UPDATE notices.notices SET unavailable_at = now() WHERE notice_id = 952405;
		INSERT INTO transport.schedule_period_notices (schedule_id, notice_id)
		VALUES ('cpu-closed', 952401), ('cpu-closed', 952402), ('cpu-closed', 952403), ('cpu-future', 952404), ('cpu-closed', 952405);
	`);
});

describe("transport queries with real app_api grants", () => {
	it("filters ended periods before validation, preserves empty routes and orders items in one query", async () => {
		const result = await service.getSchedule("2026-09-18");
		expect(queries).toHaveLength(1);
		expect(queries[0]?.params).toEqual(["2026-09-18"]);
		expect(queries[0]?.sql).not.toMatch(/created_at|updated_by/);
		expect(result.routeCatalog.map((r) => r.routeId)).toEqual(["cpu-route", "cpu-empty"]);
		expect(result.routeCatalog[1]?.nextServiceDate).toBeNull();
		expect(result.routes[0]?.departures).toMatchObject([
			{ departureTime: "08:00" },
			{ departureTime: "09:00" },
		]);
		// The historical operating period has no items: it must be excluded before validation.
		await expect(service.getSchedule("2020-09-18")).rejects.toMatchObject({
			code: "transport_projection_invalid",
		});
	});

	it("queries only displayed notices, keeps suspended notices and excludes unpublished/future ones", async () => {
		const result = await service.getSchedule("2026-09-19", { includeNotices: true });
		expect(queries).toHaveLength(2);
		expect(queries[1]?.params).toEqual(["cpu-closed"]);
		expect(result.routeCatalog[0]?.nextServiceDate).toBe("2026-09-21");
		expect(result.routes[0]).toMatchObject({
			status: "suspended",
			departures: [],
			noticeContext: { notices: [{ noticeId: "952402" }, { noticeId: "952401" }] },
		});
	});

	it("bounds a whole month to two queries with exactly the same daily results", async () => {
		const range = await service.getRange("2026-09-01", "2026-10-01", { includeNotices: true });
		expect(queries).toHaveLength(2);
		expect(queries[1]?.params).toEqual(["cpu-base", "cpu-closed"]);
		for (const day of range.days) {
			expect(await service.getSchedule(day.date, { includeNotices: true })).toEqual(day);
		}
		queries.length = 0;
		await service.getRange("2026-09-01", "2026-10-01");
		expect(queries).toHaveLength(1);
	});

	it("does not query notices when no period is displayed, while retaining future service dates", async () => {
		const result = await service.getSchedule("2026-08-31", { includeNotices: true });
		expect(queries).toHaveLength(1);
		expect(result.routes).toEqual([]);
		expect(result.routeCatalog[0]?.nextServiceDate).toBe("2026-09-01");
	});

	it("keeps database failures visible", async () => {
		const failing = createPgTransportScheduleService({
			getDb: async () => {
				throw new Error("database unavailable");
			},
		});
		await expect(failing.getSchedule("2026-09-19")).rejects.toThrow("database unavailable");
	});
});
