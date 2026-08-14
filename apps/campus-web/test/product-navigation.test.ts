import { describe, expect, it } from "vitest";

import { getProductNavItems, isProductNavActive } from "../src/platform/navigation/product-nav";

describe("campus product navigation model", () => {
	it("keeps product entries centralized for app shells and docs", () => {
		expect(getProductNavItems().map((item) => [item.id, item.href, item.label])).toEqual([
			["chat", "/", "问答"],
			["docs", "/docs", "文档"],
			["notices", "/notices", "通知"],
			["map", "/map", "校园地图"],
			["dining", "/dining", "食堂"],
			["groups", "/groups", "同好群"],
			["feedback", "/feedback", "反馈"],
			["status", "/status", "服务状态"],
		]);
	});

	it("uses one active-route rule across product surfaces", () => {
		const items = getProductNavItems();
		const findItem = (id: (typeof items)[number]["id"]) => {
			const item = items.find((candidate) => candidate.id === id);
			if (!item) {
				throw new Error(`missing product navigation item: ${id}`);
			}
			return item;
		};

		expect(isProductNavActive("/", findItem("chat"))).toBe(true);
		expect(isProductNavActive("/c/conv_01", findItem("chat"))).toBe(true);
		expect(isProductNavActive("/docs/regulations", findItem("docs"))).toBe(true);
		expect(isProductNavActive("/notices/358159", findItem("notices"))).toBe(true);
		expect(isProductNavActive("/map", findItem("map"))).toBe(true);
		expect(isProductNavActive("/dining", findItem("dining"))).toBe(true);
		expect(isProductNavActive("/groups", findItem("groups"))).toBe(true);
		expect(isProductNavActive("/feedback", findItem("feedback"))).toBe(true);
		expect(isProductNavActive("/feedback/extra", findItem("feedback"))).toBe(false);
		expect(isProductNavActive("/status", findItem("status"))).toBe(true);
		expect(isProductNavActive("/status/", findItem("status"))).toBe(false);
		expect(findItem("status").linkMode).toBe("anchor");
	});
});
