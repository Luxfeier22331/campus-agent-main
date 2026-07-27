// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createOpsApp } from "../src/server/app";
import {
	type InternalPortalAuthClient,
	InternalPortalAuthUnavailableError,
} from "../src/server/internal-portal-auth-client";
import { createAllowAllOpsAdmission } from "../src/server/ops-admission";
import type { InternalPortalAuthStatus } from "../src/shared/ops-contract";

const status: InternalPortalAuthStatus = {
	credentialUpdatedAt: "2026-07-27T10:00:00.000Z",
	currentCredentialChecked: true,
	lastScheduledAt: "2026-07-27T10:30:00.000Z",
	lastSuccessfulAt: "2026-07-27T10:30:04.000Z",
	latestRun: "succeeded",
};

describe("internal portal authentication Ops API", () => {
	it("returns only the fixed operational status", async () => {
		const app = createTestApp({
			getStatus: vi.fn().mockResolvedValue(status),
			replaceCredential: vi.fn(),
		});

		const response = await app.request("https://ops.example.test/api/ops/internal-portal/auth");

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual(status);
	});

	it("requires same-origin JSON and rejects cookie strings", async () => {
		const replaceCredential = vi.fn().mockResolvedValue({
			...status,
			credentialUpdatedAt: "2026-07-27T11:00:00.000Z",
			currentCredentialChecked: false,
		});
		const app = createTestApp({ getStatus: vi.fn().mockResolvedValue(status), replaceCredential });

		const crossOrigin = await app.request("https://ops.example.test/api/ops/internal-portal/auth", {
			body: JSON.stringify({ ssoTgc: "TGT-replacement" }),
			headers: { "content-type": "application/json", origin: "https://attacker.test" },
			method: "PUT",
		});
		expect(crossOrigin.status).toBe(403);

		const cookieString = await app.request(
			"https://ops.example.test/api/ops/internal-portal/auth",
			{
				body: JSON.stringify({ ssoTgc: "SSO_TGC=TGT-replacement; Path=/" }),
				headers: sameOriginJsonHeaders,
				method: "PUT",
			},
		);
		expect(cookieString.status).toBe(400);
		expect(replaceCredential).not.toHaveBeenCalled();
	});

	it("replaces the raw value without returning it", async () => {
		const replaced = {
			...status,
			credentialUpdatedAt: "2026-07-27T11:00:00.000Z",
			currentCredentialChecked: false,
		};
		const replaceCredential = vi.fn().mockResolvedValue(replaced);
		const app = createTestApp({ getStatus: vi.fn().mockResolvedValue(status), replaceCredential });

		const response = await app.request("https://ops.example.test/api/ops/internal-portal/auth", {
			body: JSON.stringify({ ssoTgc: "TGT-replacement" }),
			headers: sameOriginJsonHeaders,
			method: "PUT",
		});

		expect(response.status).toBe(200);
		expect(replaceCredential).toHaveBeenCalledWith("TGT-replacement");
		expect(await response.json()).toEqual(replaced);
	});

	it("maps Kubernetes failures to an unavailable response", async () => {
		const app = createTestApp({
			getStatus: async () => {
				throw new InternalPortalAuthUnavailableError();
			},
			replaceCredential: vi.fn(),
		});

		const response = await app.request("https://ops.example.test/api/ops/internal-portal/auth");

		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({
			error: {
				code: "OPS_INTERNAL_PORTAL_AUTH_UNAVAILABLE",
				message: "内部门户认证资源暂不可用。",
			},
		});
	});
});

const sameOriginJsonHeaders = {
	"content-type": "application/json",
	origin: "https://ops.example.test",
	"sec-fetch-site": "same-origin",
};

function createTestApp(internalPortalAuthClient: InternalPortalAuthClient) {
	return createOpsApp({
		admission: createAllowAllOpsAdmission(),
		env: { OPS_WEB_PUBLIC_ORIGIN: "https://ops.example.test" },
		internalPortalAuthClient,
	});
}
