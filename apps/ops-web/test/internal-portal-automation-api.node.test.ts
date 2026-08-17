// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createFixtureOpsStatusStore } from "../src/server/fixture-ops-status-store.ts";
import {
	InternalPortalCredentialConflictError,
	InternalPortalCredentialNameConflictError,
} from "../src/server/internal-portal-credential-store.ts";
import { createAllowAllOpsAdmission } from "../src/server/ops-admission.ts";
import { createTestOpsApp } from "./helpers/ops-app.ts";

const PUBLIC_ORIGIN = "https://ops.example.test";
const AUTOMATION_ORIGIN = "https://ops-api.example.test";
const CREDENTIAL_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN_ID = "22222222-2222-4222-8222-222222222222";
const tokenMetadata = {
	createdAt: "2026-08-06T01:00:00.000Z",
	name: "开发同步程序",
	revokedAt: null,
	tokenId: TOKEN_ID,
};
const credential = {
	createdAt: "2026-08-06T01:00:00.000Z",
	credentialId: CREDENTIAL_ID,
	lastAttemptAt: "2026-08-06T01:00:00.000Z",
	lastOutcome: "valid" as const,
	lastSuccessfulAt: "2026-08-06T01:00:00.000Z",
	name: "开发凭据",
	updatedAt: "2026-08-06T01:00:00.000Z",
	version: 1,
};

function createTestApp() {
	const credentialService = {
		create: vi.fn(async () => credential),
		delete: vi.fn(async () => undefined),
		list: vi.fn(async () => [credential]),
		rename: vi.fn(async () => ({ ...credential, version: 2 })),
		reveal: vi.fn(async () => ({ credentialId: CREDENTIAL_ID, ssoTgc: "TGT-secret", version: 1 })),
		rotate: vi.fn(async () => ({ ...credential, version: 2 })),
		validate: vi.fn(async () => credential),
	};
	const tokenService = {
		authenticate: vi.fn(async (value: string) => (value === "ops_secret" ? tokenMetadata : null)),
		create: vi.fn(async () => ({ ...tokenMetadata, tokenValue: "ops_secret" })),
		list: vi.fn(async () => [tokenMetadata]),
		reveal: vi.fn(async () => ({ ...tokenMetadata, tokenValue: "ops_secret" })),
		revoke: vi.fn(async () => ({ ...tokenMetadata, revokedAt: "2026-08-06T02:00:00.000Z" })),
	};
	const app = createTestOpsApp({
		admission: createAllowAllOpsAdmission({
			email: "operator@example.test",
			operatorId: "operator@example.test",
		}),
		env: {
			OPS_WEB_AUTOMATION_ORIGIN: AUTOMATION_ORIGIN,
			OPS_WEB_PUBLIC_ORIGIN: PUBLIC_ORIGIN,
		},
		internalPortalAutomationTokenService: tokenService,
		internalPortalCredentialService: credentialService,
	});
	return { app, credentialService, tokenService };
}

function automationUrl(path: string) {
	return `${AUTOMATION_ORIGIN}${path}`;
}

function bearerHeaders() {
	return { authorization: "Bearer ops_secret" };
}

