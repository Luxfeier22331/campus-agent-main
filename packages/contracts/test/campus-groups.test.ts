import { describe, expect, it } from "vitest";
import { CampusGroupSchema, CampusGroupsCatalogSchema } from "../src/campus-groups";

const group = {
	id: "qq-760540871",
	joinUrl: null,
	name: "央民二匹马俱乐部",
	qqGroupNumber: "760540871",
	summary: "优俊少女",
	tags: ["优俊少女"],
} as const;

describe("campus groups contracts", () => {
	it("parses a group and the public catalog", () => {
		expect(CampusGroupSchema.safeParse(group).success).toBe(true);
		expect(
			CampusGroupsCatalogSchema.safeParse({
				schemaVersion: "campus-groups-catalog.v1",
				sections: [{ groups: [group], id: "interest-groups", name: "同好群" }],
			}).success,
		).toBe(true);
	});

	it("accepts an official Discord invite link", () => {
		expect(
			CampusGroupSchema.safeParse({
				...group,
				id: "discord-muc-community",
				joinUrl: "https://discord.gg/XgQqU9zrPZ",
				name: "Discord",
				qqGroupNumber: null,
			}).success,
		).toBe(true);
	});

	it("rejects unknown catalog fields and duplicate groups", () => {
		expect(
			CampusGroupsCatalogSchema.safeParse({
				schemaVersion: "campus-groups-catalog.v1",
				sections: [{ groups: [group], id: "interest-groups", name: "同好群" }],
				unexpected: true,
			}).success,
		).toBe(false);
		expect(
			CampusGroupsCatalogSchema.safeParse({
				schemaVersion: "campus-groups-catalog.v1",
				sections: [
					{ groups: [group], id: "interest-groups", name: "同好群" },
					{ groups: [group], id: "clubs", name: "社团群" },
				],
			}).success,
		).toBe(false);
	});

	it("rejects duplicate section ids and names", () => {
		expect(
			CampusGroupsCatalogSchema.safeParse({
				schemaVersion: "campus-groups-catalog.v1",
				sections: [
					{ groups: [], id: "same", name: "同好群" },
					{ groups: [], id: "same", name: "社团群" },
				],
			}).success,
		).toBe(false);
		expect(
			CampusGroupsCatalogSchema.safeParse({
				schemaVersion: "campus-groups-catalog.v1",
				sections: [
					{ groups: [], id: "one", name: "同好群" },
					{ groups: [], id: "two", name: "同好群" },
				],
			}).success,
		).toBe(false);
	});
});
