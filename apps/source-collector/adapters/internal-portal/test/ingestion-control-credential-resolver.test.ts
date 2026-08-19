import { describe, expect, it, vi } from "vitest";
import {
	IngestionControlCredentialResolverError,
	resolveInternalPortalCredential,
	resolveInternalPortalCredentialFromEnv,
} from "../src/ingestion-control-credential-resolver.js";

describe("ingestion-control internal portal credential resolver", () => {
	it("posts the shared internal token and parses the versioned response", async () => {
		const request = vi.fn(async () =>
			Response.json({
				schemaVersion: "internal-portal-credential-resolution.v1",
				ssoTgc: "TGT-resolved",
			}),
		);

		await expect(
			resolveInternalPortalCredential({
				fetch: request as typeof fetch,
				token: "internal-token",
				url: "http://ingestion-control:8000",
			}),
		).resolves.toEqual({
			schemaVersion: "internal-portal-credential-resolution.v1",
			ssoTgc: "TGT-resolved",
		});
		expect(request).toHaveBeenCalledWith(
			new URL(
				"http://ingestion-control:8000/internal/ingestion/internal-portal/credentials/resolve",
			),
			expect.objectContaining({
				headers: {
					accept: "application/json",
					authorization: "Bearer internal-token",
				},
				method: "POST",
			}),
		);
	});

	it("preserves the upstream error code without exposing the token", async () => {
		const error = await resolveInternalPortalCredential({
			fetch: vi.fn(async () =>
				Response.json(
					{ error: { code: "INGESTION_INTERNAL_PORTAL_CREDENTIAL_UNAVAILABLE" } },
					{ status: 503 },
				),
			) as typeof fetch,
			token: "internal-token",
			url: "http://127.0.0.1:8000",
		}).catch((value: unknown) => value);

		expect(error).toBeInstanceOf(IngestionControlCredentialResolverError);
		expect(error).toMatchObject({
			code: "INGESTION_INTERNAL_PORTAL_CREDENTIAL_UNAVAILABLE",
			status: 503,
		});
		expect(String(error)).not.toContain("internal-token");
	});

	it("rejects invalid configuration and response bodies", async () => {
		await expect(resolveInternalPortalCredentialFromEnv({})).rejects.toMatchObject({
			code: "INGESTION_INTERNAL_PORTAL_CONFIG_INVALID",
		});
		await expect(
			resolveInternalPortalCredential({
				fetch: vi.fn(async () => Response.json({ ssoTgc: "TGT-missing-version" })) as typeof fetch,
				token: "internal-token",
				url: "https://ingestion.example.test/path",
			}),
		).rejects.toMatchObject({ code: "INGESTION_INTERNAL_PORTAL_CONFIG_INVALID" });
		await expect(
			resolveInternalPortalCredential({
				fetch: vi.fn(async () => Response.json({ ssoTgc: "TGT-missing-version" })) as typeof fetch,
				token: "internal-token",
				url: "https://ingestion.example.test",
			}),
		).rejects.toMatchObject({ code: "INGESTION_INTERNAL_PORTAL_RESPONSE_INVALID" });
	});
});
