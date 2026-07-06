import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import DocsContentEnhancer from "../src/components/docs/docs-content-enhancer";
import MobileSidebarGuard from "../src/components/docs/mobile-sidebar-guard";
import ReaderStateEnhancer from "../src/components/docs/reader-state-enhancer";

afterEach(() => {
	document.body.innerHTML = "";
	window.history.replaceState(null, "", "/");
	vi.restoreAllMocks();
});

describe("campus docs reader enhancers", () => {
	it("marks compact tables for mobile card reading", async () => {
		document.body.innerHTML = `
			<main class="rspress-doc">
				<div class="docs-table-scroll">
					<table>
						<tbody>
							<tr><th>课程</th><th>学分</th></tr>
							<tr><td>社会实践</td><td>1</td></tr>
						</tbody>
					</table>
				</div>
			</main>
		`;

		render(<DocsContentEnhancer />);

		await waitFor(() => {
			expect(document.querySelector(".docs-table-scroll")).toHaveAttribute(
				"data-docs-table-kind",
				"mobile-cards",
			);
		});
		expect(screen.getByLabelText("表格移动端按行阅读")).toBeInTheDocument();
	});

	it("marks large tables for wide scrolling instead of duplicating mobile cards", async () => {
		document.body.innerHTML = `
			<main class="rspress-doc">
				<div class="docs-table-scroll">
					<table>
						<tbody>
							${Array.from({ length: 10 }, (_, rowIndex) => {
								const tag = rowIndex === 0 ? "th" : "td";
								return `<tr>${Array.from(
									{ length: 3 },
									(_, columnIndex) => `<${tag}>${rowIndex}-${columnIndex}</${tag}>`,
								).join("")}</tr>`;
							}).join("")}
						</tbody>
					</table>
				</div>
			</main>
		`;

		render(<DocsContentEnhancer />);

		await waitFor(() => {
			expect(document.querySelector(".docs-table-scroll")).toHaveAttribute(
				"data-docs-table-kind",
				"wide-scroll",
			);
		});
		expect(document.querySelector(".docs-table-mobile-cards")).not.toBeInTheDocument();
	});

	it("renders mobile cards for medium course tables", async () => {
		document.body.innerHTML = `
			<main class="rspress-doc">
				<div class="docs-table-scroll">
					<table>
						<tbody>
							<tr><th>课程名称</th><th>学分</th><th>学时</th><th>修读性质</th><th>学期</th><th>备注</th></tr>
							${Array.from(
								{ length: 12 },
								(_, rowIndex) =>
									`<tr><td>课程 ${rowIndex + 1}</td><td>2</td><td>32</td><td>必修</td><td>${rowIndex + 1}</td><td>无</td></tr>`,
							).join("")}
						</tbody>
					</table>
				</div>
			</main>
		`;

		render(<DocsContentEnhancer />);

		await waitFor(() => {
			expect(document.querySelector(".docs-table-scroll")).toHaveAttribute(
				"data-docs-table-kind",
				"mobile-cards",
			);
		});
		expect(document.querySelectorAll(".docs-table-mobile-card")).toHaveLength(12);
		expect(document.querySelectorAll(".docs-table-mobile-card-title").item(11)).toHaveTextContent(
			"课程 12",
		);
	});

	it("shows a warning when the reader page is a historical version", async () => {
		document.body.innerHTML = `
			<main class="rspress-doc">
				<section
					class="document-meta-panel"
					data-docs-reader-meta="true"
					data-docs-corpus="regulations"
					data-docs-collection="student_rules"
					data-docs-document-slug="student-attendance"
					data-docs-route-slug="student-attendance"
					data-docs-version-slug="2025-history"
					data-docs-is-current="false"
					data-docs-versions='{"versions":[{"isCurrent":true,"label":"现行版","versionSlug":"2026-current"},{"isCurrent":false,"label":"2025 版","versionSlug":"2025-history"}]}'
				>
					<p class="document-meta-summary"><span>2025 版</span></p>
					<details class="document-meta-details"><summary>来源详情</summary></details>
				</section>
			</main>
		`;

		render(<ReaderStateEnhancer />);

		await expect(screen.findByText("正在阅读历史版本，请以当前版为准。")).resolves.toHaveClass(
			"docs-version-history-warning docs-reader-status",
		);
	});

	it("replays highlight and anchor state when reader content appears after mount", async () => {
		window.history.replaceState(
			null,
			"",
			"/docs/curriculum/curriculum_plan/law?hl=root-late#target-section",
		);
		document.body.innerHTML = '<main class="rspress-doc"></main>';
		const scrollIntoView = vi
			.spyOn(Element.prototype, "scrollIntoView")
			.mockImplementation(() => undefined);
		const focus = vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(() => undefined);

		render(<ReaderStateEnhancer />);
		await nextAnimationFrame();
		document.querySelector(".rspress-doc")?.insertAdjacentHTML(
			"beforeend",
			`
				<span id="target-section"></span>
				<div class="reader-block" data-root-unit-id="root-late">延迟正文</div>
			`,
		);

		const block = await screen.findByText("延迟正文");
		await waitFor(() => {
			expect(block).toHaveClass("docs-reader-highlight");
		});
		expect(document.getElementById("target-section")).toHaveAttribute("tabindex", "-1");
		expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
		expect(focus).toHaveBeenCalled();
	});

	it("updates reader highlights when history navigation changes the location state", async () => {
		window.history.replaceState(null, "", "/docs/curriculum/curriculum_plan/law?hl=root-a#a");
		document.body.innerHTML = `
			<main class="rspress-doc">
				<span id="a"></span>
				<div class="reader-block" data-root-unit-id="root-a">第一段</div>
				<span id="b"></span>
				<div class="reader-block" data-root-unit-id="root-b">第二段</div>
			</main>
		`;

		render(<ReaderStateEnhancer />);

		await waitFor(() => {
			expect(screen.getByText("第一段")).toHaveClass("docs-reader-highlight");
		});
		window.history.pushState(null, "", "/docs/curriculum/curriculum_plan/law?hl=root-b#b");
		window.dispatchEvent(new PopStateEvent("popstate"));

		await waitFor(() => {
			expect(screen.getByText("第一段")).not.toHaveClass("docs-reader-highlight");
			expect(screen.getByText("第二段")).toHaveClass("docs-reader-highlight");
		});
	});

	it("marks reader navigation links that match the current hash", async () => {
		window.history.replaceState(null, "", "/docs/curriculum/curriculum_plan/law#b");
		document.body.innerHTML = `
			<nav class="rp-doc-outline" aria-label="本页目录">
				<a href="#a">第一段</a>
				<a href="#b">第二段</a>
			</nav>
			<main class="rspress-doc">
				<span id="a"></span>
				<h2>第一段</h2>
				<span id="b"></span>
				<h2>第二段</h2>
			</main>
		`;

		render(<ReaderStateEnhancer />);

		await waitFor(() => {
			expect(screen.getByRole("link", { name: "第二段" })).toHaveAttribute(
				"aria-current",
				"location",
			);
		});
		expect(screen.getByRole("link", { name: "第二段" })).toHaveClass("docs-reader-current-link");
		expect(screen.getByRole("link", { name: "第一段" })).not.toHaveAttribute("aria-current");

		window.history.pushState(null, "", "/docs/curriculum/curriculum_plan/law#a");
		window.dispatchEvent(new HashChangeEvent("hashchange"));

		await waitFor(() => {
			expect(screen.getByRole("link", { name: "第一段" })).toHaveAttribute(
				"aria-current",
				"location",
			);
		});
		expect(screen.getByRole("link", { name: "第二段" })).not.toHaveAttribute("aria-current");
	});

	it("adds a copy link action for anchored reader blocks", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText },
		});
		window.history.replaceState(null, "", "/docs/regulations/student_rules/rules");
		document.body.innerHTML = `
			<main class="rspress-doc">
				<section>
					<span id="scholarship"></span>
					<h2>奖学金申请条件</h2>
					<div class="reader-block" data-root-unit-id="root-scholarship">奖学金章节正文。</div>
				</section>
			</main>
		`;

		render(<ReaderStateEnhancer />);

		const button = await screen.findByRole("button", { name: "复制“奖学金申请条件”链接" });
		expect(button).toHaveTextContent("#");
		expect(button.parentElement).toHaveClass("docs-reader-heading-actions");
		expect(button.closest("h2")).toBeTruthy();
		button.click();

		await waitFor(() => {
			expect(writeText).toHaveBeenCalledTimes(1);
		});
		const copiedUrl = new URL(writeText.mock.calls[0]?.[0] ?? "");
		expect(copiedUrl.pathname).toBe("/docs/regulations/student_rules/rules");
		expect(copiedUrl.search).toBe("?hl=root-scholarship");
		expect(copiedUrl.hash).toBe("#scholarship");
		expect(screen.getByRole("status")).toHaveTextContent("已复制链接");
	});

	it("ignores native Rspress heading anchor text when naming copy links", async () => {
		document.body.innerHTML = `
			<main class="rspress-doc">
				<h2 id="procedure"><a class="rp-header-anchor" href="#procedure">#</a>处分流程</h2>
				<p>处分流程正文。</p>
			</main>
		`;

		render(<ReaderStateEnhancer />);

		await screen.findByRole("button", { name: "复制“处分流程”链接" });
		expect(screen.queryByRole("button", { name: "复制“#处分流程”链接" })).not.toBeInTheDocument();
	});

	it("does not duplicate copy links for headings with multiple anchor markers", async () => {
		document.body.innerHTML = `
			<main class="rspress-doc">
				<span id="procedure"></span>
				<h2 id="procedure-heading"><a class="rp-header-anchor" href="#procedure-heading">#</a>处分流程</h2>
				<p>处分流程正文。</p>
			</main>
		`;

		render(<ReaderStateEnhancer />);

		await waitFor(() => {
			expect(screen.getAllByRole("button", { name: "复制“处分流程”链接" })).toHaveLength(1);
		});
	});

	it("does not duplicate copy link actions when reader enhancement reruns", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText },
		});
		document.body.innerHTML = `
			<main class="rspress-doc">
				<section>
					<span id="scholarship"></span>
					<h2>奖学金申请条件</h2>
					<div class="reader-block" data-root-unit-id="root-scholarship">奖学金章节正文。</div>
				</section>
			</main>
		`;

		render(<ReaderStateEnhancer />);

		await screen.findByRole("button", { name: "复制“奖学金申请条件”链接" });
		document.querySelector(".rspress-doc")?.insertAdjacentHTML("beforeend", "<p>补充正文</p>");

		await waitFor(() => {
			expect(screen.getAllByRole("button", { name: "复制“奖学金申请条件”链接" })).toHaveLength(1);
		});
		expect(
			screen.queryByRole("button", { name: "复制“奖学金申请条件#”链接" }),
		).not.toBeInTheDocument();
	});

	it("removes copy link controls cloned into the Rspress outline", async () => {
		document.body.innerHTML = `
			<main class="rspress-doc">
				<h2 id="procedure">处分流程</h2>
				<p>处分流程正文。</p>
			</main>
			<aside class="rp-doc-layout__outline">
				<a href="#procedure">
					<span class="rp-toc-item__text">
						处分流程
						<span class="docs-reader-heading-actions">
							<button class="docs-reader-copy-link-button" type="button" aria-label="复制“处分流程”链接">#</button>
						</span>
					</span>
				</a>
			</aside>
		`;

		render(<ReaderStateEnhancer />);

		await waitFor(() => {
			expect(
				document.querySelector(".rp-doc-layout__outline .docs-reader-heading-actions"),
			).not.toBeInTheDocument();
		});
		expect(screen.getAllByRole("button", { name: "复制“处分流程”链接" })).toHaveLength(1);
		expect(document.querySelector(".rspress-doc .docs-reader-heading-actions")).toBeInTheDocument();
	});

	it("removes copy link controls when the Rspress outline is rendered after mount", async () => {
		document.body.innerHTML = `
			<main class="rspress-doc">
				<h2 id="procedure">处分流程</h2>
				<p>处分流程正文。</p>
			</main>
		`;

		render(<ReaderStateEnhancer />);

		await screen.findByRole("button", { name: "复制“处分流程”链接" });
		document.body.insertAdjacentHTML(
			"beforeend",
			`
				<aside class="rp-doc-layout__outline">
					<a href="#procedure">
						<span class="rp-toc-item__text">
							处分流程
							<span class="docs-reader-heading-actions">
								<button class="docs-reader-copy-link-button" type="button" aria-label="复制“处分流程”链接">#</button>
							</span>
						</span>
					</a>
				</aside>
			`,
		);

		await waitFor(() => {
			expect(
				document.querySelector(".rp-doc-layout__outline .docs-reader-heading-actions"),
			).not.toBeInTheDocument();
		});
		expect(screen.getAllByRole("button", { name: "复制“处分流程”链接" })).toHaveLength(1);
	});

	it("shows a local failure status when reader link copying fails", async () => {
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText: vi.fn().mockRejectedValue(new Error("blocked")) },
		});
		document.body.innerHTML = `
			<main class="rspress-doc">
				<section>
					<span id="procedure"></span>
					<h2>处分流程</h2>
					<p>处分流程正文。</p>
				</section>
			</main>
		`;

		render(<ReaderStateEnhancer />);

		const button = await screen.findByRole("button", { name: "复制“处分流程”链接" });
		button.click();

		await expect(screen.findByRole("status")).resolves.toHaveTextContent("无法复制链接");
	});

	it("copies hash-only links for anchored headings without reader block ids", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText },
		});
		window.history.replaceState(null, "", "/docs/regulations/student_rules/rules?hl=old#old");
		document.body.innerHTML = `
			<main class="rspress-doc">
				<section>
					<span id="procedure"></span>
					<h2>处分流程</h2>
					<p>处分流程正文。</p>
				</section>
			</main>
		`;

		render(<ReaderStateEnhancer />);

		const button = await screen.findByRole("button", { name: "复制“处分流程”链接" });
		button.click();

		await waitFor(() => {
			expect(writeText).toHaveBeenCalledTimes(1);
		});
		const copiedUrl = new URL(writeText.mock.calls[0]?.[0] ?? "");
		expect(copiedUrl.pathname).toBe("/docs/regulations/student_rules/rules");
		expect(copiedUrl.search).toBe("");
		expect(copiedUrl.hash).toBe("#procedure");
	});

	it("closes the mobile docs sidebar after selecting a sidebar link", async () => {
		document.body.innerHTML = `
			<button class="rp-sidebar-menu__left" type="button">目录</button>
			<aside class="rp-doc-layout__sidebar rp-doc-layout__sidebar--open">
				<a href="#procedure">处分流程</a>
			</aside>
			<button class="rp-sidebar-menu__mask" type="button">关闭遮罩</button>
		`;
		const mask = document.querySelector<HTMLButtonElement>(".rp-sidebar-menu__mask");
		const maskClick = vi.spyOn(mask ?? document.createElement("button"), "click");

		render(<MobileSidebarGuard />);
		await waitFor(() => {
			expect(screen.getByRole("button", { name: "关闭文档目录" })).toHaveAttribute(
				"aria-expanded",
				"true",
			);
		});

		screen.getByRole("link", { name: "处分流程" }).click();

		expect(maskClick).toHaveBeenCalledTimes(1);
	});
});

function nextAnimationFrame(): Promise<void> {
	return new Promise((resolve) => {
		window.requestAnimationFrame(() => resolve());
	});
}
