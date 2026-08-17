import { describe, expect, it } from "vitest";
import { createOpsApp } from "../src/server/app";
import { createFixtureOpsStatusStore } from "../src/server/fixture-ops-status-store";
import { createAllowAllOpsAdmission } from "../src/server/ops-admission";

describe("ops app shell", () => {
	it("serves client routes without swallowing API or asset 404 responses", async () => {
		const app = createOpsApp({
			admission: createAllowAllOpsAdmission(),
			staticRoot: "test/fixtures/static",
			store: createFixtureOpsStatusStore(),
		});

		const root = await app.request("/");
		expect(root.status).toBe(200);
		expect(root.headers.get("content-type")).toContain("text/html");
		await expect(root.text()).resolves.toContain("ops-web shell");

		const clientRoute = await app.request("/requests/req_ops_001");
		expect(clientRoute.status).toBe(200);
		await expect(clientRoute.text()).resolves.toContain("ops-web shell");

		const apiRoute = await app.request("/api/ops/unknown");
		expect(apiRoute.status).toBe(404);
		expect(apiRoute.headers.get("content-type")).toContain("application/json");

		const missingAsset = await app.request("/favicon.ico");
		expect(missingAsset.status).toBe(404);
		expect(await missingAsset.text()).not.toContain("ops-web shell");
	});
});