describe("internal portal automation API", () => {
	it("reports an unconfigured automation capability without blocking top-level readiness", async () => {
		const { credentialService, tokenService } = createTestApp();
		const app = createTestOpsApp({
			env: {
				DEPLOYMENT_ENVIRONMENT: "local",
				OPS_WEB_PUBLIC_ORIGIN: PUBLIC_ORIGIN,
			},
			internalPortalAutomationTokenService: tokenService,
			internalPortalCredentialService: credentialService,
			store: createFixtureOpsStatusStore(),
		});

		const readiness = await app.request(`${PUBLIC_ORIGIN}/readyz`);
		const automation = await app.request(
			`${PUBLIC_ORIGIN}/api/automation/internal-portal/credentials`,
			{ headers: bearerHeaders() },
		);
		const tokenList = await app.request(
			`${PUBLIC_ORIGIN}/api/ops/internal-portal/automation-tokens`,
		);
		const tokenCreate = await app.request(
			`${PUBLIC_ORIGIN}/api/ops/internal-portal/automation-tokens`,
			{
				body: JSON.stringify({ name: "同步程序" }),
				headers: { "content-type": "application/json", origin: PUBLIC_ORIGIN },
				method: "POST",
			},
		);

		expect(readiness.status).toBe(200);
		for (const response of [automation, tokenList, tokenCreate]) {
			expect(response.status).toBe(503);
			await expect(response.json()).resolves.toMatchObject({
				error: { code: "OPS_AUTOMATION_NOT_CONFIGURED" },
			});
		}
		expect(tokenService.authenticate).not.toHaveBeenCalled();
		expect(tokenService.list).not.toHaveBeenCalled();
		expect(tokenService.create).not.toHaveBeenCalled();
	});

	it.each([
		"ops-api.example.test",
		"http://ops-api.example.test",
		`${AUTOMATION_ORIGIN}/`,
		`${AUTOMATION_ORIGIN}/credentials`,
		`${AUTOMATION_ORIGIN}?source=test`,
	])("treats invalid automation origin %s as unconfigured", async (automationOrigin) => {
		const { credentialService, tokenService } = createTestApp();
		const app = createTestOpsApp({
			env: {
				DEPLOYMENT_ENVIRONMENT: "local",
				OPS_WEB_AUTOMATION_ORIGIN: automationOrigin,
				OPS_WEB_PUBLIC_ORIGIN: PUBLIC_ORIGIN,
			},
			internalPortalAutomationTokenService: tokenService,
			internalPortalCredentialService: credentialService,
			store: createFixtureOpsStatusStore(),
		});

		const readiness = await app.request(`${PUBLIC_ORIGIN}/readyz`);
		const automation = await app.request(
			`${PUBLIC_ORIGIN}/api/automation/internal-portal/credentials`,
			{ headers: bearerHeaders() },
		);

		expect(readiness.status).toBe(200);
		expect(automation.status).toBe(503);
		await expect(automation.json()).resolves.toMatchObject({
			error: { code: "OPS_AUTOMATION_NOT_CONFIGURED" },
		});
		expect(tokenService.authenticate).not.toHaveBeenCalled();
	});

	it("requires a valid bearer token", async () => {
		const { app } = createTestApp();
		const missing = await app.request(automationUrl("/api/automation/internal-portal/credentials"));
		const invalid = await app.request(
			automationUrl("/api/automation/internal-portal/credentials"),
			{
				headers: { authorization: "Bearer wrong" },
			},
		);

		expect(missing.status).toBe(401);
		expect(invalid.status).toBe(401);
		await expect(missing.json()).resolves.toMatchObject({
			error: { code: "OPS_AUTOMATION_TOKEN_INVALID" },
		});
	});

	it("accepts case-insensitive bearer schemes and repeated whitespace", async () => {
		const { app, tokenService } = createTestApp();
		for (const authorization of [
			"bearer ops_secret",
			"BEARER    ops_secret",
			"Bearer\tops_secret",
		]) {
			const response = await app.request(
				automationUrl("/api/automation/internal-portal/credentials"),
				{
					headers: { authorization },
				},
			);

			expect(response.status).toBe(200);
		}
		expect(tokenService.authenticate).toHaveBeenCalledTimes(3);
	});

	it("rejects malformed bearer credentials before token authentication", async () => {
		const { app, tokenService } = createTestApp();
		for (const authorization of [
			"Bearer",
			"Basic ops_secret",
			"Bearer ops secret",
			`Bearer ${"x".repeat(513)}`,
		]) {
			const response = await app.request(
				automationUrl("/api/automation/internal-portal/credentials"),
				{ headers: { authorization } },
			);

			expect(response.status).toBe(401);
		}
		expect(tokenService.authenticate).not.toHaveBeenCalled();
	});

	it("only accepts machine routes on the automation host", async () => {
		const { app, tokenService } = createTestApp();
		const response = await app.request(
			`${PUBLIC_ORIGIN}/api/automation/internal-portal/credentials`,
			{ headers: bearerHeaders() },
		);

		expect(response.status).toBe(404);
		expect(tokenService.authenticate).not.toHaveBeenCalled();
	});

	it("matches the machine host when the tunnel forwards HTTP internally", async () => {
		const { app } = createTestApp();
		const response = await app.request(
			automationUrl("/api/automation/internal-portal/credentials").replace("https://", "http://"),
			{ headers: bearerHeaders() },
		);

		expect(response.status).toBe(200);
	});

	it("does not expose human routes on the machine host", async () => {
		const { app, tokenService } = createTestApp();
		const response = await app.request(
			automationUrl("/api/ops/internal-portal/automation-tokens").replace("https://", "http://"),
		);

		expect(response.status).toBe(404);
		expect(tokenService.list).not.toHaveBeenCalled();
	});

	it("returns metadata for list and detail reads", async () => {
		const { app } = createTestApp();
		const list = await app.request(automationUrl("/api/automation/internal-portal/credentials"), {
			headers: bearerHeaders(),
		});
		const detail = await app.request(
			automationUrl(`/api/automation/internal-portal/credentials/${CREDENTIAL_ID}`),
			{ headers: bearerHeaders() },
		);

		expect(list.status).toBe(200);
		expect(detail.status).toBe(200);
		expect(list.headers.get("cache-control")).toBe("no-store");
		expect(detail.headers.get("etag")).toBe('"1"');
		const listBody = await list.text();
		const detailBody = await detail.text();
		expect(listBody).toContain(CREDENTIAL_ID);
		expect(listBody).not.toContain("TGT-");
		expect(detailBody).not.toContain("TGT-");
	});

	it("creates a named credential through the machine endpoint", async () => {
		const { app, credentialService } = createTestApp();
		const invalidContentType = await app.request(
			automationUrl("/api/automation/internal-portal/credentials"),
			{
				body: JSON.stringify({ name: "开发凭据", ssoTgc: "TGT-new" }),
				headers: { ...bearerHeaders(), "content-type": "text/plain" },
				method: "POST",
			},
		);
		const invalidBody = await app.request(
			automationUrl("/api/automation/internal-portal/credentials"),
			{
				body: JSON.stringify({ extra: true, name: "开发凭据", ssoTgc: "TGT-new" }),
				headers: { ...bearerHeaders(), "content-type": "application/json" },
				method: "POST",
			},
		);
		const created = await app.request(
			automationUrl("/api/automation/internal-portal/credentials"),
			{
				body: JSON.stringify({ name: "开发凭据", ssoTgc: "TGT-new" }),
				headers: { ...bearerHeaders(), "content-type": "application/json" },
				method: "POST",
			},
		);

		expect(invalidContentType.status).toBe(400);
		expect(invalidBody.status).toBe(400);
		expect(created.status).toBe(201);
		expect(created.headers.get("cache-control")).toBe("no-store");
		expect(created.headers.get("etag")).toBe('"1"');
		expect(credentialService.create).toHaveBeenCalledOnce();
		expect(credentialService.create).toHaveBeenCalledWith(
			{ name: "开发凭据", ssoTgc: "TGT-new" },
			expect.any(AbortSignal),
		);
	});

	it("returns a distinct conflict when the machine name already exists", async () => {
		const { app, credentialService } = createTestApp();
		credentialService.create.mockRejectedValueOnce(new InternalPortalCredentialNameConflictError());
		const response = await app.request(
			automationUrl("/api/automation/internal-portal/credentials"),
			{
				body: JSON.stringify({ name: "开发凭据", ssoTgc: "TGT-new" }),
				headers: { ...bearerHeaders(), "content-type": "application/json" },
				method: "POST",
			},
		);

		expect(response.status).toBe(409);
		await expect(response.json()).resolves.toMatchObject({
			error: { code: "OPS_INTERNAL_PORTAL_NAME_CONFLICT" },
		});
	});

	it("allows only ssoTgc updates with a current If-Match", async () => {
		const { app, credentialService } = createTestApp();
		const missingPrecondition = await app.request(
			automationUrl(`/api/automation/internal-portal/credentials/${CREDENTIAL_ID}`),
			{
				body: JSON.stringify({ ssoTgc: "TGT-next" }),
				headers: { ...bearerHeaders(), "content-type": "application/json" },
				method: "PUT",
			},
		);
		const extraField = await app.request(
			automationUrl(`/api/automation/internal-portal/credentials/${CREDENTIAL_ID}`),
			{
				body: JSON.stringify({ name: "不允许", ssoTgc: "TGT-next" }),
				headers: {
					...bearerHeaders(),
					"content-type": "application/json",
					"if-match": '"1"',
				},
				method: "PUT",
			},
		);
		const updated = await app.request(
			automationUrl(`/api/automation/internal-portal/credentials/${CREDENTIAL_ID}`),
			{
				body: JSON.stringify({ ssoTgc: "TGT-next" }),
				headers: {
					...bearerHeaders(),
					"content-type": "Application/JSON; charset=utf-8",
					"if-match": '"1"',
				},
				method: "PUT",
			},
		);

		expect(missingPrecondition.status).toBe(428);
		expect(extraField.status).toBe(400);
		const unexpectedQuery = await app.request(
			automationUrl(`/api/automation/internal-portal/credentials/${CREDENTIAL_ID}?unexpected=1`),
			{
				body: JSON.stringify({ ssoTgc: "TGT-next" }),
				headers: {
					...bearerHeaders(),
					"content-type": "application/json",
					"if-match": '"1"',
				},
				method: "PUT",
			},
		);
		const invalidContentType = await app.request(
			automationUrl(`/api/automation/internal-portal/credentials/${CREDENTIAL_ID}`),
			{
				body: JSON.stringify({ ssoTgc: "TGT-next" }),
				headers: {
					...bearerHeaders(),
					"content-type": "application/jsonfoo",
					"if-match": '"1"',
				},
				method: "PUT",
			},
		);

		expect(unexpectedQuery.status).toBe(400);
		expect(invalidContentType.status).toBe(400);
		expect(updated.status).toBe(200);
		expect(credentialService.rotate).toHaveBeenCalledTimes(1);
		expect(credentialService.rotate).toHaveBeenCalledWith(
			CREDENTIAL_ID,
			"TGT-next",
			1,
			expect.any(AbortSignal),
		);
		expect(updated.headers.get("etag")).toBe('"2"');
	});

	it("cancels an oversized unknown-length body before reading the next chunk", async () => {
		const { app, credentialService } = createTestApp();
		let cancelled = false;
		let pullCount = 0;
		const requestBody = new ReadableStream<Uint8Array>(
			{
				cancel() {
					cancelled = true;
				},
				pull(controller) {
					pullCount += 1;
					if (pullCount === 1) {
						controller.enqueue(new Uint8Array(20 * 1024 + 1));
						return;
					}
					controller.close();
				},
			},
			{ highWaterMark: 0 },
		);
		const request = new Request(
			automationUrl(`/api/automation/internal-portal/credentials/${CREDENTIAL_ID}`),
			{
				body: requestBody,
				duplex: "half",
				headers: {
					...bearerHeaders(),
					"content-type": "application/json",
					"if-match": '"1"',
				},
				method: "PUT",
			} as RequestInit & { duplex: "half" },
		);

		expect(request.headers.has("content-length")).toBe(false);
		const response = await app.fetch(request);

		expect(response.status).toBe(400);
		expect(cancelled).toBe(true);
		expect(pullCount).toBe(1);
		expect(credentialService.rotate).not.toHaveBeenCalled();
	});

	it("maps stale machine writes to the existing CAS conflict", async () => {
		const { app, credentialService } = createTestApp();
		credentialService.rotate.mockRejectedValueOnce(new InternalPortalCredentialConflictError());
		const response = await app.request(
			automationUrl(`/api/automation/internal-portal/credentials/${CREDENTIAL_ID}`),
			{
				body: JSON.stringify({ ssoTgc: "TGT-stale" }),
				headers: {
					...bearerHeaders(),
					"content-type": "application/json",
					"if-match": '"1"',
				},
				method: "PUT",
			},
		);

		expect(response.status).toBe(409);
		await expect(response.json()).resolves.toMatchObject({
			error: { code: "OPS_INTERNAL_PORTAL_CONFLICT" },
		});
	});

	it("requires If-Match for delete and exposes no machine reveal route", async () => {
		const { app, credentialService } = createTestApp();
		const missingPrecondition = await app.request(
			automationUrl(`/api/automation/internal-portal/credentials/${CREDENTIAL_ID}`),
			{ headers: { ...bearerHeaders() }, method: "DELETE" },
		);
		const unexpectedQuery = await app.request(
			`${automationUrl(`/api/automation/internal-portal/credentials/${CREDENTIAL_ID}`)}?unexpected=1`,
			{ headers: { ...bearerHeaders(), "if-match": '"1"' }, method: "DELETE" },
		);
		const unexpectedBody = await app.request(
			automationUrl(`/api/automation/internal-portal/credentials/${CREDENTIAL_ID}`),
			{
				body: "unexpected",
				headers: {
					...bearerHeaders(),
					"content-type": "text/plain",
					"if-match": '"1"',
				},
				method: "DELETE",
			},
		);
		const deleted = await app.request(
			automationUrl(`/api/automation/internal-portal/credentials/${CREDENTIAL_ID}`),
			{ headers: { ...bearerHeaders(), "if-match": '"1"' }, method: "DELETE" },
		);
		const reveal = await app.request(
			automationUrl(`/api/automation/internal-portal/credentials/${CREDENTIAL_ID}/reveal`),
			{ headers: bearerHeaders(), method: "POST" },
		);
		expect(missingPrecondition.status).toBe(428);
		expect(unexpectedQuery.status).toBe(400);
		expect(unexpectedBody.status).toBe(400);
		expect(deleted.status).toBe(204);
		expect(deleted.headers.get("cache-control")).toBe("no-store");
		expect(reveal.status).toBe(404);
		expect(credentialService.delete).toHaveBeenCalledTimes(1);
		expect(credentialService.delete).toHaveBeenCalledWith(CREDENTIAL_ID, 1);
	});

	it("cancels an unknown-length delete body before calling the credential service", async () => {
		const { app, credentialService } = createTestApp();
		let cancelled = false;
		let pullCount = 0;
		const requestBody = new ReadableStream<Uint8Array>(
			{
				cancel() {
					cancelled = true;
				},
				pull(controller) {
					pullCount += 1;
					controller.enqueue(new Uint8Array([1]));
				},
			},
			{ highWaterMark: 0 },
		);
		const request = new Request(
			automationUrl(`/api/automation/internal-portal/credentials/${CREDENTIAL_ID}`),
			{
				body: requestBody,
				duplex: "half",
				headers: { ...bearerHeaders(), "if-match": '"1"' },
				method: "DELETE",
			} as RequestInit & { duplex: "half" },
		);

		expect(request.headers.has("content-length")).toBe(false);
		const response = await app.fetch(request);

		expect(response.status).toBe(400);
		expect(cancelled).toBe(true);
		expect(pullCount).toBe(1);
		expect(credentialService.delete).not.toHaveBeenCalled();
	});

	it("keeps token management behind the human same-origin route", async () => {
		const { app, tokenService } = createTestApp();
		const list = await app.request(`${PUBLIC_ORIGIN}/api/ops/internal-portal/automation-tokens`);
		const rejectedWrite = await app.request(
			`${PUBLIC_ORIGIN}/api/ops/internal-portal/automation-tokens`,
			{
				body: JSON.stringify({ name: "同步程序" }),
				headers: { "content-type": "application/json", origin: "https://other.example.test" },
				method: "POST",
			},
		);
		const created = await app.request(
			`${PUBLIC_ORIGIN}/api/ops/internal-portal/automation-tokens`,
			{
				body: JSON.stringify({ name: "同步程序" }),
				headers: { "content-type": "application/json", origin: PUBLIC_ORIGIN },
				method: "POST",
			},
		);

		expect(list.status).toBe(200);
		expect(await list.json()).toMatchObject({
			endpoint: AUTOMATION_ORIGIN,
			tokens: [tokenMetadata],
		});
		expect(rejectedWrite.status).toBe(403);
		expect(created.status).toBe(201);
		expect(tokenService.create).toHaveBeenCalledWith("同步程序");
		const createdBody = await created.text();
		expect(createdBody).toContain("ops_secret");
	});

	it("does not expose the human token management route without Access admission", async () => {
		const app = createTestOpsApp({
			env: {
				ACCESS_POLICY_AUD: "audience",
				ACCESS_TEAM_DOMAIN: "https://team.example.test",
				OPS_WEB_AUTOMATION_ORIGIN: AUTOMATION_ORIGIN,
				OPS_WEB_PUBLIC_ORIGIN: PUBLIC_ORIGIN,
			},
		});
		const response = await app.request(
			`${PUBLIC_ORIGIN}/api/ops/internal-portal/automation-tokens`,
		);

		expect(response.status).toBe(401);
		await expect(response.json()).resolves.toMatchObject({
			error: { code: "OPS_ACCESS_JWT_MISSING" },
		});
	});
});
