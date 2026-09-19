// @vitest-environment node

import { Client, Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { CONTROLLED_CHANGE_SCENARIOS } from "../../../packages/domains/transport/test/fixtures/history";
import { createTransportScheduleServiceTestAdapter } from "../../app-api/test-support/transport";
import { applyOpsWebDatabaseGrants } from "../ops/db/ops-web-database.ts";
import { createPgTransportStore } from "../src/server/transport-store.ts";
import type {
	TransportOpsActor,
	TransportOpsSchedulePeriod,
	TransportOpsSchedulePeriodInput,
} from "../src/server/transport-store-contract.ts";

const postgres = inject("opsWebPostgres");
const databaseEnv = {
	DEPLOYMENT_ENVIRONMENT: "local",
	OPS_WEB_DATABASE_SSLMODE: "disable",
	OPS_WEB_DATABASE_URL: postgres.opsWebConnectionString,
	OPS_WEB_SCHEMA_DATABASE_SSLMODE: "disable",
	OPS_WEB_SCHEMA_DATABASE_URL: postgres.managementConnectionString,
} as const;

const ACTOR: TransportOpsActor = {
	displayName: "集成测试值班员",
	principalId: "ops:transport-integration",
};
const ROUTE_ID = "route:transport-integration";
const PERIOD_INPUT: TransportOpsSchedulePeriodInput = {
	boardingPointOverride: "丰台校区南门",
	dropOffPointOverride: "海淀校区东门内",
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
	],
	note: null,
	routeId: ROUTE_ID,
	status: "operating",
	validFrom: "2026-08-31",
	validTo: null,
	weekdays: [1, 2, 3, 4, 5],
};

async function connect(connectionString: string): Promise<Client> {
	const client = new Client({ connectionString, ssl: false });
	await client.connect();
	return client;
}

