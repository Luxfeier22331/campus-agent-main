// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
	buildCampusGroupsService,
	type CampusGroupsCatalog,
	type CampusGroupsStore,
} from "../src/modules/campus-groups";

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
	sections: [{ groups: [group], id: "interest-groups", name: "同好群" }],
};

function createStore(value: CampusGroupsCatalog = catalog): CampusGroupsStore {
	return {
		getCatalog: vi.fn().mockResolvedValue(value),
		replaceCatalog: vi.fn().mockResolvedValue(undefined),
	};
}

describe("campus groups service", () => {
	it("returns the ordered catalog from storage", async () => {
		const service = buildCampusGroupsService(createStore());

		await expect(service.getCatalog()).resolves.toEqual(catalog);
	});

	it("normalizes tags before replacing the whole catalog", async () => {
		const store = createStore();
		const service = buildCampusGroupsService(store);

		await expect(
			service.replaceCatalog({
				...catalog,
				sections: [
					{
						...catalog.sections[0],
						groups: [{ ...group, name: "  王佐体育运动学校  ", tags: ["赛马娘", "赛马娘"] }],
					},
				],
			}),
		).resolves.toEqual(catalog);
		expect(store.replaceCatalog).toHaveBeenCalledWith(catalog);
	});

	it("rejects an invalid catalog before writing it", async () => {
		const store = createStore();
		const service = buildCampusGroupsService(store);

		await expect(
			service.replaceCatalog({
				...catalog,
				sections: [{ ...catalog.sections[0], groups: [{ ...group, qqGroupNumber: "invalid" }] }],
			}),
		).rejects.toMatchObject({ code: "groups_catalog_invalid", status: 422 });
		expect(store.replaceCatalog).not.toHaveBeenCalled();
	});

	it("rejects invalid stored data instead of returning a partial catalog", async () => {
		const service = buildCampusGroupsService(
			createStore({
				...catalog,
				sections: [
					{ ...catalog.sections[0], groups: [group, group] },
				] as CampusGroupsCatalog["sections"],
			}),
		);

		await expect(service.getCatalog()).rejects.toMatchObject({
			code: "groups_catalog_invalid",
			status: 502,
		});
	});
});
