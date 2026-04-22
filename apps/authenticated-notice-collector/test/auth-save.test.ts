import { describe, expect, it } from "vitest";

import { saveAuthStorageState } from "../src/auth-save";

describe("authenticated notice collector auth save", () => {
	it("opens the portal page and persists storage state after confirmation", async () => {
		const calls: string[] = [];
		const result = await saveAuthStorageState({
			authStorageStatePath: "/tmp/collector-storage-state.json",
			authTimeoutMs: 1_000,
			confirmLogin: async () => {},
			launchBrowser: async () => ({
				close: async () => {
					calls.push("browser.close");
				},
				newContext: async () => ({
					newPage: async () => ({
						goto: async (url: string) => {
							calls.push(`page.goto:${url}`);
						},
					}),
					storageState: async (input: { path: string }) => {
						calls.push(`storageState:${input.path}`);
					},
				}),
			}),
			logger: {
				log: () => {},
			},
			portalPageUrl: "https://portal.example.edu/page/11#/",
		});

		expect(result).toEqual({
			savedTo: "/tmp/collector-storage-state.json",
		});
		expect(calls).toEqual([
			"page.goto:https://portal.example.edu/page/11#/",
			"storageState:/tmp/collector-storage-state.json",
			"browser.close",
		]);
	});

	it("still closes the browser when confirmation times out", async () => {
		let closed = false;

		await expect(
			saveAuthStorageState({
				authStorageStatePath: "/tmp/collector-storage-state.json",
				authTimeoutMs: 1_000,
				confirmLogin: async () => {
					throw new Error("login timeout exceeded");
				},
				launchBrowser: async () => ({
					close: async () => {
						closed = true;
					},
					newContext: async () => ({
						newPage: async () => ({
							goto: async () => {},
						}),
						storageState: async () => {},
					}),
				}),
				logger: {
					log: () => {},
				},
				portalPageUrl: "https://portal.example.edu/page/11#/",
			}),
		).rejects.toThrow("login timeout exceeded");

		expect(closed).toBe(true);
	});
});
