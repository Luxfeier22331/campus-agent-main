import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sanitizePreservedHtmlForMdx } from "../scripts/sync-real-docs/html-table";
import { buildMobileTableRowPairs } from "../src/components/DocsContentEnhancer";
import { buildLocalSearchFallbackResults } from "../src/search/local-search-fallback-core";

describe("public-docs reader UI contracts", () => {
	it("normalizes preserved HTML tables for MDX and React", () => {
		const html =
			'<table><tr><td rowspan="2">类别</td><td colspan="2">评分标准</td></tr><tr><td>第一名</td><td>{备注} *重点*</td></tr></table>';

		const sanitized = sanitizePreservedHtmlForMdx(html);

		expect(sanitized).toBe(
			'<div className="docs-table-scroll" role="region" aria-label="可横向滚动的文档表格" tabIndex={0}><table><tbody><tr><td rowSpan={2}>类别</td><td colSpan={2}>评分标准</td></tr><tr><td>第一名</td><td>&#123;备注&#125; &#42;重点&#42;</td></tr></tbody></table></div>',
		);
		expect(sanitized).not.toContain("rowspan=");
		expect(sanitized).not.toContain("colspan=");
		expect(sanitized).not.toContain("<table><tr>");
		expect(sanitized).toContain('className="docs-table-scroll"');
	});

	it("styles generated and markdown tables through scroll containers", () => {
		const css = readFileSync(join(process.cwd(), "theme/docs-ui.css"), "utf8");
		const theme = readFileSync(join(process.cwd(), "theme/index.tsx"), "utf8");

		expect(css).toContain(".rspress-doc .docs-table-scroll");
		expect(css).toContain(".rspress-doc .rp-table-scroll-container");
		expect(css).toContain(".rspress-doc.docs-reader-layout-reference");
		expect(css).toContain(".rspress-doc.docs-reader-layout-tabular");
		expect(css).toContain(".rspress-doc.docs-reader-layout-graph");
		expect(css).toContain(".rspress-doc.docs-reader-measure-standard");
		expect(css).toContain(".rspress-doc.docs-reader-measure-wide");
		expect(css).toContain(".rspress-doc.docs-reader-measure-full");
		expect(css).toContain("--docs-reader-page-max-standard: 68rem;");
		expect(css).toContain("--docs-reader-page-max-wide: 76rem;");
		expect(css).toContain("--docs-reader-page-max-full: 88rem;");
		expect(css).toContain("--docs-prose-measure: 64rem;");
		expect(css).toContain("max-width: min(100%, var(--docs-reader-page-max));");
		expect(css).toContain(".rspress-doc :where(p, blockquote)");
		expect(css).toContain("max-width: var(--docs-prose-measure);");
		expect(css).toContain(
			".rspress-doc :where(.docs-table-scroll, .rp-table-scroll-container, .handbook-flow-shell)",
		);
		expect(css).not.toContain("docs-reader-normal");
		expect(css).not.toContain("docs-reader-wide");
		expect(css).not.toContain("--docs-reader-manual-measure");
		expect(css).not.toContain("--docs-reader-curriculum-measure");
		expect(css).toContain("grid-template-columns: minmax(0, 1fr) minmax(18rem, 0.72fr);");
		expect(css).toContain("grid-template-columns: minmax(5.5rem, 8rem) minmax(0, 1fr);");
		expect(css).toContain("--docs-sidebar-width: 17rem;");
		expect(css).toContain("--docs-sidebar-width: 16.5rem;");
		expect(css).toContain("--docs-sidebar-outer-gutter: 16px;");
		expect(css).toContain("--docs-sidebar-gutter: 12px;");
		expect(css).toContain("--docs-reader-padding-left: calc(var(--docs-reader-padding) + 0.5rem);");
		expect(css).toContain("--docs-reader-padding-right: var(--docs-reader-padding);");
		expect(css).toContain(
			"--docs-reader-collapsed-padding-left: calc(var(--docs-reader-padding-left) + 1rem);",
		);
		expect(css).toContain("--docs-table-header-bg: var(--docs-surface-soft);");
		expect(css).toContain(
			"--docs-table-section-bg: color-mix(in srgb, var(--rp-c-text-1) 3%, var(--rp-c-bg, #ffffff));",
		);
		expect(css).toContain("--docs-table-sticky-bg: var(--docs-surface);");
		expect(css).toContain("--docs-table-hint-bg: var(--docs-surface-soft);");
		expect(css).not.toContain("--docs-table-header-bg: color-mix(in srgb, var(--docs-accent)");
		expect(css).not.toContain("--docs-table-section-bg: color-mix(in srgb, var(--docs-accent)");
		expect(css).toContain("--docs-outline-width: 9.75rem;");
		expect(css).toContain("--docs-outline-gutter: 24px;");
		expect(css).toContain("--docs-outline-gutter: 32px;");
		expect(css).toContain("--rp-sidebar-margin-left: var(--docs-sidebar-gutter);");
		expect(css).toContain("--rp-outline-width: var(--docs-outline-width);");
		expect(css).toContain("--rp-outline-margin-right: var(--docs-outline-gutter);");
		expect(css).toContain("width: var(--docs-outline-width);");
		expect(css).toContain("margin-right: var(--docs-outline-gutter);");
		expect(css).not.toContain("position: fixed !important;");
		expect(css).not.toContain("right: max(16px, env(safe-area-inset-right)) !important;");
		expect(css).not.toContain("height: calc(100dvh - var(--rp-nav-height, 64px)) !important;");
		expect(css).toContain(".rp-doc-layout__sidebar .rp-sidebar-item__left");
		expect(css).toContain('.rp-doc-layout__sidebar .rp-sidebar-item[data-depth="1"]');
		expect(css).toContain("--docs-sidebar-item-indent: 0.75rem;");
		expect(css).toContain('.rp-doc-layout__sidebar .rp-sidebar-item[data-depth="2"]');
		expect(css).toContain("--docs-sidebar-item-indent: 1.25rem;");
		expect(css).toContain("padding-left: var(--docs-sidebar-item-indent, 0.25rem);");
		expect(css).toContain("-webkit-line-clamp: 2;");
		expect(css).toContain(".rp-doc-layout__sidebar .rp-sidebar-item--group-item::before");
		expect(css).toContain("body .rp-search-button--mobile");
		expect(css).toContain("body .rp-nav-hamburger__sm");
		expect(css).toContain("body:has(.rp-doc-layout__sidebar--open) .rp-sidebar-menu__left::after");
		expect(css).toContain('content: "关闭目录";');
		expect(css).toContain("position: fixed;");
		expect(css).toContain("z-index: 70;");
		expect(css).toContain(".rp-doc-layout__menu {\n\t\tmin-height: 46px;");
		expect(css).toContain(".rspress-doc .docs-table-scroll table");
		expect(css).toContain(".rspress-doc .docs-table-mobile-cards");
		expect(css).toContain(".rspress-doc .docs-table-mobile-raw");
		expect(css).toContain("max-width: 100%;\n\t\tmin-width: 0;\n\t\toverflow-x: auto;");
		expect(css).toContain('.docs-table-scroll[data-docs-enhanced-table="true"]');
		expect(css).toContain('.docs-table-scroll[data-docs-scrollable="false"]::before');
		expect(css).toContain(".rspress-doc table thead th");
		expect(css).toContain("background: var(--docs-table-sticky-bg);");
		expect(css).toContain("background: var(--docs-table-hint-bg);");
		expect(css).toContain("main.rp-doc-layout__doc-container {\n\tbox-sizing: border-box;");
		expect(css).toContain(".rp-doc-layout__container .rp-doc-layout__doc {\n\t\tflex: 1 1 auto;");
		expect(css).toContain("max-width: none;");
		expect(css).toContain("width: 100%;\n\t\tmin-width: 0;");
		expect(css).toContain("padding-right: var(--docs-reader-padding-right);");
		expect(css).toContain("padding-left: var(--docs-reader-padding-left);");
		expect(css).toContain(".rspress-doc {\n\twidth: 100%;\n\tmin-width: 0;");
		expect(css).toContain("padding-right: 1.25rem;");
		expect(css).toContain("font-size: 0.82rem;");
		expect(css).toContain("min-width: 7.25rem;");
		expect(css).not.toContain(".rspress-doc table {\n\tdisplay: block;");
		expect(css).not.toContain(".rspress-doc table {\n\twidth: max-content;");
		expect(css).toContain('content: "横向滑动查看更多列"');
		expect(css).toContain("--docs-sidebar-width: 18rem;");
		expect(css).toContain("@media (min-width: 1600px)");
		expect(css).toContain("@media (min-width: 1280px)");
		expect(css).toContain(".rp-doc-layout__container .rp-doc-layout__sidebar-placeholder");
		expect(css).toContain("margin-left: var(--docs-sidebar-outer-gutter);");
		expect(css).toContain("@media (min-width: 1100px) and (max-width: 1599px)");
		expect(css).toContain("@media (min-width: 900px) and (max-width: 1099px)");
		expect(css).toContain("@media (max-width: 899px)");
		expect(css).toContain("--docs-sidebar-item-indent: 0.85rem;");
		expect(css).toContain("--docs-sidebar-item-indent: 1.45rem;");
		expect(css).toContain("--docs-sidebar-item-indent: 1.9rem;");
		expect(theme).toContain("Layout as OriginalLayout");
		expect(theme).toContain("resolveReaderLayoutClasses");
		expect(theme).toContain("readerLayout");
		expect(theme).toContain("readerMeasure");
		expect(theme).toContain("docs-reader-layout-reference");
		expect(theme).toContain("docs-reader-measure-wide");
		expect(theme).not.toContain("readerProfile");
		expect(theme).not.toContain("docs-reader-normal");
		expect(theme).not.toContain("function DocsDocLayout");
		expect(theme).not.toContain("data-reader-profile");
		expect(theme).not.toContain("DocsDocLayout");
		expect(theme).not.toContain("useFlushSidebarIndent();");
		expect(theme).not.toContain("MutationObserver");
	});

	it("wires a mobile sidebar close guard for the Rspress menu affordance", () => {
		const config = readFileSync(join(process.cwd(), "rspress.config.ts"), "utf8");
		const guard = readFileSync(
			join(process.cwd(), "src/components/MobileSidebarGuard.tsx"),
			"utf8",
		);

		expect(config).toContain("MobileSidebarGuard.tsx");
		expect(config).toContain("DocsContentEnhancer.tsx");
		expect(guard).toContain(".rp-sidebar-menu__left");
		expect(guard).toContain(".rp-sidebar-menu__mask");
		expect(guard).toContain("stopImmediatePropagation");
		expect(guard).toContain('event.key !== "Escape"');
		expect(guard).toContain("mask.click()");
	});

	it("normalizes Rspress runtime affordances for accessibility", () => {
		const enhancer = readFileSync(
			join(process.cwd(), "src/components/DocsContentEnhancer.tsx"),
			"utf8",
		);
		const searchGuard = readFileSync(
			join(process.cwd(), "src/components/SearchKeyboardGuard.tsx"),
			"utf8",
		);

		expect(enhancer).toContain(".rspress-doc a.rp-header-anchor");
		expect(enhancer).toContain("anchor.tabIndex = -1;");
		expect(enhancer).toContain('anchor.textContent = "";');
		expect(searchGuard).toContain("enhanceSearchInputAccessibility");
		expect(searchGuard).toContain('input.id = "public-docs-search-input";');
		expect(searchGuard).toContain('input.name = "public-docs-search";');
		expect(searchGuard).toContain('input.setAttribute("aria-label", "搜索公开文档");');
	});

	it("does not expose unnamed table columns in mobile card projections", () => {
		const pairs = buildMobileTableRowPairs(
			["课程类", "课程号", "课程名称", "学分", "学时", "实践学时", "开设学期", "备注"],
			[
				"跨学科交叉课程",
				"1034040252",
				"数字孪生技术",
				"2",
				"36",
				"9",
				"6",
				"建议拟继续深造学生选修",
				"学生可选择此部分课程，也可选择其他专业课程。",
			],
		);

		expect(pairs).toContainEqual({
			header: "补充说明",
			value: "学生可选择此部分课程，也可选择其他专业课程。",
		});
		expect(pairs.map((pair) => pair.header)).not.toContain("第 9 列");
	});

	it("wires a desktop control that collapses the whole native sidebar shell", () => {
		const config = readFileSync(join(process.cwd(), "rspress.config.ts"), "utf8");
		const component = readFileSync(
			join(process.cwd(), "src/components/DesktopSidebarCollapseToggle.tsx"),
			"utf8",
		);
		const css = readFileSync(join(process.cwd(), "theme/docs-ui.css"), "utf8");

		expect(config).toContain("DesktopSidebarCollapseToggle.tsx");
		expect(component).toContain('const STORAGE_KEY = "public-docs:sidebar-collapsed:v1";');
		expect(component).toContain("document.documentElement.setAttribute(");
		expect(component).toContain('"data-docs-sidebar"');
		expect(component).toContain("document.documentElement.removeAttribute(");
		expect(component).toContain('sidebar.setAttribute("aria-hidden", "true");');
		expect(component).toContain('sidebar.setAttribute("inert", "");');
		expect(component).toContain('window.matchMedia("(min-width: 900px)")');
		expect(component).toContain("aria-pressed={collapsed}");
		expect(component).toContain("收起目录");
		expect(component).toContain("展开目录");
		expect(css).toContain(".docs-sidebar-collapse-toggle");
		expect(css).toContain("--docs-sidebar-motion-duration: 190ms;");
		expect(css).toContain("--docs-sidebar-motion-easing: cubic-bezier(0.2, 0, 0, 1);");
		expect(css).toContain('html[data-docs-sidebar="collapsed"]');
		expect(css).toContain(".rp-doc-layout__container .rp-doc-layout__sidebar-placeholder");
		expect(css).toContain(
			"transition:\n\t\t\twidth var(--docs-sidebar-motion-duration) var(--docs-sidebar-motion-easing),",
		);
		expect(css).toContain(
			"transition:\n\t\t\tpadding-left var(--docs-sidebar-motion-duration) var(--docs-sidebar-motion-easing);",
		);
		expect(css).toContain(
			"transform: translateX(calc(-1 * (var(--docs-sidebar-width) + var(--docs-sidebar-outer-gutter))));",
		);
		expect(css).toContain("width: 0;");
		expect(css).toContain("max-width: 0;");
		expect(css).toContain("border-right: 0;");
		expect(css).toContain("visibility: hidden;");
		expect(css).toContain("pointer-events: none;");
		expect(css).toContain("@media (prefers-reduced-motion: reduce)");
		expect(css).toContain("transition-duration: 0.01ms !important;");
		expect(css).toContain(
			"html[data-docs-sidebar=\"collapsed\"] main.rp-doc-layout__doc-container",
		);
		expect(css).toContain("padding-left: var(--docs-reader-collapsed-padding-left);");
		expect(css).not.toContain("--rp-sidebar-width: 0px;");
		expect(css).not.toContain("--rp-sidebar-margin-left: 0px;");
		expect(css).not.toContain("--docs-sidebar-outer-gutter: 0px;");
		expect(css).not.toContain("function DocsDocLayout");
		expect(css).not.toContain("data-reader-profile");
	});

	it("renders document technical metadata as a fixed low-distraction popover", () => {
		const css = readFileSync(join(process.cwd(), "theme/docs-ui.css"), "utf8");

		expect(css).toContain(".rspress-doc .document-meta-summary");
		expect(css).toContain(".rspress-doc .document-meta-details dl");
		expect(css).toContain(".rspress-doc .document-meta-details summary");
		expect(css).toContain(".rspress-doc .document-meta-panel + h2");
		expect(css).toContain("margin-top: 2rem;");
		expect(css).toContain("margin-top: 1.75rem;");
		expect(css).toContain("position: fixed;");
		expect(css).toContain("bottom: 2rem;");
		expect(css).toContain("bottom: max(1rem, env(safe-area-inset-bottom));");
		expect(css).toContain("box-shadow: 0 18px 40px rgba(28, 45, 37, 0.14);");
		expect(css).not.toContain("flex-basis: 100%;");
	});

	it("builds fallback local search suggestions from the generated search index shape", () => {
		const results = buildLocalSearchFallbackResults("奖学金", [
			{
				title: "中央民族大学本科学生国家奖学金评审办法",
				routePath: "/student-handbook/scholarship/national-scholarship-evaluation",
				content: "第一条 为规范国家奖学金评审工作。",
				toc: [{ id: "第一条", text: "第一条", charIndex: 0 }],
			},
		]);

		expect(results[0]).toMatchObject({
			type: "title",
			title: "中央民族大学本科学生国家奖学金评审办法",
			link: "/student-handbook/scholarship/national-scholarship-evaluation",
			query: "奖学金",
		});
	});

	it("falls back to section and content matches when titles do not match", () => {
		const results = buildLocalSearchFallbackResults("毕业要求", [
			{
				title: "计算机类本科人才培养方案",
				routePath: "/curriculum-plan/undergraduate/计算机类本科人才培养方案",
				content: "二、毕业要求\n\n软件工程专业毕业要求包括知识、能力和素质要求。",
				toc: [{ id: "二毕业要求", text: "二、毕业要求", charIndex: 0 }],
			},
		]);

		expect(results.map((result) => result.type)).toEqual(["header", "content"]);
		expect(results[0]).toMatchObject({
			header: "计算机类本科人才培养方案 > 二、毕业要求",
			link: "/curriculum-plan/undergraduate/计算机类本科人才培养方案#二毕业要求",
		});
	});
});
