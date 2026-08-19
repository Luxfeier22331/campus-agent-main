// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
	createInternalPortalCredentialService,
	InternalPortalCandidateInputError,
	InternalPortalCandidateRejectedError,
	InternalPortalCredentialConflictError,
	InternalPortalCredentialNameConflictError,
	InternalPortalCredentialNotFoundError,
	InternalPortalCredentialStoreUnavailableError,
} from "../src/server/internal-portal-credential-service.ts";

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

function createService(request: typeof fetch) {
	return createInternalPortalCredentialService(
		{
			INGESTION_CONTROL_INTERNAL_URL: "http://ingestion-control:8000",
			OPS_WEB_INTERNAL_TOKEN: "internal-token",
		},
		{ fetch: request },
	);
}

describe("internal portal credential client", () => {
	it("lists credentials through ingestion-control without exposing the internal token", async () => {
		const request = vi.fn(async () => Response.json({ credentials: [credential] }));

		await expect(createService(request as typeof fetch).list()).resolves.toEqual([credential]);
		expect(request).toHaveBeenCalledWith(
			new URL("http://ingestion-control:8000/internal/ingestion/internal-portal/credentials"),
			expect.objectContaining({
				headers: {
					accept: "application/json",
					authorization: "Bearer internal-token",
				},
			}),
		);
	});

	it("forwards create, CAS update, validate, reveal and delete operations", async () => {
		const request = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(Response.json({ credential }, { status: 201 }))
			.mockResolvedValueOnce(Response.json({ credential: { ...credential, version: 2 } }))
			.mockResolvedValueOnce(Response.json({ credential: { ...credential, version: 2 } }))
			.mockResolvedValueOnce(
				Response.json({ credentialId: CREDENTIAL_ID, ssoTgc: "TGT-secret", version: 2 }),
			)
			.mockResolvedValueOnce(new Response(null, { status: 204 }));
		const service = createService(request);

		await service.create({ name: "开发凭据", ssoTgc: "TGT-new" });
		await service.rotate(CREDENTIAL_ID, "TGT-next", 1);
		await service.validate(CREDENTIAL_ID);
		await service.reveal(CREDENTIAL_ID);
		await service.delete(CREDENTIAL_ID, 2);

		expect(request.mock.calls.map(([url, init]) => [String(url), init?.method ?? "GET"])).toEqual([
			["http://ingestion-control:8000/internal/ingestion/internal-portal/credentials", "POST"],
			[
				`http://ingestion-control:8000/internal/ingestion/internal-portal/credentials/${CREDENTIAL_ID}`,
				"PUT",
			],
			[
				`http://ingestion-control:8000/internal/ingestion/internal-portal/credentials/${CREDENTIAL_ID}/validate`,
				"POST",
			],
			[
				`http://ingestion-control:8000/internal/ingestion/internal-portal/credentials/${CREDENTIAL_ID}/reveal`,
				"POST",
			],
			[
				`http://ingestion-control:8000/internal/ingestion/internal-portal/credentials/${CREDENTIAL_ID}`,
				"DELETE",
			],
		]);
		expect(request.mock.calls[1]?.[1]?.headers).toMatchObject({ "if-match": '"1"' });
		expect(request.mock.calls[4]?.[1]?.headers).toMatchObject({ "if-match": '"2"' });
	});

	it.each([
		["INGESTION_INTERNAL_PORTAL_INPUT_INVALID", InternalPortalCandidateInputError],
		["INGESTION_INTERNAL_PORTAL_CREDENTIAL_REJECTED", InternalPortalCandidateRejectedError],
		["INGESTION_INTERNAL_PORTAL_NOT_FOUND", InternalPortalCredentialNotFoundError],
		["INGESTION_INTERNAL_PORTAL_CONFLICT", InternalPortalCredentialConflictError],
		["INGESTION_INTERNAL_PORTAL_NAME_CONFLICT", InternalPortalCredentialNameConflictError],
	] as const)("maps upstream error %s", async (code, expectedError) => {
		const request = vi.fn(async () =>
			Response.json({ error: { code } }, { status: code.endsWith("NOT_FOUND") ? 404 : 409 }),
		);

		await expect(createService(request as typeof fetch).list()).rejects.toBeInstanceOf(
			expectedError,
		);
	});

	it("fails closed for invalid configuration, transport failure and invalid responses", async () => {
		expect(() => createInternalPortalCredentialService({})).toThrow(
			InternalPortalCredentialStoreUnavailableError,
		);
		await expect(
			createService(
				vi.fn(async () => Response.json({ credentials: "invalid" })) as typeof fetch,
			).list(),
		).rejects.toBeInstanceOf(InternalPortalCredentialStoreUnavailableError);
		await expect(
			createService(
				vi.fn(async () => {
					throw new Error("unreachable");
				}) as typeof fetch,
			).list(),
		).rejects.toBeInstanceOf(InternalPortalCredentialStoreUnavailableError);
	});
});
