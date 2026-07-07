import { describe, expect, it } from "vitest";

import { saveAuthStorageState } from "../src/auth-save.js";

describe("internal portal source collector auth save", () => {
	it("opens the portal page and persists storage state after confirmation", async () => {
		const calls: string[] = [];
		const result = await saveAuthStorageState({
			authStorageStatePath: "/tmp/collector-storage-state.json",
			authTimeoutMs: 1_000,
			confirmLogin: async () => undefined,
			logger: {
				log: () => undefined,
			},
			portalPageUrl: "https://portal.example.edu/page/11#/",
			proxyServer: "http://127.0.0.1:7890",
			runAuthPortalCrawler: async (input) => {
				calls.push(`crawler.goto:${input.portalPageUrl}`);
				calls.push(`crawler.proxy:${input.proxyServer ?? "none"}`);
				await input.confirmLogin();
				calls.push(`storageState:${input.storageStatePath}`);
			},
		});

		expect(result).toEqual({
			savedTo: "/tmp/collector-storage-state.json",
		});
		expect(calls).toEqual([
			"crawler.goto:https://portal.example.edu/page/11#/",
			"crawler.proxy:http://127.0.0.1:7890",
			"storageState:/tmp/collector-storage-state.json",
		]);
	});

	it("surfaces crawler bootstrap failures when confirmation times out", async () => {
		await expect(
			saveAuthStorageState({
				authStorageStatePath: "/tmp/collector-storage-state.json",
				authTimeoutMs: 1_000,
				confirmLogin: async () => {
					throw new Error("login timeout exceeded");
				},
				logger: {
					log: () => undefined,
				},
				portalPageUrl: "https://portal.example.edu/page/11#/",
				proxyServer: null,
				runAuthPortalCrawler: async (input) => {
					await input.confirmLogin();
				},
			}),
		).rejects.toThrow("login timeout exceeded");
	});
});
