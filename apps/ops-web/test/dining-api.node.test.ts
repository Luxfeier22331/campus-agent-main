// @vitest-environment node

import type { DiningMapDraft } from "@campus-agent/dining/domain";
import { DINING_BOOTSTRAP_FLOORPLANS } from "@campus-agent/dining/floorplans";
import { diningMapBundleFingerprint } from "@campus-agent/dining/publisher";
import { describe, expect, it, vi } from "vitest";
import { createUnavailableDiningStore } from "../src/server/dining-store";
import type { DiningMapStore } from "../src/server/dining-store-contract";
import { DiningStoreConflictError } from "../src/server/dining-store-errors";
import { createFixtureOpsStatusStore } from "../src/server/fixture-ops-status-store";
import { createAllowAllOpsAdmission } from "../src/server/ops-admission";
import { createTestOpsApp } from "./helpers/ops-app";

const NOW = "2026-07-24T08:00:00.000Z";

function createDraft(): DiningMapDraft {
	return {
		bundle: DINING_BOOTSTRAP_FLOORPLANS,
		fingerprint: diningMapBundleFingerprint(DINING_BOOTSTRAP_FLOORPLANS),
		revision: 1,
		updatedAt: NOW,
		updatedBy: "bootstrap",
	};
}

function createDiningStore(): DiningMapStore {
	const draft = createDraft();
	const release = {
		createdAt: NOW,
		createdBy: "ops@example.test",
		draftRevision: 1,
		kind: "publish" as const,
		releaseId: "release-1",
		restoredFromReleaseId: null,
		snapshotHash: draft.fingerprint,
	};
	return {
		getState: vi.fn(async () => ({ currentRelease: release, draft })),
		listReleases: vi.fn(async () => ({ currentReleaseId: release.releaseId, releases: [release] })),
		publish: vi.fn(async () => release),
		restore: vi.fn(async () => ({ draft, release })),
		saveDraft: vi.fn(async () => draft),
		verifyReadiness: vi.fn(async () => undefined),
	};
}

function createTestApp(diningStore: DiningMapStore) {
	return createTestOpsApp({
		admission: createAllowAllOpsAdmission(),
		diningMapStore: diningStore,
		env: {
			ACCESS_POLICY_AUD: "ops-web-test-audience",
			ACCESS_TEAM_DOMAIN: "https://team-ops-web.cloudflareaccess.com",
			OPS_WEB_AUTOMATION_ORIGIN: "https://ops-api.example.test",
			OPS_WEB_PUBLIC_ORIGIN: "https://ops.example.test",
		},
		store: createFixtureOpsStatusStore(),
	});
}

describe("Ops Web Dining API", () => {
	it("keeps core readiness independent from Dining storage", async () => {
		const diningStore = createDiningStore();
		vi.mocked(diningStore.verifyReadiness).mockRejectedValue(new Error("dining unavailable"));
		const response = await createTestApp(diningStore).request("/readyz");

		expect(response.status).toBe(200);
		expect(diningStore.verifyReadiness).not.toHaveBeenCalled();
	});

	it("returns the complete map draft without accepting query variants", async () => {
		const diningStore = createDiningStore();
		const app = createTestApp(diningStore);

		const response = await app.request("/api/ops/dining");
		const invalid = await app.request("/api/ops/dining?preview=1");

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ draft: { revision: 1 } });
		expect(invalid.status).toBe(400);
	});

	it("saves one complete bundle with revision and same-origin checks", async () => {
		const diningStore = createDiningStore();
		const app = createTestApp(diningStore);
		const body = JSON.stringify({
			bundle: DINING_BOOTSTRAP_FLOORPLANS,
			expectedRevision: 1,
		});

		const rejected = await app.request("/api/ops/dining/draft", {
			body,
			headers: { "content-type": "application/json", origin: "https://other.example.test" },
			method: "PUT",
		});
		const saved = await app.request("/api/ops/dining/draft", {
			body,
			headers: { "content-type": "application/json", origin: "https://ops.example.test" },
			method: "PUT",
		});

		expect(rejected.status).toBe(403);
		expect(saved.status).toBe(200);
		expect(diningStore.saveDraft).toHaveBeenCalledWith(
			expect.objectContaining({ principalId: "ops@example.test" }),
			DINING_BOOTSTRAP_FLOORPLANS,
			1,
		);
	});

	it("publishes, lists, and restores immutable releases", async () => {
		const diningStore = createDiningStore();
		const app = createTestApp(diningStore);
		const headers = { "content-type": "application/json", origin: "https://ops.example.test" };

		const published = await app.request("/api/ops/dining/publish", {
			body: JSON.stringify({ expectedRevision: 1 }),
			headers,
			method: "POST",
		});
		const listed = await app.request("/api/ops/dining/releases");
		const restored = await app.request("/api/ops/dining/releases/release-1/restore", {
			body: JSON.stringify({ expectedRevision: 1 }),
			headers,
			method: "POST",
		});

		expect(published.status).toBe(200);
		expect(listed.status).toBe(200);
		expect(restored.status).toBe(200);
		expect(diningStore.publish).toHaveBeenCalledOnce();
		expect(diningStore.restore).toHaveBeenCalledWith(
			expect.objectContaining({ principalId: "ops@example.test" }),
			"release-1",
			1,
		);
	});

	it("maps draft conflicts to HTTP 409", async () => {
		const diningStore = createDiningStore();
		vi.mocked(diningStore.saveDraft).mockRejectedValue(
			new DiningStoreConflictError("地图草稿已更新，请刷新后重试。"),
		);
		const response = await createTestApp(diningStore).request("/api/ops/dining/draft", {
			body: JSON.stringify({ bundle: DINING_BOOTSTRAP_FLOORPLANS, expectedRevision: 1 }),
			headers: { "content-type": "application/json", origin: "https://ops.example.test" },
			method: "PUT",
		});

		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({ error: { code: "OPS_DINING_CONFLICT" } });
	});

	it("logs a stable error code when the Dining store is unavailable", async () => {
		const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
		try {
			const app = createTestOpsApp({
				admission: createAllowAllOpsAdmission(),
				diningMapStore: createUnavailableDiningStore(new Error("dining unavailable")),
				env: {
					OPS_WEB_AUTOMATION_ORIGIN: "https://ops-api.example.test",
					OPS_WEB_PUBLIC_ORIGIN: "https://ops.example.test",
				},
				store: createFixtureOpsStatusStore(),
			});
			const response = await app.request("/api/ops/dining/reviews?q=query-secret", {
				headers: { "x-request-id": "req_ops_log_001" },
			});

			expect(response.status).toBe(503);
			const event = errorLog.mock.calls
				.map(([entry]) => String(entry))
				.find((entry) => entry.includes('"event_type":"ops_web.api_request"'));
			expect(event).toBeDefined();
			expect(JSON.parse(event ?? "{}")).toEqual({
				error_code: "OPS_DINING_STORE_UNAVAILABLE",
				event_type: "ops_web.api_request",
				failure_kind: "dining_store_unavailable",
				http_method: "GET",
				http_status_class: "5xx",
				level: "error",
				request_id: "req_ops_log_001",
				route_template: "/api/ops/dining/reviews",
				source: "http",
				status: "failed",
			});
			expect(event).not.toContain("dining unavailable");
			expect(event).not.toContain("query-secret");
		} finally {
			errorLog.mockRestore();
		}
	});
});
