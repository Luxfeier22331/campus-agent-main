import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SourceItemsList } from "../src/components/conversation/source-items";

describe("conversation source items", () => {
	it("keeps unavailable sources numbered without rendering a link", () => {
		const { container } = render(
			<SourceItemsList
				sourceItems={[1, 2].map((index) => ({
					kind: "web_page",
					title: "网页标题暂不可用",
					hostname: null,
					snippet: null,
					citationIndexes: [index],
					primaryAction: {
						label: "打开网页",
						href: null,
						external: true,
						disabledReason: "source_unavailable",
					},
				}))}
			/>,
		);
		expect(screen.getByLabelText("引用 1")).toBeInTheDocument();
		expect(screen.getByLabelText("引用 2")).toBeInTheDocument();
		expect(screen.getAllByText("来源暂不可用")).toHaveLength(2);
		expect(container.querySelectorAll("a")).toHaveLength(0);
	});
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
		const { container } = render(
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
		const favicon = container.querySelector('img[src="https://www.muc.edu.cn/favicon.ico"]');
		expect(favicon).toHaveAttribute("referrerpolicy", "no-referrer");
		expect(favicon).toHaveAttribute("loading", "lazy");
	});

	it("falls back to a globe when the favicon fails", () => {
		const { container } = render(
			<SourceItemsList
				sourceItems={[
					{
						citationIndexes: [1],
						hostname: "example.com",
						kind: "web_page",
						primaryAction: {
							disabledReason: null,
							external: true,
							href: "https://example.com/page",
							label: "打开网页",
						},
						snippet: null,
						title: "示例页面",
					},
				]}
			/>,
		);
		const favicon = container.querySelector("img");
		expect(favicon).toHaveAttribute("src", "https://example.com/favicon.ico");
		fireEvent.error(favicon as HTMLImageElement);
		expect(container.querySelector("img")).toBeNull();
		expect(container.querySelector("svg")).toBeInTheDocument();
		expect(screen.getByText("示例页面")).toBeInTheDocument();
	});

	it("does not request favicons for unavailable or internal sources", () => {
		const { container } = render(
			<SourceItemsList
				sourceItems={[
					{
						citationIndexes: [1],
						hostname: null,
						kind: "web_page",
						primaryAction: {
							label: "打开网页",
							href: null,
							external: true,
							disabledReason: "source_unavailable",
						},
						snippet: null,
						title: "不可用来源",
					},
					{
						citationIndexes: [2],
						collectionLabel: "公开文档",
						kind: "campus_document",
						primaryAction: {
							disabledReason: null,
							external: false,
							href: "/docs/regulations/student_rules/network-guide/v/2026",
							label: "查看文档",
						},
						sectionTitle: "章节",
						snippet: null,
						title: "校内文档",
						versionSlug: "2026",
					},
				]}
			/>,
		);
		expect(container.querySelectorAll("img")).toHaveLength(0);
		expect(container.querySelectorAll("svg")).toHaveLength(2);
	});

	it.each([
		["https://vertexaisearch.cloud.google.com/grounding-api-redirect/test", false],
		["https://vertexaisearch.cloud.google.com/other/test", true],
		["https://vertexaisearch.cloud.google.com.example/grounding-api-redirect/test", true],
	])("keeps redirect actions and only hides intermediary metadata: %s", (href, showHostname) => {
		const hostname = new URL(href).hostname;
		const { container } = render(
			<SourceItemsList
				sourceItems={[
					{
						citationIndexes: [1],
						hostname,
						kind: "web_page",
						title: "学校官网",
						snippet: null,
						primaryAction: { disabledReason: null, external: true, href, label: "打开网页" },
					},
				]}
			/>,
		);
		expect(screen.getByText("学校官网")).toBeInTheDocument();
		expect(screen.getByLabelText("引用 1")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "打开网页" })).toHaveAttribute("href", href);
		expect(screen.queryByText(hostname) !== null).toBe(showHostname);
		expect(container.querySelectorAll("p")).toHaveLength(showHostname ? 2 : 1);
	});

	it("renders Campus Notice sources as internal links", () => {
		render(
			<SourceItemsList
				sourceItems={[
					{
						citationIndexes: [3],
						kind: "campus_notice",
						noticeId: "358159",
						primaryAction: {
							disabledReason: null,
							external: false,
							href: "/notices/358159",
							label: "查看通知",
						},
						sectionTitle: "办理要求",
						snippet: "请按通知要求提交材料。",
						title: "关于提交材料的通知",
					},
				]}
			/>,
		);

		expect(screen.getByText("校园通知")).toBeInTheDocument();
		expect(screen.getByText("办理要求")).toBeInTheDocument();
		const link = screen.getByRole("link", { name: "查看通知" });
		expect(link).toHaveAttribute("href", "/notices/358159");
		expect(link).not.toHaveAttribute("target");
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
