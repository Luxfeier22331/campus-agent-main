import { describe, expect, it } from "vitest";

import {
	buildRspressProductNav,
	getProductNavItems,
	isProductNavActive,
} from "../src/platform/navigation/product-nav";

describe("campus product navigation model", () => {
	it("keeps product entries centralized for app shells and docs", () => {
		expect(getProductNavItems().map((item) => [item.id, item.href, item.label])).toEqual([
			["chat", "/", "问答"],
			["docs", "/docs/regulations/student_rules/doc-c62077b20430", "文档"],
			["map", "/map", "校园地图"],
			["dining", "/dining", "食堂"],
			["feedback", "/feedback", "反馈"],
		]);
		expect(buildRspressProductNav()).toEqual([
			{ activeMatch: "^/$|^/c/", link: "/", text: "问答" },
			{ link: "/docs/regulations/student_rules/doc-c62077b20430", text: "文档" },
			{ link: "/map", text: "校园地图" },
			{ link: "/dining", text: "食堂" },
			{ link: "/feedback", text: "反馈" },
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
		expect(isProductNavActive("/feedback", byId.feedback)).toBe(true);
		expect(isProductNavActive("/feedback/extra", byId.feedback)).toBe(false);
	});
});
