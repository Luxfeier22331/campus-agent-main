import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DocsCourseMapFigure } from "../src/components/docs/docs-reader-view";
import {
	ReaderBlock,
	ReaderDocument,
	ReaderDocumentMeta,
	ReaderHeading,
	ReaderMarkdownTable,
	ReaderTable,
} from "../src/components/docs/reader-components";

afterEach(() => {
	window.history.replaceState(null, "", "/");
	vi.restoreAllMocks();
});

describe("declarative docs reader components", () => {
	it("updates highlighted blocks and focuses anchors from browser location state", async () => {
		window.history.replaceState(null, "", "/docs/rules?hl=root-a#a");
		vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => undefined);

		render(
			<ReaderDocument>
				<ReaderHeading anchor="a" level={2} rootUnitId="root-a" title="第一段" />
				<ReaderBlock rootUnitId="root-a">第一段正文</ReaderBlock>
				<ReaderHeading anchor="b" level={2} rootUnitId="root-b" title="第二段" />
				<ReaderBlock rootUnitId="root-b">第二段正文</ReaderBlock>
			</ReaderDocument>,
		);

		await waitFor(() => {
			expect(screen.getByText("第一段正文")).toHaveClass("docs-reader-highlight");
		});
		expect(document.getElementById("a")?.parentElement).toHaveAttribute(
			"data-docs-heading-level",
			"2",
		);
		expect(document.getElementById("a")).toHaveFocus();

		window.history.pushState(null, "", "/docs/rules?hl=root-b#b");
		window.dispatchEvent(new PopStateEvent("popstate"));

		await waitFor(() => {
			expect(screen.getByText("第一段正文")).not.toHaveClass("docs-reader-highlight");
			expect(screen.getByText("第二段正文")).toHaveClass("docs-reader-highlight");
		});
		expect(document.getElementById("b")).toHaveFocus();
	});

	it("copies a permalink containing the heading anchor and related reader block", async () => {
		window.history.replaceState(null, "", "/docs/rules?hl=old#old");
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText },
		});

		render(
			<ReaderDocument>
				<ReaderHeading
					anchor="scholarship"
					level={2}
					rootUnitId="root-scholarship"
					title="奖学金申请条件"
				/>
			</ReaderDocument>,
		);

		fireEvent.click(screen.getByRole("button", { name: "复制“奖学金申请条件”链接" }));

		await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
		const copiedUrl = new URL(writeText.mock.calls[0]?.[0] ?? "");
		expect(copiedUrl.pathname).toBe("/docs/rules");
		expect(copiedUrl.search).toBe("?hl=root-scholarship");
		expect(copiedUrl.hash).toBe("#scholarship");
		expect(screen.getByRole("status")).toHaveTextContent("已复制链接");
	});

	it("renders a version selector and historical-version warning from route metadata", () => {
		window.history.replaceState(null, "", "/docs/regulations/student_rules/rules?hl=root-a#a");

		render(
			<ReaderDocument>
				<ReaderDocumentMeta
					collectionLabel="学生手册"
					versionSlug="2025"
					versions={[
						{ canonicalUrl: "/docs/regulations/student_rules/rules", versionSlug: "2026" },
						{
							canonicalUrl: "/docs/regulations/student_rules/rules/v/2025",
							versionSlug: "2025",
						},
					]}
				/>
			</ReaderDocument>,
		);

		expect(
			screen.getByRole("status", { name: "正在阅读历史版本，请以当前版为准。" }),
		).toHaveTextContent("正在阅读历史版本 2025 年版，当前版为 2026 年版。查看当前版");
		const versionSelector = screen.getByRole("combobox", { name: "选择文档版本" });
		expect(versionSelector).toHaveTextContent("2025 年版");
		const metadata = screen.getByLabelText("文档信息与版本");
		expect(metadata).toHaveTextContent("学生手册");
		expect(metadata.querySelector("details")).toBeNull();
	});

	it("renders version details only when the version declares them", () => {
		const { rerender } = render(
			<ReaderDocumentMeta
				collectionLabel={null}
				details={{
					documentNumber: "民大校发〔2025〕141号",
					effectiveDate: "2025-09-01",
					source: { name: "学校信息公开网", url: "https://xxgk.muc.edu.cn/info/1198/4051.htm" },
				}}
				versionSlug="2025"
			/>,
		);
		const metadata = screen.getByLabelText("文档信息与版本");
		expect(metadata).toHaveTextContent("文号民大校发〔2025〕141号");
		expect(metadata.querySelector("time")).toHaveAttribute("dateTime", "2025-09-01");
		expect(metadata).toHaveTextContent("施行2025 年 9 月 1 日");
		const source = screen.getByRole("link", { name: "学校信息公开网" });
		expect(source).toHaveAttribute("href", "https://xxgk.muc.edu.cn/info/1198/4051.htm");
		expect(source).toHaveAttribute("target", "_blank");
		expect(source).toHaveAttribute("rel", "noopener noreferrer");

		rerender(<ReaderDocumentMeta collectionLabel={null} details={null} versionSlug="2025" />);
		expect(screen.getByLabelText("文档信息与版本").querySelector("dl")).toBeNull();
	});

	it("links to the newest version and preserves modified native link clicks", () => {
		const onVersionNavigate = vi.fn();
		render(
			<ReaderDocumentMeta
				collectionLabel={null}
				onVersionNavigate={onVersionNavigate}
				versionSlug="2025"
				versions={[
					{ canonicalUrl: "/docs/rules/v/2024", versionSlug: "2024" },
					{ canonicalUrl: "/docs/rules", versionSlug: "2026" },
					{ canonicalUrl: "/docs/rules/v/2025", versionSlug: "2025" },
				]}
			/>,
		);
		const currentVersion = screen.getByRole("link", { name: "查看当前版" });
		expect(currentVersion).toHaveAttribute("href", "/docs/rules");
		fireEvent.click(currentVersion);
		expect(onVersionNavigate).toHaveBeenCalledExactlyOnceWith("/docs/rules");
		onVersionNavigate.mockClear();
		fireEvent.click(currentVersion, { ctrlKey: true });
		expect(onVersionNavigate).not.toHaveBeenCalled();
	});

	it("keeps compact tables semantic without deriving mobile cards", () => {
		render(
			<ReaderTable
				rows={[
					[
						{ tag: "th", text: "课程" },
						{ tag: "th", text: "学分" },
					],
					[
						{ tag: "td", text: "战场医疗救护" },
						{ rowSpan: 2, tag: "td", text: "0.5" },
					],
					[{ tag: "td", text: "志愿服务" }],
					[
						{ tag: "td", text: "创新项目" },
						{ tag: "td", text: "" },
					],
				]}
			/>,
		);

		expect(screen.getByRole("table")).toBeInTheDocument();
		const tableContainer = screen.getByRole("table").parentElement;
		expect(tableContainer).not.toHaveAttribute("data-docs-sticky-first-column");
		expect(tableContainer).toHaveAttribute("data-docs-overflowing", "false");
		expect(tableContainer).not.toHaveAttribute("tabindex");
		expect(screen.queryByLabelText("表格移动端按行阅读")).not.toBeInTheDocument();
		expect(screen.getByText("0.5")).toHaveAttribute("rowspan", "2");
	});

	it("keeps every row of a table without column headers in the scrollable table", () => {
		render(
			<ReaderTable
				rows={[
					[
						{ tag: "td", text: "姓名" },
						{ tag: "td", text: "学院领导签字" },
					],
					[
						{ tag: "td", text: "学号" },
						{ tag: "td", text: "补办日期" },
					],
					...Array.from({ length: 5 }, (_, index) => [
						{ tag: "td" as const, text: `字段 ${index + 3}` },
						{ tag: "td" as const, text: `内容 ${index + 3}` },
					]),
				]}
			/>,
		);

		const table = screen.getByRole("table");
		expect(table.parentElement).not.toHaveAttribute("data-docs-sticky-first-column");
		expect(within(table).getAllByRole("row")).toHaveLength(7);
		expect(within(table).getByText("姓名")).toBeInTheDocument();
		expect(screen.queryByLabelText("表格移动端按行阅读")).not.toBeInTheDocument();
		expect(within(table).queryByRole("columnheader")).not.toBeInTheDocument();
	});

	it("marks overflowing markdown tables from measured dimensions", async () => {
		vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (
			this: HTMLElement,
		) {
			return this.classList.contains("docs-table-scroll") ? 640 : 0;
		});
		vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
			this: HTMLElement,
		) {
			return this.classList.contains("docs-table-scroll") ? 320 : 0;
		});

		render(
			<ReaderMarkdownTable>
				<tbody>
					<tr>
						<td>课程名称</td>
						<td>课程类别</td>
					</tr>
				</tbody>
			</ReaderMarkdownTable>,
		);

		await waitFor(() => {
			const tableContainer = screen.getByRole("table").parentElement;
			expect(tableContainer).toHaveAttribute("data-docs-overflowing", "true");
			expect(tableContainer).toHaveAttribute("tabindex", "0");
		});
		const tableContainer = screen.getByRole("table").parentElement;
		expect(tableContainer).toHaveAttribute("tabindex", "0");
	});

	it("reserves course-map space and opens an in-page original image viewer", async () => {
		render(
			<DocsCourseMapFigure
				courseMap={{
					mapId: "course-map-1",
					parts: [
						{
							height: 649,
							imageUrl: "/_docs/course-map.png",
							partId: "course-map-part-1",
							width: 1233,
						},
					],
					targetRootUnitId: "course-map-heading",
					title: "培养方案课程地图",
				}}
			/>,
		);

		const trigger = screen.getByRole("button", { name: /培养方案课程地图\s*查看大图/u });
		const preview = within(trigger).getByRole("img", { name: "培养方案课程地图" });
		expect(within(preview).getByRole("presentation")).toHaveAttribute("width", "1233");
		expect(within(preview).getByRole("presentation")).toHaveAttribute("height", "649");

		fireEvent.click(trigger);
		const dialog = await screen.findByRole("dialog");
		expect(within(dialog).getByRole("region", { name: "培养方案课程地图大图" })).toBeVisible();
		expect(within(dialog).getByRole("link", { name: "打开原始文件" })).toHaveAttribute(
			"href",
			"/_docs/course-map.png",
		);
	});

	it("does not render a version selector when only one version is published", () => {
		render(
			<ReaderDocument>
				<ReaderDocumentMeta
					collectionLabel="学生手册"
					versionSlug="2026"
					versions={[
						{ canonicalUrl: "/docs/regulations/student_rules/rules", versionSlug: "2026" },
					]}
				/>
			</ReaderDocument>,
		);

		expect(screen.queryByRole("combobox", { name: "选择文档版本" })).not.toBeInTheDocument();
		expect(screen.getByText("学生手册")).toBeInTheDocument();
		expect(screen.getByText("2026 年版")).toBeInTheDocument();
		expect(screen.queryByText("来源详情")).not.toBeInTheDocument();
	});
});
