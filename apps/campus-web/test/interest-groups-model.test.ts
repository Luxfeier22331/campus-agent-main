import { describe, expect, it } from "vitest";
import {
	countInterestGroups,
	filterInterestGroupCatalog,
	getQqGroupAvatarUrl,
	getSafeGroupJoinLink,
	type InterestGroupCatalog,
	toInterestGroupCatalog,
} from "../src/features/interest-groups/model";

const catalog = {
	sections: [
		{
			groups: [
				{
					id: "photography",
					name: "摄影同好群",
					qqGroupNumber: "123456789",
					summary: "交流校园摄影与外拍活动。",
					tags: ["摄影", "外拍"],
				},
			],
			id: "arts",
			name: "文艺创作",
		},
		{
			groups: [
				{
					id: "badminton",
					name: "羽毛球约球群",
					qqGroupNumber: "987654321",
					summary: "寻找校内球友。",
					tags: ["羽毛球", "运动"],
				},
			],
			id: "sports",
			name: "体育运动",
		},
	],
} as const satisfies InterestGroupCatalog;

describe("interest group catalog", () => {
	it("searches group names, numbers, summaries, tags and section names", () => {
		expect(countInterestGroups(catalog)).toBe(2);
		expect(filterInterestGroupCatalog(catalog, "摄影").sections[0]?.groups[0]?.id).toBe(
			"photography",
		);
		expect(filterInterestGroupCatalog(catalog, "987654321").sections[0]?.groups[0]?.id).toBe(
			"badminton",
		);
		expect(filterInterestGroupCatalog(catalog, "寻找校内球友").sections[0]?.id).toBe("sports");
		expect(filterInterestGroupCatalog(catalog, "文艺创作").sections[0]?.id).toBe("arts");
		expect(filterInterestGroupCatalog(catalog, "不存在").sections).toEqual([]);
	});

	it("normalizes full-width and case differences", () => {
		expect(filterInterestGroupCatalog(catalog, "１２３４５６７８９").sections[0]?.id).toBe("arts");
	});

	it("only accepts official QQ and Discord HTTPS join links", () => {
		expect(getSafeGroupJoinLink("https://qm.qq.com/cgi-bin/qm/qr?k=test")).toEqual({
			platform: "qq",
			url: "https://qm.qq.com/cgi-bin/qm/qr?k=test",
		});
		expect(getSafeGroupJoinLink("https://discord.gg/XgQqU9zrPZ")).toEqual({
			platform: "discord",
			url: "https://discord.gg/XgQqU9zrPZ",
		});
		expect(getSafeGroupJoinLink("http://qm.qq.com/cgi-bin/qm/qr?k=test")).toBeNull();
		expect(getSafeGroupJoinLink("https://example.com/join")).toBeNull();
		expect(getSafeGroupJoinLink("not-a-url")).toBeNull();
	});

	it("derives a safe QQ group avatar URL from a numeric group number", () => {
		expect(getQqGroupAvatarUrl("825319996")).toBe("https://p.qlogo.cn/gh/825319996/825319996/100/");
		expect(getQqGroupAvatarUrl(" 825319996 ")).toBe(
			"https://p.qlogo.cn/gh/825319996/825319996/100/",
		);
		expect(getQqGroupAvatarUrl("group-number")).toBeNull();
	});

	it("preserves server section and group order without inferring status", () => {
		const result = toInterestGroupCatalog({
			schemaVersion: "campus-groups-catalog.v1",
			sections: [
				{
					groups: [
						{
							id: "qq-720518745",
							joinUrl: null,
							name: "LML民大峡谷之巅推免交流群",
							qqGroupNumber: "720518745",
							summary: "已阵亡",
							tags: ["LOL"],
						},
					],
					id: "interest-groups",
					name: "同好群",
				},
				{ groups: [], id: "empty", name: "空分组" },
			],
		});
		expect(result.sections.map(({ id }) => id)).toEqual(["interest-groups"]);
		expect(result.sections[0]?.name).toBe("同好群");
		expect(result.sections[0]?.groups[0]?.summary).toBe("已阵亡");
	});
});
