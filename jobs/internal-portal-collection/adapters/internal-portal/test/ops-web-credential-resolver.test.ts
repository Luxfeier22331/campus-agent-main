import { describe, expect, it, vi } from "vitest";
import {
	OpsWebCredentialResolverError,
	resolveInternalPortalCredential,
	resolveInternalPortalCredentialFromEnv,
} from "../src/ops-web-credential-resolver.js";

describe("Ops Web internal portal credential resolver", () => {
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
				url: "http://ops-web:5178",
			}),
		).resolves.toEqual({
			schemaVersion: "internal-portal-credential-resolution.v1",
			ssoTgc: "TGT-resolved",
		});
		expect(request).toHaveBeenCalledWith(
			new URL(
				"http://ops-web:5178/internal/ops/internal-portal/credentials/resolve",
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
					{ error: { code: "OPS_INTERNAL_PORTAL_CREDENTIAL_UNAVAILABLE" } },
					{ status: 503 },
				),
			) as typeof fetch,
			token: "internal-token",
			url: "http://127.0.0.1:8000",
		}).catch((value: unknown) => value);

		expect(error).toBeInstanceOf(OpsWebCredentialResolverError);
		expect(error).toMatchObject({
			code: "OPS_INTERNAL_PORTAL_CREDENTIAL_UNAVAILABLE",
			status: 503,
		});
		expect(String(error)).not.toContain("internal-token");
	});

	it("rejects invalid configuration and response bodies", async () => {
		await expect(resolveInternalPortalCredentialFromEnv({})).rejects.toMatchObject({
			code: "OPS_INTERNAL_PORTAL_CONFIG_INVALID",
		});
		await expect(
			resolveInternalPortalCredential({
				fetch: vi.fn(async () => Response.json({ ssoTgc: "TGT-missing-version" })) as typeof fetch,
				token: "internal-token",
			url: "https://ops-web.example.test/path",
			}),
		).rejects.toMatchObject({ code: "OPS_INTERNAL_PORTAL_CONFIG_INVALID" });
		await expect(
			resolveInternalPortalCredential({
				fetch: vi.fn(async () => Response.json({ ssoTgc: "TGT-missing-version" })) as typeof fetch,
				token: "internal-token",
			url: "https://ops-web.example.test",
			}),
		).rejects.toMatchObject({ code: "OPS_INTERNAL_PORTAL_RESPONSE_INVALID" });
	});
});
