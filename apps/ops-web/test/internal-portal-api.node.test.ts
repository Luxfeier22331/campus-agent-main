// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createOpsApp } from "../src/server/app.ts";
import { InternalPortalCandidateInputError } from "../src/server/internal-portal-candidate-input.ts";
import { InternalPortalCandidateRejectedError } from "../src/server/internal-portal-credential-service.ts";
import { createAllowAllOpsAdmission } from "../src/server/ops-admission.ts";

const CREDENTIAL_ID = "11111111-1111-4111-8111-111111111111";
const credential = {
	createdAt: "2026-08-02T01:00:00.000Z",
	credentialId: CREDENTIAL_ID,
	lastAttemptAt: "2026-08-02T01:00:00.000Z",
	lastOutcome: "valid" as const,
	lastSuccessfulAt: "2026-08-02T01:00:00.000Z",
	name: "开发凭据",
	updatedAt: "2026-08-02T01:00:00.000Z",
	version: 1,
};

function createTestApp() {
	const service = {
		create: vi.fn(async () => credential),
		delete: vi.fn(async () => undefined),
		list: vi.fn(async () => [credential]),
		rename: vi.fn(async () => ({ ...credential, name: "新名称", version: 2 })),
		reveal: vi.fn(async () => ({
			credentialId: CREDENTIAL_ID,
			ssoTgc: "TGT-plaintext",
			version: 1,
		})),
		rotate: vi.fn(async () => ({ ...credential, version: 2 })),
		validate: vi.fn(async () => credential),
	};
	const app = createOpsApp({
		admission: createAllowAllOpsAdmission({
			email: "operator@example.test",
			operatorId: "operator@example.test",
		}),
		env: { OPS_WEB_PUBLIC_ORIGIN: "https://ops.example.test" },
		internalPortalCredentialService: service,
	});
	return { app, service };
}

describe("internal portal credential API", () => {
	it("lists metadata without exposing TGC plaintext", async () => {
		const { app } = createTestApp();
		const response = await app.request("http://ops.test/api/ops/internal-portal/credentials");
		const body = await response.text();

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(body).toContain(CREDENTIAL_ID);
		expect(body).not.toContain("TGT-");
	});

	it("validates a new candidate before returning credential metadata", async () => {
		const { app, service } = createTestApp();
		const response = await app.request("http://ops.test/api/ops/internal-portal/credentials", {
			body: JSON.stringify({ name: "开发凭据", ssoTgc: "TGT-candidate" }),
			headers: {
				"content-type": "application/json",
				origin: "https://ops.example.test",
			},
			method: "POST",
		});

		expect(response.status).toBe(201);
		expect(service.create).toHaveBeenCalledWith(
			{ name: "开发凭据", ssoTgc: "TGT-candidate" },
			expect.any(AbortSignal),
		);
		expect(response.headers.get("etag")).toBe('"1"');
		expect(await response.json()).toEqual({ credential });
	});

	it("reveals plaintext only through a same-origin POST", async () => {
		const { app, service } = createTestApp();
		const path = `http://ops.test/api/ops/internal-portal/credentials/${CREDENTIAL_ID}/reveal`;
		const getResponse = await app.request(path);
		expect(getResponse.status).toBe(404);

		const response = await app.request(path, {
			headers: { origin: "https://ops.example.test" },
			method: "POST",
		});
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(service.reveal).toHaveBeenCalledWith(CREDENTIAL_ID);
		expect(await response.json()).toMatchObject({ ssoTgc: "TGT-plaintext" });
	});

	it("keeps a rejected candidate as a failed write", async () => {
		const { app, service } = createTestApp();
		service.create.mockRejectedValueOnce(new InternalPortalCandidateRejectedError());
		const response = await app.request("http://ops.test/api/ops/internal-portal/credentials", {
			body: JSON.stringify({ name: "失效凭据", ssoTgc: "TGT-expired" }),
			headers: {
				"content-type": "application/json",
				origin: "https://ops.example.test",
			},
			method: "POST",
		});

		expect(response.status).toBe(422);
		expect(await response.json()).toMatchObject({
			error: { code: "OPS_INTERNAL_PORTAL_CREDENTIAL_REJECTED" },
		});
	});

	it("returns the existing input error for malformed candidate Cookie input", async () => {
		const { app, service } = createTestApp();
		service.create.mockRejectedValueOnce(new InternalPortalCandidateInputError());
		const response = await app.request("http://ops.test/api/ops/internal-portal/credentials", {
			body: JSON.stringify({ name: "开发凭据", ssoTgc: "Path=/" }),
			headers: {
				"content-type": "application/json",
				origin: "https://ops.example.test",
			},
			method: "POST",
		});

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			error: { code: "OPS_INTERNAL_PORTAL_INPUT_INVALID" },
		});
	});
});
