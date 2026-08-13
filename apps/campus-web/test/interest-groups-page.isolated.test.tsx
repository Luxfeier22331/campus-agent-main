import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { InterestGroupsPageContent } from "../src/app/routes/interest-groups-page";
import type { InterestGroupCatalog } from "../src/features/interest-groups/model";

const catalog = {
	sections: [
		{
			groups: [
				{
					id: "photography",
					joinUrl: "https://qm.qq.com/cgi-bin/qm/qr?k=photography",
					name: "摄影同好群",
					qqGroupNumber: "123456789",
					summary: "交流校园摄影与外拍活动。",
					tags: ["摄影", "外拍"],
				},
				{
					id: "discord",
					joinUrl: "https://discord.gg/XgQqU9zrPZ",
					name: "Discord",
					qqGroupNumber: null,
					summary: "中央民族大学 Discord 交流群。",
					tags: ["综合交流"],
				},
			],
			id: "arts",
			name: "文艺创作",
		},
		{
			groups: [
				{
					id: "badminton",
					joinUrl: "https://example.com/not-allowed",
					name: "羽毛球约球群",
					qqGroupNumber: "987654321",
					summary: "寻找校内球友。",
					tags: ["羽毛球", "运动"],
				},
				{
					id: "it-association",
					joinUrl: null,
					name: "IT协会",
					qqGroupNumber: null,
					summary: "",
					tags: [],
				},
			],
			id: "sports",
			name: "体育运动",
		},
	],
} as const satisfies InterestGroupCatalog;

describe("interest groups page", () => {
	it("renders QQ, Discord and groups without public contact details", () => {
		render(<InterestGroupsPageContent catalog={catalog} />);

		expect(screen.getByRole("heading", { level: 1, name: "同好群" })).toBeInTheDocument();
		expect(screen.getAllByRole("navigation", { name: "同好群分类" })).toHaveLength(1);
		expect(screen.getByRole("heading", { name: "摄影同好群" })).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "摄影同好群" })).toHaveClass(
			"text-base",
			"text-[var(--sys-text-strong)]",
		);
		expect(screen.getByRole("heading", { name: "羽毛球约球群" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "加入 摄影同好群" })).toHaveAttribute(
			"href",
			"https://qm.qq.com/cgi-bin/qm/qr?k=photography",
		);
		expect(screen.getByRole("link", { name: "打开 摄影同好群 的加入链接" })).toHaveAttribute(
			"href",
			"https://qm.qq.com/cgi-bin/qm/qr?k=photography",
		);
		expect(screen.getByRole("link", { name: "加入 Discord" })).toHaveAttribute(
			"href",
			"https://discord.gg/XgQqU9zrPZ",
		);
		expect(screen.getByRole("link", { name: "打开 Discord 的加入链接" })).toHaveAttribute(
			"href",
			"https://discord.gg/XgQqU9zrPZ",
		);
		expect(screen.queryByRole("link", { name: "加入 羽毛球约球群" })).not.toBeInTheDocument();
		expect(
			screen.queryByRole("link", { name: "打开 羽毛球约球群 的加入链接" }),
		).not.toBeInTheDocument();
		expect(screen.queryByRole("link", { name: "加入 IT协会" })).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: "复制群号 987654321" })).toBeInTheDocument();
		expect(screen.getByText("暂未提供")).toBeInTheDocument();
		expect(screen.getByText("寻找校内球友。")).toBeInTheDocument();
	});

	it("filters every visible section and clears a no-result query", async () => {
		const user = userEvent.setup();
		render(<InterestGroupsPageContent catalog={catalog} />);

		await user.type(screen.getByRole("searchbox", { name: "搜索同好群" }), "摄影");
		expect(screen.getByRole("heading", { name: "摄影同好群" })).toBeInTheDocument();
		expect(screen.queryByRole("heading", { name: "羽毛球约球群" })).not.toBeInTheDocument();
		expect(screen.getByText("找到 1 条")).toBeInTheDocument();

		await user.clear(screen.getByRole("searchbox", { name: "搜索同好群" }));
		await user.type(screen.getByRole("searchbox", { name: "搜索同好群" }), "不存在");
		expect(screen.getByText("没有找到匹配的群")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "清除搜索" }));
		expect(screen.getByRole("heading", { name: "羽毛球约球群" })).toBeInTheDocument();
	});

	it("tracks the selected category and exposes page navigation", async () => {
		const user = userEvent.setup();
		render(<InterestGroupsPageContent catalog={catalog} />);

		const categoryLinks = screen.getAllByRole("link", { name: /文艺创作|体育运动/ });
		const [firstCategoryLink, secondCategoryLink] = categoryLinks;
		if (!(firstCategoryLink && secondCategoryLink)) {
			throw new Error("expected two category links");
		}
		expect(firstCategoryLink).toHaveAttribute("aria-current", "location");
		expect(screen.queryByRole("link", { name: "返回顶部" })).not.toBeInTheDocument();
		expect(screen.getByRole("searchbox", { name: "搜索同好群" })).toHaveAttribute(
			"aria-controls",
			"interest-groups-results",
		);

		await user.click(secondCategoryLink);
		expect(firstCategoryLink).not.toHaveAttribute("aria-current");
		expect(secondCategoryLink).toHaveAttribute("aria-current", "location");

		await act(async () => {
			Object.defineProperty(window, "scrollY", { configurable: true, value: 600 });
			window.dispatchEvent(new Event("scroll"));
		});
		expect(screen.getByRole("link", { name: "返回顶部" })).toHaveAttribute(
			"href",
			"#interest-groups-top",
		);
		Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
	});

	it("copies a group number", async () => {
		const user = userEvent.setup();
		render(<InterestGroupsPageContent catalog={catalog} />);

		await user.click(screen.getByRole("button", { name: "复制群号 123456789" }));
		expect(await navigator.clipboard.readText()).toBe("123456789");
		expect(screen.getByText("群号已复制")).toBeInTheDocument();
		expect(screen.getByText("已复制")).toBeVisible();
	});

	it("shows a truthful empty catalog state", () => {
		render(<InterestGroupsPageContent catalog={{ sections: [] }} />);

		expect(screen.getByText("暂无已收录的同好群")).toBeInTheDocument();
		expect(screen.getByRole("searchbox", { name: "搜索同好群" })).toBeDisabled();
		expect(screen.getByText("共收录 0 条目录")).toBeInTheDocument();
	});
});