describe("transport PostgreSQL store integration", () => {
	let appApi: Client;
	let management: Client;
	let opsPool: Pool;

	beforeAll(async () => {
		await applyOpsWebDatabaseGrants(databaseEnv);
		management = await connect(postgres.managementConnectionString);
		appApi = await connect(postgres.appApiConnectionString);
		opsPool = new Pool({ connectionString: postgres.opsWebConnectionString, max: 2 });
	});

	beforeEach(async () => {
		await management.query(`
			truncate transport.schedule_items,
			transport.schedule_periods, transport.routes cascade
		`);
	});

	afterAll(async () => {
		await Promise.all([management.end(), appApi.end(), opsPool.end()]);
	});

	it("persists a complete period and deletes it with its route", async () => {
		const store = createPgTransportStore({
			now: () => new Date("2026-09-07T08:00:00.000Z"),
			pool: opsPool,
		});
		const route = await store.createRoute(ACTOR, {
			boardingGuide: "先预约再乘车",
			dropOffPoint: "海淀校区东门",
			defaultBoardingPoint: "丰台校区南门",
			destination: "海淀校区",
			displayOrder: 0,
			origin: "丰台校区",
			routeId: ROUTE_ID,
			serviceKind: "commute",
		});
		expect(route).toMatchObject({ boardingGuide: "先预约再乘车", dropOffPoint: "海淀校区东门" });
		const cleared = await store.updateRoute(ACTOR, route.routeId, {
			boardingGuide: null,
			dropOffPoint: null,
		});
		expect(cleared).toMatchObject({
			boardingGuide: null,
			dropOffPoint: null,
			defaultBoardingPoint: "丰台校区南门",
		});
		const period = await store.createSchedulePeriod(ACTOR, PERIOD_INPUT);
		expect(period.dropOffPointOverride).toBe("海淀校区东门内");
		const updated = await store.updateSchedulePeriod(ACTOR, period.scheduleId, {
			...PERIOD_INPUT,
			items: [
				{
					boardingPoint: "学生乘车点",
					capacity: 40,
					departureTime: "09:00",
					kind: "fixed",
					note: "调整后",
					riderType: "student",
					sortOrder: 0,
				},
			],
		});

		expect(route.serviceKind).toBe("commute");
		expect(updated.items[0]).toMatchObject({
			boardingPoint: "学生乘车点",
			departureTime: "09:00",
			riderType: "student",
		});
		expect(await store.listSchedulePeriods()).toHaveLength(1);
		expect((await store.listSchedulePeriods())[0]?.dropOffPointOverride).toBe("海淀校区东门内");
		expect(
			(
				await store.updateSchedulePeriod(ACTOR, period.scheduleId, {
					...PERIOD_INPUT,
					dropOffPointOverride: null,
				})
			).dropOffPointOverride,
		).toBeNull();

		await store.deleteSchedulePeriod(ACTOR, period.scheduleId);
		await store.deleteRoute(ACTOR, route.routeId);
		expect(await store.listRoutes()).toEqual([]);
	});

	it("gives App API read-only access to schedule facts and notice associations", async () => {
		for (const table of [
			"routes",
			"schedule_periods",
			"schedule_items",
			"schedule_period_notices",
		]) {
			await expect(appApi.query(`select count(*) from transport.${table}`)).resolves.toBeTruthy();
		}
		await expect(
			appApi.query(
				`insert into transport.routes
				 (route_id, origin, destination, service_kind, display_order, created_at, updated_at, updated_by)
				 values ('app-api-write', 'a', 'b', 'commute', 0, now(), now(), 'app-api')`,
			),
		).rejects.toMatchObject({ code: "42501" });
	});
	it("round-trips historical location changes and exposes only published winning-period notices without changing priority", async () => {
		const store = createPgTransportStore({ pool: opsPool });
		await store.createRoute(ACTOR, {
			routeId: "route:haidian-to-fengtai",
			origin: "海淀校区",
			destination: "丰台校区",
			serviceKind: "commute",
			displayOrder: 0,
			defaultBoardingPoint: "东门",
			dropOffPoint: "受控起始下车点",
			boardingGuide: null,
		});
		const fixtures = CONTROLLED_CHANGE_SCENARIOS.permanentLocation.filter(
			(p) => p.input.routeId === "route:haidian-to-fengtai",
		);
		const saved: TransportOpsSchedulePeriod[] = [];
		for (const fixture of fixtures) {
			saved.push(await store.createSchedulePeriod(ACTOR, fixture.input));
		}
		await management.query(
			"insert into notices.notice_types(notice_type,name) values(5,'通知') on conflict do nothing",
		);
		await management.query(
			"insert into notices.categories(category) values('campus_operations') on conflict do nothing",
		);
		for (const [id, published, released] of [
			[353903, true, "2025-12-12"],
			[353904, false, "2025-12-13"],
			[353905, true, "2025-12-14"],
		] as const) {
			await management.query(
				`insert into notices.notices(notice_id,notice_type,title,released_at,is_external,category,is_published)
			values($1,5,$2,$3,false,'campus_operations',$4) on conflict(notice_id) do nothing`,
				[id, `通知 ${id}`, released, published],
			);
		}
		const [original, changed] = saved;
		if (!(original && changed)) {
			throw new Error("Missing schedule fixtures");
		}
		await store.replaceSchedulePeriodNotices(original.scheduleId, [
			{ noticeId: 353905, summary: "非生效时间段" },
		]);
		await store.replaceSchedulePeriodNotices(changed.scheduleId, [
			{ noticeId: 353903, summary: "后台备注不公开" },
			{ noticeId: 353904, summary: null },
			{ noticeId: 353905, summary: null },
		]);
		const after = (await store.listSchedulePeriods()).find(
			(p) => p.scheduleId === saved[1]?.scheduleId,
		);
		expect(after?.updatedAt).toBe(saved[1]?.updatedAt);
		expect(after?.sourceReleasedAt).toBe("2025-12-14T00:00:00.000Z");
		const service = createTransportScheduleServiceTestAdapter(appApi);
		const days = await service.getRange("2025-12-14", "2025-12-16", { includeNotices: true });
		expect(days.days.map((d) => d.routeCatalog[0]?.dropOffPoint)).toEqual([
			"受控起始下车点",
			"聚雅餐厅东侧停车场路口",
			"聚雅餐厅东侧停车场路口",
		]);
		expect(days.days[1]?.routes[0]?.noticeContext?.notices.map((n) => n.noticeId)).toEqual([
			"353905",
			"353903",
		]);
		expect(JSON.stringify(days)).not.toContain("后台备注");
		const withoutNotices = await service.getSchedule("2025-12-15");
		expect(withoutNotices.routes[0]?.boardingPoint).toBe(days.days[1]?.routes[0]?.boardingPoint);
		// A newer notice on the older period must not override the later effective period.
		await store.replaceSchedulePeriodNotices(changed.scheduleId, [
			{ noticeId: 353903, summary: null },
		]);
		const afterRelinking = await service.getSchedule("2025-12-15");
		const withNotices = await service.getSchedule("2025-12-15", { includeNotices: true });
		expect(withNotices.routes[0]?.noticeContext?.notices.map((n) => n.noticeId)).toEqual([
			"353903",
		]);
		expect(afterRelinking).toEqual(withoutNotices);
		expect(withNotices.routeCatalog).toEqual(withoutNotices.routeCatalog);
		expect(withNotices.routeCatalog[0]?.dropOffPoint).toBe("聚雅餐厅东侧停车场路口");
		// Withdrawing the winning period's notice must not fall back to the older period either.
		await management.query("update notices.notices set is_published=false where notice_id=353903");
		const afterWithdrawal = await service.getSchedule("2025-12-15", { includeNotices: true });
		expect(afterWithdrawal.routes[0]?.noticeContext?.notices).toEqual([]);
		expect(afterWithdrawal.routeCatalog).toEqual(withoutNotices.routeCatalog);
		expect(await service.getSchedule("2025-12-15")).toEqual(withoutNotices);
	});
});
