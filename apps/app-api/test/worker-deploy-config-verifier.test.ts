// @vitest-environment node

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDir = resolve(fileURLToPath(import.meta.url), "..");
const repoRoot = resolve(testDir, "../../..");
const verifierScript = resolve(repoRoot, "scripts/deploy/verify-worker-deploy-config.ts");

function writeConfig(payload: unknown) {
	const workDir = mkdtempSync(join(tmpdir(), "worker-deploy-config-"));
	const configPath = join(workDir, "wrangler.json");
	writeFileSync(configPath, JSON.stringify(payload), "utf8");
	return configPath;
}

describe("worker deploy config verifier", () => {
	it("requires ROUTE assertions to be custom domain routes", () => {
		const configPath = writeConfig({
			routes: [{ pattern: "campus-staging.mucwiki-edge.link" }],
			services: [],
			vars: {},
		});

		const result = spawnSync(
			"pnpm",
			["exec", "tsx", verifierScript, configPath, "ROUTE:campus-staging.mucwiki-edge.link"],
			{ encoding: "utf8" },
		);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain("custom domain route campus-staging.mucwiki-edge.link");
	});

	it("accepts ROUTE assertions for custom domain routes", () => {
		const configPath = writeConfig({
			routes: [{ custom_domain: true, pattern: "campus-staging.mucwiki-edge.link" }],
			services: [],
			vars: {},
		});

		const result = spawnSync(
			"pnpm",
			["exec", "tsx", verifierScript, configPath, "ROUTE:campus-staging.mucwiki-edge.link"],
			{ encoding: "utf8" },
		);

		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
	});
});
