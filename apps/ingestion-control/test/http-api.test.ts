import { describe, expect, it, vi } from "vitest";
import { createIngestionControlHandler } from "../src/http.ts";
import {
	InternalPortalCandidateRejectedError,
	InternalPortalCredentialResolutionUnavailableError,
	type InternalPortalCredentialService,
} from "../src/internal-portal-credential-service.ts";

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

function createService(): InternalPortalCredentialService {
	return {
		create: vi.fn(async () => credential),
		delete: vi.fn(async () => undefined),
		list: vi.fn(async () => [credential]),
		rename: vi.fn(async () => ({ ...credential, name: "新名称", version: 2 })),
		reveal: vi.fn(async () => ({ credentialId: CREDENTIAL_ID, ssoTgc: "TGT-secret", version: 1 })),
		resolve: vi.fn(async () => "TGT-resolved"),
		rotate: vi.fn(async () => ({ ...credential, version: 2 })),
		validate: vi.fn(async () => credential),
	};
}

function createHandler(service = createService()) {
	return {
		handler: createIngestionControlHandler({
			credentialService: service,
			internalToken: "internal-token",
		}),
		service,
	};
}

function request(path: string, init: RequestInit = {}): Request {
	return new Request(`http://ingestion-control${path}`, {
		...init,
		headers: { authorization: "Bearer internal-token", ...init.headers },
	});
}

describe("ingestion-control credential HTTP API", () => {
	it("keeps health public and readiness dependency-aware", async () => {
		const ready = createIngestionControlHandler({
			credentialService: createService(),
			readinessCheck: async () => undefined,
		});
		const unavailable = createIngestionControlHandler({
			credentialService: createService(),
			readinessCheck: async () => {
				throw new Error("database unavailable");
			},
		});

		await expect(
			(await ready(new Request("http://ingestion-control/healthz"))).json(),
		).resolves.toEqual({
			status: "ok",
		});
		expect((await ready(new Request("http://ingestion-control/readyz"))).status).toBe(200);
		expect((await unavailable(new Request("http://ingestion-control/readyz"))).status).toBe(503);
	});

	it("requires the shared internal bearer token", async () => {
		const { handler, service } = createHandler();
		const response = await handler(
			new Request("http://ingestion-control/internal/ingestion/internal-portal/credentials"),
		);

		expect(response.status).toBe(401);
		expect(service.list).not.toHaveBeenCalled();
	});

	it("lists credentials and resolves plaintext only through the dedicated endpoint", async () => {
		const { handler, service } = createHandler();
		const list = await handler(request("/internal/ingestion/internal-portal/credentials"));
		const resolve = await handler(
			request("/internal/ingestion/internal-portal/credentials/resolve", { method: "POST" }),
		);

		expect(list.status).toBe(200);
		expect(await list.text()).not.toContain("TGT-");
		expect(await resolve.json()).toEqual({
			schemaVersion: "internal-portal-credential-resolution.v1",
			ssoTgc: "TGT-resolved",
		});
		expect(service.resolve).toHaveBeenCalledWith(expect.any(AbortSignal));
	});

	it("supports create, CAS update, validate, reveal and delete", async () => {
		const { handler, service } = createHandler();
		const base = "/internal/ingestion/internal-portal/credentials";
		const created = await handler(
			request(base, {
				body: JSON.stringify({ name: "开发凭据", ssoTgc: "TGT-new" }),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		);
		const updated = await handler(
			request(`${base}/${CREDENTIAL_ID}`, {
				body: JSON.stringify({ ssoTgc: "TGT-next" }),
				headers: { "content-type": "application/json", "if-match": '"1"' },
				method: "PUT",
			}),
		);
		const validated = await handler(
			request(`${base}/${CREDENTIAL_ID}/validate`, { method: "POST" }),
		);
		const revealed = await handler(request(`${base}/${CREDENTIAL_ID}/reveal`, { method: "POST" }));
		const deleted = await handler(
			request(`${base}/${CREDENTIAL_ID}`, {
				headers: { "if-match": '"1"' },
				method: "DELETE",
			}),
		);

		expect(created.status).toBe(201);
		expect(updated.headers.get("etag")).toBe('"2"');
		expect(validated.status).toBe(200);
		expect(await revealed.json()).toMatchObject({ ssoTgc: "TGT-secret" });
		expect(deleted.status).toBe(204);
		expect(service.rotate).toHaveBeenCalledWith(
			CREDENTIAL_ID,
			"TGT-next",
			1,
			expect.any(AbortSignal),
		);
	});

	it("rejects malformed requests before calling the service", async () => {
		const { handler, service } = createHandler();
		const response = await handler(
			request("/internal/ingestion/internal-portal/credentials?unexpected=1"),
		);
		const missingPrecondition = await handler(
			request(`/internal/ingestion/internal-portal/credentials/${CREDENTIAL_ID}`, {
				body: JSON.stringify({ name: "新名称" }),
				headers: { "content-type": "application/json" },
				method: "PUT",
			}),
		);

		expect(response.status).toBe(400);
		expect(missingPrecondition.status).toBe(428);
		expect(service.rename).not.toHaveBeenCalled();
	});

	it("maps rejected candidates and an exhausted credential pool", async () => {
		const service = createService();
		vi.mocked(service.create).mockRejectedValueOnce(new InternalPortalCandidateRejectedError());
		vi.mocked(service.resolve).mockRejectedValueOnce(
			new InternalPortalCredentialResolutionUnavailableError(),
		);
		const { handler } = createHandler(service);
		const rejected = await handler(
			request("/internal/ingestion/internal-portal/credentials", {
				body: JSON.stringify({ name: "失效", ssoTgc: "TGT-expired" }),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		);
		const unavailable = await handler(
			request("/internal/ingestion/internal-portal/credentials/resolve", { method: "POST" }),
		);

		expect(rejected.status).toBe(422);
		expect(unavailable.status).toBe(503);
		await expect(unavailable.json()).resolves.toMatchObject({
			error: { code: "INGESTION_INTERNAL_PORTAL_CREDENTIAL_UNAVAILABLE" },
		});
	});
});
