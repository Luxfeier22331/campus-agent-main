// @vitest-environment node

import type { CampusGroupsCatalog } from "campus-contracts/campus-groups";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import { createPgCampusGroupsStore } from "../src/modules/campus-groups";

const postgres = inject("appApiPostgres");

const group = {
	id: "qq-760540871",
	joinUrl: null,
	name: "王佐体育运动学校",
	qqGroupNumber: "760540871",
	summary: "",
	tags: ["赛马娘"],
};

const catalog: CampusGroupsCatalog = {
	schemaVersion: "campus-groups-catalog.v1",
	sections: [
		{ groups: [group], id: "interest-groups", name: "同好群" },
		{ groups: [], id: "clubs", name: "社团群" },
	],
};

describe("campus groups PostgreSQL store", () => {
	let managementClient: Client;
	let runtimePool: Pool;
	let store: ReturnType<typeof createPgCampusGroupsStore>;

	beforeAll(async () => {
		managementClient = new Client({
			connectionString: postgres.managementConnectionString,
			ssl: false,
		});
		runtimePool = new Pool({
			connectionString: postgres.runtimeConnectionString,
			max: 2,
			ssl: false,
		});
		await managementClient.connect();
		const database = drizzle({ client: runtimePool });
		store = createPgCampusGroupsStore({ getDb: async () => database });
	});

	afterAll(async () => {
		await Promise.all([managementClient.end(), runtimePool.end()]);
	});

	beforeEach(async () => {
		await managementClient.query("truncate table campus_groups.sections cascade");
	});

	it("replaces and reads an ordered catalog including empty sections", async () => {
		await store.replaceCatalog(catalog);

		await expect(store.getCatalog()).resolves.toEqual(catalog);
	});

	it("persists section order and group order exactly as supplied", async () => {
		const secondGroup = {
			...group,
			id: "qq-760540872",
			name: "第二个群",
			qqGroupNumber: "760540872",
		};
		const ordered: CampusGroupsCatalog = {
			schemaVersion: "campus-groups-catalog.v1",
			sections: [
				{ groups: [], id: "clubs", name: "社团群" },
				{ groups: [secondGroup, group], id: "interest-groups", name: "同好群" },
			],
		};

		await store.replaceCatalog(ordered);
		await expect(store.getCatalog()).resolves.toEqual(ordered);
	});

	it("moves groups across sections by replacing the catalog atomically", async () => {
		await store.replaceCatalog(catalog);
		const [interestGroups, clubs] = catalog.sections;
		if (!(interestGroups && clubs)) {
			throw new Error("The campus groups fixture must contain both sections.");
		}
		const moved: CampusGroupsCatalog = {
			...catalog,
			sections: [
				{ ...interestGroups, groups: [] },
				{ ...clubs, groups: [group] },
			],
		};

		await store.replaceCatalog(moved);
		await expect(store.getCatalog()).resolves.toEqual(moved);
	});

	it("supports replacing the directory with no sections", async () => {
		await store.replaceCatalog(catalog);
		await store.replaceCatalog({ schemaVersion: "campus-groups-catalog.v1", sections: [] });

		await expect(store.getCatalog()).resolves.toEqual({
			schemaVersion: "campus-groups-catalog.v1",
			sections: [],
		});
	});
});
