// @vitest-environment node

import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { Env } from "../src/config";
import { appApiSchema } from "../src/db/schema";
import {
	buildCampusServicesTransportScheduleService,
	createPgCampusServicesTransportScheduleStore,
} from "../src/modules/campus-services-transport-schedule";

const postgres = inject("appApiPostgres");

describe("transport schedule PostgreSQL integration", () => {
	let client: Client;

	beforeAll(async () => {
		client = new Client({ connectionString: postgres.runtimeConnectionString, ssl: false });
		await client.connect();
	});

	afterAll(async () => {
		await client.end();
	});

	it("reads the current published status through the app-api store", async () => {
		const database = drizzle(client, { schema: appApiSchema });
		const service = buildCampusServicesTransportScheduleService({
			store: createPgCampusServicesTransportScheduleStore({} as Env, {
				getDb: async () => database,
			}),
		});

		const current = await service.getPublicStatus();

		expect(current.projection.release.releaseId).toBe("transport:integration:2026-03-20");
		expect(current.etag).toMatch(/^"[a-f0-9]{64}"$/u);
		expect(current.projection.groups).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: "temporary",
					routes: expect.arrayContaining([
						expect.objectContaining({
							departures: expect.arrayContaining([
								expect.objectContaining({
									departureTime: "08:15",
									serviceDate: "2026-03-21",
									status: "added",
								}),
							]),
						}),
					]),
				}),
			]),
		);
	});

	it("keeps the app_api role read-only for campus services projections", async () => {
		const role = await client.query<{ current_user: string }>("select current_user");
		expect(role.rows[0]?.current_user).toBe("app_api");
		await expect(
			client.query(
				`update "campus_services"."transport_current"
				 set "updated_at" = "updated_at"
				 where "pointer_key" = 'current'`,
			),
		).rejects.toMatchObject({ code: "42501" });
	});
});
