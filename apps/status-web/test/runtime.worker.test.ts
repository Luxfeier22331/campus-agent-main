import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { parseCampusHtmlWithHtmlRewriter } from "../src/status/probes";

describe("status worker runtime", () => {
	it("parses the Campus shell with the Worker HTMLRewriter", async () => {
		await expect(
			parseCampusHtmlWithHtmlRewriter(
				'<!doctype html><html><head><title>MUC Campus</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
			),
		).resolves.toEqual({
			moduleScriptSources: ["/src/main.tsx"],
			rootMountCount: 1,
			title: "MUC Campus",
		});
	});

	it("serves its liveness endpoint independently", async () => {
		const response = await SELF.fetch("https://status.muc.wiki/healthz");

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			app_name: "campus-agent-status-web",
			surface: "product-availability-status",
		});
	});

	it("serves the public status shell and keeps an empty snapshot as 204", async () => {
		const page = await SELF.fetch("https://status.muc.wiki/");
		expect(page.status).toBe(200);
		expect(page.headers.get("content-type")).toContain("text/html");
		const shell = await page.text();
		expect(shell).toContain("产品服务状态");
		expect(shell).toContain('id="theme-toggle"');
		expect(shell).toContain('data-theme-option="system"');
		expect(shell).toContain('value="dark"');
		expect(shell).not.toContain('id="refresh"');
		expect(shell).not.toContain('id="environment-label"');
		expect(shell).toContain('href="/go/campus/docs"');
		expect(shell).toContain('aria-current="page"');
		expect(shell).toContain('href="/favicon.ico"');
		expect(shell).toContain('src="/status-brand.png"');
		expect(shell).toContain('src="/status-page.js"');

		const favicon = await SELF.fetch("https://status.muc.wiki/favicon.ico");
		expect(favicon.status).toBe(200);
		expect(favicon.headers.get("content-type")).toContain("icon");
		const statusBrand = await SELF.fetch("https://status.muc.wiki/status-brand.png");
		expect(statusBrand.status).toBe(200);
		expect(statusBrand.headers.get("content-type")).toContain("image/png");

		const pageModule = await SELF.fetch("https://status.muc.wiki/status-page.js");
		expect(pageModule.status).toBe(200);
		expect(pageModule.headers.get("x-content-type-options")).toBe("nosniff");
		expect(pageModule.headers.get("content-type")).toContain("javascript");
		const pageScript = await pageModule.text();
		expect(pageScript).toContain('from "./status-model.js"');
		expect(pageScript).toContain('from "./status-page-controller.js"');

		const modelModule = await SELF.fetch("https://status.muc.wiki/status-model.js");
		expect(modelModule.status).toBe(200);
		const modelScript = await modelModule.text();
		expect(modelScript).toContain('id === "campus.qa"');
		expect(modelScript).toContain('id === "campus.services"');
		expect(modelScript).not.toContain("school.");

		const clientModule = await SELF.fetch("https://status.muc.wiki/status-client.js");
		expect(clientModule.status).toBe(200);
		const clientScript = await clientModule.text();
		expect(clientScript).toContain('id: "campus.qa", name: "校园问答"');
		expect(clientScript).toContain('id: "campus.services", name: "其他服务"');

		const rendererModule = await SELF.fetch("https://status.muc.wiki/status-renderer.js");
		expect(rendererModule.status).toBe(200);
		expect(await rendererModule.text()).toContain("过去 30 天");

		const status = await SELF.fetch("https://status.muc.wiki/api/status");
		expect(status.status).toBe(204);
		expect(status.headers.get("cache-control")).toBe("no-store");
		await expect(status.text()).resolves.toBe("");
	});

	it("serves the fixed campus navigation redirect", async () => {
		const response = await SELF.fetch("https://status.muc.wiki/go/campus/map", {
			redirect: "manual",
		});

		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe("https://campus.muc.wiki/map");
	});
});
