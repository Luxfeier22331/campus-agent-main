import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RouteMetadata, resolveRouteMetadata } from "../src/app/route-metadata";

describe("campus-web route metadata", () => {
	it("defines distinct public metadata for product routes", () => {
		expect(resolveRouteMetadata("/dining")).toMatchObject({
			canonicalPath: "/dining",
			description: expect.stringContaining("食堂"),
			title: "食堂地图 | 中央民族大学校园问答",
		});
		expect(resolveRouteMetadata("/map").title).toBe("校园地图 | 中央民族大学校园问答");
		expect(resolveRouteMetadata("/groups")).toMatchObject({
			canonicalPath: "/groups",
			title: "同好群 | 中央民族大学校园问答",
		});
		expect(resolveRouteMetadata("/feedback").canonicalPath).toBe("/feedback");
	});

	it("marks private conversation and account routes as non-indexable", () => {
		expect(resolveRouteMetadata("/c/conversation-1")).toMatchObject({
			canonicalPath: null,
			robots: "noindex,nofollow",
		});
		expect(resolveRouteMetadata("/account/settings/security")).toMatchObject({
			canonicalPath: null,
			robots: "noindex,nofollow",
			title: "账号安全 | 中央民族大学校园问答",
		});
		expect(resolveRouteMetadata("/notices")).toMatchObject({
			canonicalPath: null,
			robots: "noindex,nofollow",
			title: "通知目录 | 中央民族大学校园问答",
		});
		expect(resolveRouteMetadata("/notices/358159")).toMatchObject({
			canonicalPath: null,
			robots: "noindex,nofollow",
			title: "通知详情 | 中央民族大学校园问答",
		});
	});

	it("renders route metadata through React-managed head elements", () => {
		render(<RouteMetadata pathname="/dining" />);

		expect(document.title).toBe("食堂地图 | 中央民族大学校园问答");
		expect(document.head.querySelector('meta[name="description"]')).toHaveAttribute(
			"content",
			expect.stringContaining("食堂"),
		);
		expect(document.head.querySelector('link[rel="canonical"]')).toHaveAttribute("href", "/dining");
	});
});
