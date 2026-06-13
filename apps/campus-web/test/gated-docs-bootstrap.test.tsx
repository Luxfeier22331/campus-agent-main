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
		expect(loginHref.searchParams.get("return_to")).toBe(
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

	it("loads gated reader content after resolve and controlled asset fetch", async () => {
		window.history.replaceState(
			null,
			"",
			"/docs/regulations/scoped_rules/restricted-policy?hl=restricted-root#restricted",
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

		render(<GatedReaderBootstrap />);

		expect(await screen.findByRole("heading", { name: "受限制度" })).toBeInTheDocument();
		await waitFor(() => {
			expect(fetchMock).toHaveBeenCalledTimes(2);
		});
		expect(screen.getByText("这是一条受限正文。")).toBeInTheDocument();
	});
});

function installRuntimeConfig(): void {
	document.body.innerHTML = `<script id="${CAMPUS_RUNTIME_CONFIG_SCRIPT_ID}" type="application/json">{"accountUrl":"https://campus.muc.wiki/account","loginUrl":"https://campus.muc.wiki/account/login"}</script>`;
}
