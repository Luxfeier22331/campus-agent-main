// @vitest-environment node

import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import { createDiningMapReadServiceTestAdapter } from "../../app-api/test-support/dining";
import { bootstrapDiningPublication } from "../ops/db/bootstrap-dining";
import { applyOpsWebDatabaseGrants } from "../ops/db/ops-web-database";
import type { DiningFloorplanAssetStore } from "../src/server/dining-floorplan-assets";
import { createPgDiningStore } from "../src/server/dining-store";

const postgres = inject("opsWebPostgres");
const databaseEnv = {
	DEPLOYMENT_ENVIRONMENT: "local",
	OPS_WEB_DATABASE_SSLMODE: "disable",
	OPS_WEB_DATABASE_URL: postgres.opsWebConnectionString,
	OPS_WEB_SCHEMA_DATABASE_SSLMODE: "disable",
	OPS_WEB_SCHEMA_DATABASE_URL: postgres.managementConnectionString,
} as const;
const now = new Date("2026-08-03T01:00:00.000Z");

describe("Dining bootstrap PostgreSQL publication", () => {
	let appApiPool: Pool;
	let managementPool: Pool;
	let opsPool: Pool;

	beforeAll(async () => {
		await applyOpsWebDatabaseGrants(databaseEnv);
		appApiPool = new Pool({ connectionString: postgres.appApiConnectionString, max: 2 });
		managementPool = new Pool({ connectionString: postgres.managementConnectionString, max: 2 });
		opsPool = new Pool({ connectionString: postgres.opsWebConnectionString, max: 2 });
	});

	beforeEach(async () => {
		await managementPool.query(`
			truncate dining.review_edits, dining.review_reports, dining.reviews, dining.menu_items;
			delete from dining.map_publication;
			delete from dining.map_releases;
			delete from dining.map_draft;
		`);
	});

	afterAll(async () => {
		await Promise.all([appApiPool.end(), managementPool.end(), opsPool.end()]);
	});

	it("rolls back a failed publication and exposes the successful retry to App API", async () => {
		const assetStore = createAssetStore();
		const store = createPgDiningStore({
			assetStore,
			now: () => now,
			pool: opsPool,
			releaseId: () => "release-bootstrap",
		});
		await installRejectPublicationTrigger(managementPool);
		try {
			await expect(
				bootstrapDiningPublication({ database: opsPool, now, store }),
			).rejects.toMatchObject({
				cause: expect.objectContaining({
					message: "Dining publication rejected by integration test",
				}),
				code: "OPS_DINING_STORE_UNAVAILABLE",
			});
		} finally {
			await removeRejectPublicationTrigger(managementPool);
		}

		await expect(readInventory(managementPool)).resolves.toEqual({
			drafts: 1,
			publications: 0,
			releases: 0,
		});

		await expect(bootstrapDiningPublication({ database: opsPool, now, store })).resolves.toEqual({
			releaseId: "release-bootstrap",
			revision: 1,
			status: "baseline_published",
		});
		await expect(readInventory(managementPool)).resolves.toEqual({
			drafts: 1,
			publications: 1,
			releases: 1,
		});

		const map = await createDiningMapReadServiceTestAdapter(appApiPool).getMap();
		expect(map.releaseId).toBe("release-bootstrap");
		expect(map.halls.length).toBeGreaterThan(0);
		expect(map.halls.flatMap((hall) => hall.floors).length).toBeGreaterThan(0);

		await expect(bootstrapDiningPublication({ database: opsPool, now, store })).resolves.toEqual({
			releaseId: "release-bootstrap",
			revision: 1,
			status: "already_published",
		});
	});
});

function createAssetStore(): DiningFloorplanAssetStore {
	return {
		async putSvg({ sha256 }) {
			const digest = sha256.slice("sha256:".length);
			return {
				objectKey: `dining/floorplans/${digest}.svg`,
				sha256,
				svgAssetUrl: `/api/dining/floorplans/${digest}.svg`,
			};
		},
		async verifyReadiness() {
			return;
		},
	};
}

async function readInventory(pool: Pool) {
	const result = await pool.query(`
		select
			(select count(*)::int from dining.map_draft) as drafts,
			(select count(*)::int from dining.map_releases) as releases,
			(select count(*)::int from dining.map_publication) as publications
	`);
	return result.rows[0];
}

async function installRejectPublicationTrigger(pool: Pool): Promise<void> {
	await pool.query(`
		create or replace function dining.reject_bootstrap_publication()
		returns trigger language plpgsql as $function$
		begin
			raise exception 'Dining publication rejected by integration test';
		end
		$function$;
		create trigger reject_bootstrap_publication
		before insert or update on dining.map_publication
		for each row execute function dining.reject_bootstrap_publication();
	`);
}

async function removeRejectPublicationTrigger(pool: Pool): Promise<void> {
	await pool.query(`
		drop trigger if exists reject_bootstrap_publication on dining.map_publication;
		drop function if exists dining.reject_bootstrap_publication();
	`);
}
