import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import GatedCollectionBootstrap from "../src/components/docs/gated-collection-bootstrap";
import GatedReaderBootstrap from "../src/components/docs/gated-reader-bootstrap";
import { CAMPUS_RUNTIME_CONFIG_SCRIPT_ID } from "../src/platform/runtime/config";

describe("gated docs bootstrap", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		document.body.innerHTML = "";
		window.history.replaceState(null, "", "/");
	});

	it("shows a login action when gated reader resolve requires authentication", async () => {
		installRuntimeConfig();
		window.history.replaceState(null, "", "/docs/regulations/scoped_rules/restricted-policy");
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ error: { code: "unauthorized", message: "请先登录。" } }), {
				headers: { "content-type": "application/json" },
				status: 401,
			}),
		);

		render(<GatedReaderBootstrap />);

		const state = await screen.findByRole("alert");
		expect(screen.getByRole("heading", { name: "请先登录" })).toBeInTheDocument();
		expect(state).toHaveTextContent("登录后会回到当前文档。");
		const loginHref = new URL(
			screen.getByRole("link", { name: "登录后继续" }).getAttribute("href") ?? "",
		);
		expect(`${loginHref.origin}${loginHref.pathname}`).toBe(
			"https://campus.muc.wiki/account/login",
		);
		expect(loginHref.searchParams.get("redirectTo")).toBe(
			"http://localhost:3000/docs/regulations/scoped_rules/restricted-policy",
		);
	});

	it("keeps denied gated reader responses closed without login recovery", async () => {
		window.history.replaceState(null, "", "/docs/regulations/scoped_rules/restricted-policy");
		vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 404 }));

		render(<GatedReaderBootstrap />);

		expect(await screen.findByRole("heading", { name: "无法打开文档" })).toBeInTheDocument();
		expect(screen.queryByRole("link", { name: "登录后继续" })).not.toBeInTheDocument();
	});

	it("shows service unavailable for transient gated collection failures", async () => {
		window.history.replaceState(null, "", "/docs/regulations/scoped_rules");
		vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 503 }));

		render(<GatedCollectionBootstrap />);

		const state = await screen.findByRole("alert");
		expect(screen.getByRole("heading", { name: "文档目录暂不可用" })).toBeInTheDocument();
		expect(state).toHaveTextContent("请稍后重试，或刷新当前页面。");
		expect(screen.getByRole("button", { name: "重新读取" })).toBeInTheDocument();
	});

	it("shows service unavailable for transient gated reader failures", async () => {
		window.history.replaceState(null, "", "/docs/regulations/scoped_rules/restricted-policy");
		vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 503 }));

		render(<GatedReaderBootstrap />);

		const state = await screen.findByRole("alert");
		expect(screen.getByRole("heading", { name: "文档暂不可用" })).toBeInTheDocument();
		expect(state).toHaveTextContent("请稍后重试，或刷新当前页面。");
		expect(screen.getByRole("button", { name: "重新读取" })).toBeInTheDocument();
	});

	it("fails closed when gated reader resolve returns an external asset URL", async () => {
		window.history.replaceState(null, "", "/docs/regulations/scoped_rules/restricted-policy");
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					document: {
						collection: "scoped_rules",
						corpus: "regulations",
						documentSlug: "restricted-policy",
						title: "受限制度",
					},
					readerAsset: {
						contentUrl: "https://object-store.example.edu/private/reader.json",
						deliveryMode: "gated_asset",
						outlineUrl:
							"/_gated-docs/regulations/scoped_rules/restricted-policy/2026-current/outline.json",
					},
					readerState: { anchor: null, highlightRootUnitIds: [] },
					resolvedVersion: { label: "现行版", versionSlug: "2026-current" },
				}),
				{ headers: { "content-type": "application/json" }, status: 200 },
			),
		);

		render(<GatedReaderBootstrap />);

		expect(await screen.findByRole("heading", { name: "文档暂不可用" })).toBeInTheDocument();
		await waitFor(() => {
			expect(fetchMock).toHaveBeenCalledTimes(1);
		});
		expect(fetchMock).not.toHaveBeenCalledWith(
			"https://object-store.example.edu/private/reader.json",
			expect.any(Object),
		);
	});

	it("renders gated collection document display titles without changing canonical titles", async () => {
		window.history.replaceState(null, "", "/docs/regulations/scoped_rules");
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					collection: {
						collection: "scoped_rules",
						corpus: "regulations",
						displayName: "专项规章",
					},
					nodes: [
						{
							canonicalUrl: "/docs/regulations/scoped_rules/student-attendance",
							displayTitle: "学生考勤管理办法",
							documentSlug: "student-attendance",
							isCurrent: true,
							kind: "document",
							title: "中央民族大学学生考勤管理办法",
						},
					],
				}),
				{ headers: { "content-type": "application/json" }, status: 200 },
			),
		);

		render(<GatedCollectionBootstrap />);

		expect(await screen.findByRole("heading", { name: "专项规章" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "学生考勤管理办法" })).toHaveAttribute(
			"href",
			"/docs/regulations/scoped_rules/student-attendance",
		);
		expect(screen.getByRole("link", { name: "学生考勤管理办法" })).toHaveClass(
			"gated-collection-link",
		);
		expect(screen.getByText("现行版")).toHaveClass("gated-collection-version");
		expect(screen.queryByText("中央民族大学学生考勤管理办法")).not.toBeInTheDocument();
	});

	it("renders a guided empty state for gated collections", async () => {
		window.history.replaceState(null, "", "/docs/regulations/scoped_rules");
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					collection: {
						collection: "scoped_rules",
						corpus: "regulations",
						displayName: "专项规章",
					},
					nodes: [],
				}),
				{ headers: { "content-type": "application/json" }, status: 200 },
			),
		);

		render(<GatedCollectionBootstrap />);

		const emptyState = await screen.findByText("当前账号下没有可阅读的文档。");
		expect(emptyState).toHaveClass("gated-collection-empty");
		expect(screen.getByRole("link", { name: "返回文档首页" })).toHaveAttribute("href", "/docs");
	});

	it("loads gated reader content after resolve and controlled asset fetch", async () => {
		window.history.replaceState(
			null,
			"",
			"/docs/regulations/scoped_rules/doc-a1b2c3d4e5f6?hl=restricted-root#restricted",
		);
		const fetchMock = vi.spyOn(globalThis, "fetch");
		fetchMock
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						document: { title: "受限制度" },
						readerAsset: {
							contentUrl:
								"/_gated-docs/regulations/scoped_rules/restricted-policy/2026-current/reader.json",
							deliveryMode: "gated_asset",
							outlineUrl:
								"/_gated-docs/regulations/scoped_rules/restricted-policy/2026-current/outline.json",
						},
						readerState: {
							anchor: "restricted",
							highlightRootUnitIds: ["restricted-root"],
						},
						resolvedVersion: { label: "现行版" },
					}),
					{ headers: { "content-type": "application/json" }, status: 200 },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						document: { title: "受限制度" },
						sections: [
							{
								anchor: "restricted",
								blocks: [
									{
										kind: "paragraph",
										rootUnitId: "restricted-root",
										text: "这是一条受限正文。",
									},
								],
								title: "受限章节",
							},
						],
					}),
					{ headers: { "content-type": "application/json" }, status: 200 },
				),
			);

		render(<GatedReaderBootstrap documentSlug="中央民族大学受限制度" />);

		expect(await screen.findByRole("heading", { name: "受限制度" })).toBeInTheDocument();
		await waitFor(() => {
			expect(fetchMock).toHaveBeenCalledTimes(2);
		});
		expect(document.querySelector("[data-docs-reader-meta]")).toHaveAttribute(
			"data-docs-search-visibility",
			"gated_bootstrap",
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			1,
			"/api/docs/collections/regulations/scoped_rules/documents/%E4%B8%AD%E5%A4%AE%E6%B0%91%E6%97%8F%E5%A4%A7%E5%AD%A6%E5%8F%97%E9%99%90%E5%88%B6%E5%BA%A6/resolve?anchor=restricted&hl=restricted-root",
			expect.any(Object),
		);
		expect(screen.getByText("这是一条受限正文。")).toBeInTheDocument();
	});

	it("ignores malformed location hashes when resolving gated reader routes", async () => {
		window.history.replaceState(
			null,
			"",
			"/docs/regulations/scoped_rules/restricted-policy#%E0%A4%A",
		);
		const fetchMock = vi.spyOn(globalThis, "fetch");
		fetchMock
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						document: {
							collection: "scoped_rules",
							corpus: "regulations",
							documentSlug: "restricted-policy",
							title: "受限制度",
						},
						readerAsset: {
							contentUrl:
								"/_gated-docs/regulations/scoped_rules/restricted-policy/2026-current/reader.json",
							deliveryMode: "gated_asset",
							outlineUrl:
								"/_gated-docs/regulations/scoped_rules/restricted-policy/2026-current/outline.json",
						},
						readerState: {
							anchor: null,
							highlightRootUnitIds: [],
						},
						resolvedVersion: { label: "现行版", versionSlug: "2026-current" },
					}),
					{ headers: { "content-type": "application/json" }, status: 200 },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						document: { title: "受限制度" },
						sections: [
							{
								anchor: "restricted",
								blocks: [
									{
										kind: "paragraph",
										rootUnitId: "restricted-root",
										text: "这是一条受限正文。",
									},
								],
								title: "受限章节",
							},
						],
					}),
					{ headers: { "content-type": "application/json" }, status: 200 },
				),
			);

		render(<GatedReaderBootstrap />);

		expect(await screen.findByRole("heading", { name: "受限制度" })).toBeInTheDocument();
		expect(fetchMock).toHaveBeenNthCalledWith(
			1,
			"/api/docs/collections/regulations/scoped_rules/documents/restricted-policy/resolve",
			expect.any(Object),
		);
		expect(screen.getByText("这是一条受限正文。")).toBeInTheDocument();
	});

	it("renders gated reader headings, safe tables, and public-safe metadata consistently", async () => {
		window.history.replaceState(null, "", "/docs/regulations/scoped_rules/restricted-policy");
		vi.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						document: {
							collection: "scoped_rules",
							corpus: "regulations",
							documentSlug: "restricted-policy",
							title: "受限制度",
						},
						readerAsset: {
							contentUrl:
								"/_gated-docs/regulations/scoped_rules/restricted-policy/2026-current/reader.json",
							deliveryMode: "gated_asset",
							outlineUrl:
								"/_gated-docs/regulations/scoped_rules/restricted-policy/2026-current/outline.json",
						},
						readerState: {
							anchor: null,
							highlightRootUnitIds: [],
						},
						resolvedVersion: {
							isCurrent: true,
							label: "现行版",
							versionId: "version_gated_internal",
							versionSlug: "2026-current",
						},
					}),
					{ headers: { "content-type": "application/json" }, status: 200 },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						document: { title: "受限制度" },
						sections: [
							{
								anchor: "restricted",
								blocks: [
									{
										kind: "heading",
										rootUnitId: "heading-root",
										text: "一、适用范围",
									},
									{
										kind: "paragraph",
										rootUnitId: "regular-enumeration",
										text: "一、这是一条普通正文，不应自动升级为标题。",
									},
									{
										kind: "paragraph",
										rootUnitId: "table-root",
										text: '<table><tr><td>事项</td><td colspan="2">要求</td></tr><tr><td>请假</td><td>提前申请</td><td>留痕</td></tr></table>',
									},
									{
										kind: "paragraph",
										rootUnitId: "unsafe-html",
										text: "<img src=x onerror=alert(1)>",
									},
								],
								title: "文档正文",
							},
						],
					}),
					{ headers: { "content-type": "application/json" }, status: 200 },
				),
			);

		render(<GatedReaderBootstrap />);

		expect(await screen.findByRole("heading", { name: "受限制度" })).toBeInTheDocument();
		expect(screen.getByRole("heading", { level: 2, name: "一、适用范围" })).toBeInTheDocument();
		expect(screen.getByText("一、这是一条普通正文，不应自动升级为标题。")).toBeInTheDocument();
		expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
		const tableContainer = document.querySelector(".docs-table-scroll");
		expect(tableContainer).toHaveAttribute("data-docs-scrollable", "true");
		expect(tableContainer?.querySelector("table")).toBeInTheDocument();
		expect(tableContainer?.querySelector("td[colspan='2']")?.textContent).toBe("要求");

		const metaPanel = document.querySelector("[data-docs-reader-meta]");
		expect(metaPanel).toHaveAttribute("data-docs-route-slug", "restricted-policy");
		expect(metaPanel).toHaveAttribute("data-docs-is-current", "true");
		expect(metaPanel).toHaveAttribute("data-docs-versions");
		expect(metaPanel).toHaveTextContent("现行版");
		expect(metaPanel).toHaveTextContent("登录后可见");
		expect(metaPanel).toHaveTextContent("来源：专项规章");
		expect(metaPanel).toHaveTextContent("来源详情");
		expect(metaPanel).toHaveTextContent("文档集合");
		expect(metaPanel).not.toHaveTextContent("version_gated_internal");
		expect(metaPanel?.outerHTML ?? "").not.toContain("versionId");
	});

	it("keeps unsupported gated reader table html as escaped text", async () => {
		window.history.replaceState(null, "", "/docs/regulations/scoped_rules/restricted-policy");
		vi.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						document: {
							collection: "scoped_rules",
							corpus: "regulations",
							documentSlug: "restricted-policy",
							title: "受限制度",
						},
						readerAsset: {
							contentUrl:
								"/_gated-docs/regulations/scoped_rules/restricted-policy/2026-current/reader.json",
							deliveryMode: "gated_asset",
							outlineUrl:
								"/_gated-docs/regulations/scoped_rules/restricted-policy/2026-current/outline.json",
						},
						readerState: { anchor: null, highlightRootUnitIds: [] },
						resolvedVersion: { label: "现行版", versionSlug: "2026-current" },
					}),
					{ headers: { "content-type": "application/json" }, status: 200 },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						document: { title: "受限制度" },
						sections: [
							{
								anchor: "restricted",
								blocks: [
									{
										kind: "paragraph",
										rootUnitId: "unsafe-table-attribute",
										text: '<table onclick="alert(1)"><tr><td>事项</td></tr></table>',
									},
									{
										kind: "paragraph",
										rootUnitId: "unsafe-table-tag",
										text: "<table><tr><td><script>alert(1)</script></td></tr></table>",
									},
								],
								title: "文档正文",
							},
						],
					}),
					{ headers: { "content-type": "application/json" }, status: 200 },
				),
			);

		render(<GatedReaderBootstrap />);

		expect(await screen.findByRole("heading", { name: "受限制度" })).toBeInTheDocument();
		expect(document.querySelector(".docs-table-scroll")).not.toBeInTheDocument();
		expect(
			screen.getByText('<table onclick="alert(1)"><tr><td>事项</td></tr></table>'),
		).toBeInTheDocument();
		expect(
			screen.getByText("<table><tr><td><script>alert(1)</script></td></tr></table>"),
		).toBeInTheDocument();
		expect(document.querySelector("script")).not.toBeInTheDocument();
	});
});

function installRuntimeConfig(): void {
	document.body.innerHTML = `<script id="${CAMPUS_RUNTIME_CONFIG_SCRIPT_ID}" type="application/json">{"accountUrl":"https://campus.muc.wiki/account","loginUrl":"https://campus.muc.wiki/account/login"}</script>`;
}
