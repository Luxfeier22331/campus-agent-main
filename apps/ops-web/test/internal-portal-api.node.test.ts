// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
	InternalPortalCandidateInputError,
	InternalPortalCandidateRejectedError,
	InternalPortalCredentialResolutionUnavailableError,
} from "../src/server/internal-portal-credential-service.ts";
import { createAllowAllOpsAdmission } from "../src/server/ops-admission.ts";
import { createTestOpsApp } from "./helpers/ops-app.ts";

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
		resolve: vi.fn(async () => "TGT-resolved"),
		validate: vi.fn(async () => credential),
	};
	const app = createTestOpsApp({
		admission: createAllowAllOpsAdmission({
			email: "operator@example.test",
			operatorId: "operator@example.test",
		}),
		env: {
			OPS_WEB_INTERNAL_TOKEN: "internal-token",
			OPS_WEB_PUBLIC_ORIGIN: "https://ops.example.test",
		},
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

	it("resolves a credential only through the authenticated internal POST", async () => {
		const { app, service } = createTestApp();
		const path = "http://ops.test/internal/ops/internal-portal/credentials/resolve";
		const missing = await app.request(path, { method: "POST" });
		const invalid = await app.request(path, {
			headers: { authorization: "Bearer wrong" },
			method: "POST",
		});
		const wrongMethod = await app.request(path, {
			headers: { authorization: "Bearer internal-token" },
		});
		const unexpectedBody = await app.request(path, {
			body: "{}",
			headers: { authorization: "Bearer internal-token" },
			method: "POST",
		});
		const response = await app.request(path, {
			headers: { authorization: "Bearer internal-token" },
			method: "POST",
		});

		expect(missing.status).toBe(401);
		expect(invalid.status).toBe(401);
		expect(wrongMethod.status).toBe(404);
		expect(unexpectedBody.status).toBe(400);
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		await expect(response.json()).resolves.toEqual({
			schemaVersion: "internal-portal-credential-resolution.v1",
			ssoTgc: "TGT-resolved",
		});
		expect(service.resolve).toHaveBeenCalledWith(expect.any(AbortSignal));
	});

	it("reports an exhausted internal credential pool without exposing plaintext", async () => {
		const { app, service } = createTestApp();
		service.resolve.mockRejectedValueOnce(new InternalPortalCredentialResolutionUnavailableError());
		const response = await app.request(
			"http://ops.test/internal/ops/internal-portal/credentials/resolve",
			{
				headers: { authorization: "Bearer internal-token" },
				method: "POST",
			},
		);

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toMatchObject({
			error: { code: "OPS_INTERNAL_PORTAL_CREDENTIAL_UNAVAILABLE" },
		});
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
