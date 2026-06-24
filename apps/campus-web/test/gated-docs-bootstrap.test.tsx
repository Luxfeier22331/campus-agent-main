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

		expect(await screen.findByRole("heading", { name: "请先登录" })).toBeInTheDocument();
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

		expect(await screen.findByRole("heading", { name: "文档目录暂不可用" })).toBeInTheDocument();
		expect(screen.getByText("请稍后重试。")).toBeInTheDocument();
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
		expect(screen.queryByText("中央民族大学学生考勤管理办法")).not.toBeInTheDocument();
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
		expect(fetchMock).toHaveBeenNthCalledWith(
			1,
			"/api/docs/collections/regulations/scoped_rules/documents/%E4%B8%AD%E5%A4%AE%E6%B0%91%E6%97%8F%E5%A4%A7%E5%AD%A6%E5%8F%97%E9%99%90%E5%88%B6%E5%BA%A6/resolve?anchor=restricted&hl=restricted-root",
			expect.any(Object),
		);
		expect(screen.getByText("这是一条受限正文。")).toBeInTheDocument();
	});
});

function installRuntimeConfig(): void {
	document.body.innerHTML = `<script id="${CAMPUS_RUNTIME_CONFIG_SCRIPT_ID}" type="application/json">{"accountUrl":"https://campus.muc.wiki/account","loginUrl":"https://campus.muc.wiki/account/login"}</script>`;
}
