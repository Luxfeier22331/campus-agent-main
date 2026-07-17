import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
	ReaderBlock,
	ReaderDocument,
	ReaderDocumentMeta,
	ReaderHeading,
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
			<ReaderDocument layout="reference" measure="wide">
				<ReaderHeading anchor="a" level={2} rootUnitId="root-a" title="第一段" />
				<ReaderBlock rootUnitId="root-a">第一段正文</ReaderBlock>
				<ReaderHeading anchor="b" level={2} rootUnitId="root-b" title="第二段" />
				<ReaderBlock rootUnitId="root-b">第二段正文</ReaderBlock>
			</ReaderDocument>,
		);

		await waitFor(() => {
			expect(screen.getByText("第一段正文")).toHaveClass("docs-reader-highlight");
		});
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
			<ReaderDocument layout="article" measure="standard">
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

	it("renders version navigation and a historical-version warning without DOM injection", () => {
		window.history.replaceState(null, "", "/docs/regulations/student_rules/rules?hl=root-a#a");

		render(
			<ReaderDocument layout="reference" measure="wide">
				<ReaderDocumentMeta
					collection="student_rules"
					collectionLabel="学生手册"
					corpus="regulations"
					documentSlug="rules"
					isCurrent={false}
					routeSlug="rules"
					searchVisibility="noindex"
					sourceLabel="学生手册"
					versionLabel="2025 版"
					versionSlug="2025-history"
					versions={[
						{ isCurrent: true, label: "现行版", versionSlug: "2026-current" },
						{ isCurrent: false, label: "2025 版", versionSlug: "2025-history" },
					]}
				/>
			</ReaderDocument>,
		);

		expect(screen.getByText("正在阅读历史版本，请以当前版为准。")).toBeInTheDocument();
		const currentVersion = screen.getByRole("link", { name: "现行版" });
		expect(currentVersion).toHaveAttribute(
			"href",
			"/docs/regulations/student_rules/rules?hl=root-a#a",
		);
		expect(screen.getByText("2025 版", { selector: '[aria-current="page"]' })).toBeInTheDocument();
	});

	it("renders compact tables as both semantic tables and mobile row cards", () => {
		render(
			<ReaderTable
				rows={[
					[
						{ tag: "th", text: "课程" },
						{ tag: "th", text: "学分" },
					],
					[
						{ tag: "td", text: "社会实践" },
						{ tag: "td", text: "1" },
					],
				]}
			/>,
		);

		expect(screen.getByRole("table")).toBeInTheDocument();
		expect(screen.getByLabelText("表格移动端按行阅读")).toBeInTheDocument();
		expect(
			screen.getByText("社会实践", { selector: ".docs-table-mobile-card-title" }),
		).toBeVisible();
		expect(screen.getByRole("table").parentElement).toHaveAttribute(
			"data-docs-table-kind",
			"mobile-cards",
		);
	});

	it("shows a local version status when remote metadata is unavailable", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("unavailable", { status: 503 }));

		render(
			<ReaderDocument layout="reference" measure="wide">
				<ReaderDocumentMeta
					collection="student_rules"
					collectionLabel="学生手册"
					corpus="regulations"
					documentSlug="rules"
					isCurrent
					routeSlug="rules"
					searchVisibility="public_current"
					sourceLabel="学生手册"
					versionLabel="现行版"
					versionSlug="2026-current"
				/>
			</ReaderDocument>,
		);

		await expect(screen.findByText("文档版本信息暂不可用。")).resolves.toHaveClass(
			"docs-version-switcher-error",
		);
	});
});
