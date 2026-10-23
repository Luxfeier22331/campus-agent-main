import { describe, expect, it } from "vitest";

import {
	buildFederationProviderClaimSet,
	resolveFederationPreferredUsername,
} from "../src/modules/federation-runtime/claims";

describe("federation OIDC claims", () => {
	it("derives a stable preferred_username from the verified email local part", () => {
		expect(resolveFederationPreferredUsername("Jane.Doe@example.edu")).toBe("jane.doe");
		expect(resolveFederationPreferredUsername(" 用户 @example.edu")).toBe("用户");
	});

	it("returns only the allowed custom claim set for userinfo and id tokens", () => {
		const claims = buildFederationProviderClaimSet({
			user: {
				createdAt: new Date("2026-06-01T00:00:00.000Z"),
				email: "Jane.Doe@example.edu",
				id: "user_01HQ",
				name: "Jane Doe",
				profileMemory: {
					enabled: true,
				},
				role: "internal_admin",
				updatedAt: new Date("2026-06-03T12:00:00.000Z"),
			},
		});

		expect(claims).toEqual({
			preferred_username: "jane.doe",
			updated_at: 1_780_488_000,
		});
		expect(claims).not.toHaveProperty("profileMemory");
		expect(claims).not.toHaveProperty("role");
		expect(claims).not.toHaveProperty("id");
		expect(claims).not.toHaveProperty("email");
	});

	it("fails closed when required OIDC claim source fields are missing", () => {
		expect(() =>
			buildFederationProviderClaimSet({
				user: {
					email: "",
					updatedAt: new Date("2026-06-03T12:00:00.000Z"),
				},
			}),
		).toThrow("Federation user email is required");
		expect(() =>
			buildFederationProviderClaimSet({
				user: {
					email: "jane@example.edu",
					updatedAt: null,
				},
			}),
		).toThrow("Federation user updatedAt is required");
	});
});
