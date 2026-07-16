import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { saveSsoTgc } from "../src/auth-save.js";

describe("internal portal source collector auth save", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const directory of tempDirs.splice(0)) {
			fs.rmSync(directory, { force: true, recursive: true });
		}
	});

	it("writes only the captured TGC with restricted permissions", async () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "portal-auth-save-"));
		tempDirs.push(directory);
		const outputPath = path.join(directory, "auth", "sso_tgc");
		const result = await saveSsoTgc({
			authTimeoutMs: 1_000,
			captureSsoTgc: async () => "captured-ticket",
			logger: { log: () => undefined },
			outputPath,
			portalBaseUrl: "https://portal.example.edu",
			proxyServer: null,
		});

		expect(result).toEqual({ savedTo: outputPath });
		expect(fs.readFileSync(outputPath, "utf-8")).toBe("captured-ticket\n");
		expect(fs.statSync(outputPath).mode & 0o777).toBe(0o600);
	});

	it("does not create a credential file when browser authentication fails", async () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "portal-auth-failure-"));
		tempDirs.push(directory);
		const outputPath = path.join(directory, "sso_tgc");
		await expect(
			saveSsoTgc({
				authTimeoutMs: 1_000,
				captureSsoTgc: async () => {
					throw new Error("login timeout exceeded");
				},
				logger: { log: () => undefined },
				outputPath,
				portalBaseUrl: "https://portal.example.edu",
				proxyServer: null,
			}),
		).rejects.toThrow("login timeout exceeded");
		expect(fs.existsSync(outputPath)).toBe(false);
	});
});
