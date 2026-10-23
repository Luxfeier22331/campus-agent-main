// @vitest-environment node

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main as verifyWorkerDeployConfig } from "../../../scripts/deploy/verify-worker-deploy-config.ts";

afterEach(() => vi.restoreAllMocks());

function writeConfig(payload: unknown) {
	const workDir = mkdtempSync(join(tmpdir(), "worker-deploy-config-"));
	const configPath = join(workDir, "wrangler.json");
	writeFileSync(configPath, JSON.stringify(payload), "utf8");
	return configPath;
}

describe("worker deploy config verifier", () => {
	it("requires ROUTE assertions to be custom domain routes", async () => {
		const configPath = writeConfig({
			routes: [{ pattern: "campus-staging.mucwiki-edge.link" }],
			services: [],
			vars: {},
		});

		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const status = await verifyWorkerDeployConfig([
			configPath,
			"ROUTE:campus-staging.mucwiki-edge.link",
		]);

		expect(status).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("custom domain route campus-staging.mucwiki-edge.link"),
		);
	});

	it("accepts ROUTE assertions for custom domain routes", async () => {
		const configPath = writeConfig({
			routes: [{ custom_domain: true, pattern: "campus-staging.mucwiki-edge.link" }],
			services: [],
			vars: {},
		});

		const status = await verifyWorkerDeployConfig([
			configPath,
			"ROUTE:campus-staging.mucwiki-edge.link",
		]);

		expect(status).toBe(0);
	});
});
