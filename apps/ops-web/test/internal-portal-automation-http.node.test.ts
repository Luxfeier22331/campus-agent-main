// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import {
	AUTOMATION_FIXTURE_CREDENTIAL_ID,
	AUTOMATION_FIXTURE_TGC_NETWORK_FAILURE,
	AUTOMATION_FIXTURE_TGC_REFRESH,
	AUTOMATION_FIXTURE_TGC_REFRESHED,
	AUTOMATION_FIXTURE_TGC_REJECTED,
	AUTOMATION_FIXTURE_TGC_TIMEOUT,
	AUTOMATION_FIXTURE_TGC_VALID,
	AUTOMATION_FIXTURE_TOKEN,
	type InternalPortalAutomationFixture,
	startInternalPortalAutomationFixture,
} from "./fixtures/internal-portal-automation-server.ts";

let fixture: InternalPortalAutomationFixture | null = null;

afterEach(async () => {
	await fixture?.close();
	fixture = null;
});

function credentialUrl(origin: string): string {
	return `${origin}/api/automation/internal-portal/credentials/${AUTOMATION_FIXTURE_CREDENTIAL_ID}`;
}

function headers(version?: number): Record<string, string> {
	return {
		authorization: `Bearer ${AUTOMATION_FIXTURE_TOKEN}`,
		...(version === undefined
			? {}
			: { "content-type": "application/json", "if-match": `"${version}"` }),
	};
}

async function rotate(origin: string, ssoTgc: string, version: number): Promise<Response> {
	return await fetch(credentialUrl(origin), {
		body: JSON.stringify({ ssoTgc }),
		headers: headers(version),
		method: "PUT",
	});
}

describe("internal portal automation HTTP fixture", () => {
	it("rotates through the real HTTP, validation and CAS path", async () => {
		vi.unstubAllGlobals();
		fixture = await startInternalPortalAutomationFixture();
		const detail = await fetch(credentialUrl(fixture.origin), { headers: headers() });

		expect(detail.status).toBe(200);
		expect(detail.headers.get("etag")).toBe('"1"');

		const updated = await rotate(fixture.origin, AUTOMATION_FIXTURE_TGC_REFRESH, 1);

		expect(updated.status).toBe(200);
		expect(updated.headers.get("etag")).toBe('"2"');
		await expect(updated.json()).resolves.toMatchObject({ credential: { version: 2 } });
		expect(fixture.readCredential()).toMatchObject({
			ssoTgc: AUTOMATION_FIXTURE_TGC_REFRESHED,
			version: 2,
		});
	});

	it("keeps the current value across rejection, dependency failure and stale writes", async () => {
		vi.unstubAllGlobals();
		fixture = await startInternalPortalAutomationFixture();
		expect((await rotate(fixture.origin, AUTOMATION_FIXTURE_TGC_REFRESH, 1)).status).toBe(200);
		const expected = fixture.readCredential();

		for (const [candidate, status, code] of [
			[AUTOMATION_FIXTURE_TGC_REJECTED, 422, "OPS_INTERNAL_PORTAL_CREDENTIAL_REJECTED"],
			[AUTOMATION_FIXTURE_TGC_TIMEOUT, 503, "OPS_INTERNAL_PORTAL_CHECK_FAILED"],
			[AUTOMATION_FIXTURE_TGC_NETWORK_FAILURE, 503, "OPS_INTERNAL_PORTAL_CHECK_FAILED"],
		] as const) {
			const response = await rotate(fixture.origin, candidate, 2);
			expect(response.status).toBe(status);
			await expect(response.json()).resolves.toMatchObject({ error: { code } });
			expect(fixture.readCredential()).toEqual(expected);
		}

		const stale = await rotate(fixture.origin, AUTOMATION_FIXTURE_TGC_VALID, 1);
		expect(stale.status).toBe(409);
		await expect(stale.json()).resolves.toMatchObject({
			error: { code: "OPS_INTERNAL_PORTAL_CONFLICT" },
		});
		expect(fixture.readCredential()).toEqual(expected);
	});

	it("deletes through the HTTP CAS contract", async () => {
		vi.unstubAllGlobals();
		fixture = await startInternalPortalAutomationFixture();
		const deleted = await fetch(credentialUrl(fixture.origin), {
			headers: { ...headers(), "if-match": '"1"' },
			method: "DELETE",
		});
		const missing = await fetch(credentialUrl(fixture.origin), { headers: headers() });

		expect(deleted.status).toBe(204);
		expect(fixture.readCredential()).toBeNull();
		expect(missing.status).toBe(404);
	});
});
