import { describe, expect, it } from "vitest";

import { getProductNavItems, isProductNavActive } from "../src/platform/navigation/product-nav";

describe("campus product navigation model", () => {
	it("keeps product entries centralized for app shells and docs", () => {
		expect(getProductNavItems().map((item) => [item.id, item.href, item.label])).toEqual([
			["chat", "/", "问答"],
			["docs", "/docs", "文档"],
			["map", "/map", "校园地图"],
			["dining", "/dining", "食堂"],
			["groups", "/groups", "同好群"],
			["feedback", "/feedback", "反馈"],
		]);
	});

	it("uses one active-route rule across product surfaces", () => {
		const items = getProductNavItems();
		const byId = Object.fromEntries(items.map((item) => [item.id, item]));

		expect(isProductNavActive("/", byId.chat)).toBe(true);
		expect(isProductNavActive("/c/conv_01", byId.chat)).toBe(true);
		expect(isProductNavActive("/docs/regulations", byId.docs)).toBe(true);
		expect(isProductNavActive("/map", byId.map)).toBe(true);
		expect(isProductNavActive("/dining", byId.dining)).toBe(true);
		expect(isProductNavActive("/groups", byId.groups)).toBe(true);
		expect(isProductNavActive("/feedback", byId.feedback)).toBe(true);
		expect(isProductNavActive("/feedback/extra", byId.feedback)).toBe(false);
	});
});
