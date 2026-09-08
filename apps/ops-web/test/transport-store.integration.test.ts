// @vitest-environment node

import { Client, Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { applyOpsWebDatabaseGrants } from "../ops/db/ops-web-database.ts";
import { createPgTransportStore } from "../src/server/transport-store.ts";
import type {
	TransportOpsActor,
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

		await store.deleteSchedulePeriod(ACTOR, period.scheduleId);
		await store.deleteRoute(ACTOR, route.routeId);
		expect(await store.listRoutes()).toEqual([]);
	});

	it("gives App API read-only access to the three public tables", async () => {
		for (const table of ["routes", "schedule_periods", "schedule_items"]) {
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
});
