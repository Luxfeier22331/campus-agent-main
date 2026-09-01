import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SourceItemsList } from "../src/components/conversation/source-items";

describe("conversation source items", () => {
	it("renders Campus Docs sources as internal links", () => {
		render(
			<SourceItemsList
				sourceItems={[
					{
						citationIndexes: [10, 1],
						collectionLabel: "学生手册",
						kind: "campus_document",
						primaryAction: {
							disabledReason: null,
							external: false,
							href: "/docs/regulations/student_rules/network-guide/v/2026#account",
							label: "查看文档",
						},
						sectionTitle: "校园网账号",
						snippet: "校园网用户应按学校规定管理账号。",
						title: "上网指南",
						versionSlug: "2026",
					},
				]}
			/>,
		);

		expect(screen.getByText("上网指南")).toBeInTheDocument();
		expect(screen.getByText("[10] [1]")).toBeInTheDocument();
		expect(screen.getByLabelText("引用 10、1")).toBeInTheDocument();
		expect(screen.getByText("学生手册 · 2026 年版")).toBeInTheDocument();
		expect(screen.getByText("校园网用户应按学校规定管理账号。")).toBeInTheDocument();
		const link = screen.getByRole("link", { name: "查看文档" });
		expect(link).toHaveAttribute(
			"href",
			"/docs/regulations/student_rules/network-guide/v/2026#account",
		);
		expect(link).not.toHaveAttribute("target");
	});

	it("renders Web sources as safe external links", () => {
		render(
			<SourceItemsList
				sourceItems={[
					{
						citationIndexes: [6],
						hostname: "www.muc.edu.cn",
						kind: "web_page",
						primaryAction: {
							disabledReason: null,
							external: true,
							href: "https://www.muc.edu.cn/contact?campus=fengtai#address",
							label: "打开网页",
						},
						snippet: null,
						title: "联系我们",
					},
				]}
			/>,
		);

		expect(screen.getByText("www.muc.edu.cn")).toBeInTheDocument();
		const link = screen.getByRole("link", { name: "打开网页" });
		expect(link).toHaveAttribute("href", "https://www.muc.edu.cn/contact?campus=fengtai#address");
		expect(link).toHaveAttribute("target", "_blank");
		expect(link).toHaveAttribute("rel", "noopener noreferrer");
	});

	it("shows five sources by default and expands the complete collection", () => {
		const sourceItems = Array.from({ length: 6 }, (_, index) => ({
			citationIndexes: [index + 1],
			hostname: "www.muc.edu.cn",
			kind: "web_page" as const,
			primaryAction: {
				disabledReason: null,
				external: true as const,
				href: `https://www.muc.edu.cn/page/${index + 1}`,
				label: "打开网页" as const,
			},
			snippet: null,
			title: `来源 ${index + 1}`,
		}));

		render(<SourceItemsList sourceItems={sourceItems} />);

		expect(screen.getByText("来源 5")).toBeInTheDocument();
		expect(screen.queryByText("来源 6")).not.toBeInTheDocument();
		const expand = screen.getByRole("button", { name: "查看其余 1 个来源" });
		expect(expand).toHaveAttribute("aria-expanded", "false");

		fireEvent.click(expand);
		expect(screen.getByText("来源 6")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "收起来源" })).toHaveAttribute(
			"aria-expanded",
			"true",
		);

		fireEvent.click(screen.getByRole("button", { name: "收起来源" }));
		expect(screen.queryByText("来源 6")).not.toBeInTheDocument();
	});
});
