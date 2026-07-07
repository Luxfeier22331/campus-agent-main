import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runAuthPortalCrawler } from "../src/auth-crawlee-runner.js";

describe("internal portal auth Crawlee runner", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const tempDir of tempDirs.splice(0)) {
			fs.rmSync(tempDir, { force: true, recursive: true });
		}
	});

	it("stores authenticated browser state with owner-only permissions", async () => {
		const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-auth-state-"));
		tempDirs.push(runtimeDir);
		const storageStatePath = path.join(runtimeDir, "auth", "storageState.json");

		await runAuthPortalCrawler({
			headless: true,
			portalPageUrl: "https://portal.example.edu/page/11#/",
			proxyServer: null,
			storageStatePath,
			timeoutMs: 1_000,
			crawlerFactory: ({ requestHandler }) => ({
				async run(requests) {
					expect(requests).toHaveLength(1);
					await requestHandler({
						page: {
							context: () => ({
								storageState: async (options = {}) => {
									const outputPath = requiredPath(options.path);
									fs.writeFileSync(
										outputPath,
										JSON.stringify({ cookies: [], origins: [] }),
										"utf-8",
									);
									return { cookies: [], origins: [] };
								},
							}),
							goto: async () => undefined,
						},
					});
				},
			}),
		});

		expect(fileMode(path.dirname(storageStatePath))).toBe(0o700);
		expect(fileMode(storageStatePath)).toBe(0o600);
	});
});

function fileMode(filePath: string): number {
	return fs.statSync(filePath).mode & 0o777;
}

function requiredPath(value: string | undefined): string {
	if (!value) {
		throw new Error("storage state path is required");
	}
	return value;
}
