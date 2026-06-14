// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
	buildFederationJwksSecretCompatibilityReport,
	buildFederationRuntimeReadinessReportWithDatabase,
} from "../scripts/verify-federation-runtime-readiness";

describe("federation JWKS secret readiness", () => {
	it("marks empty JWKS storage as compatible because the provider will mint a current key", async () => {
		await expect(
			buildFederationJwksSecretCompatibilityReport({
				betterAuthSecret: "current-secret-current-secret-current-secret",
				rows: [],
			}),
		).resolves.toEqual({
			algorithmCompatible: true,
			checked: true,
			compatible: true,
			expectedAlg: "RS256",
			invalidAlgorithmKeyIds: [],
			invalidKeyIds: [],
			keyCount: 0,
			status: "no_jwks_present",
			validKeyIds: [],
		});
	});

	it("blocks route readiness when existing JWKS private keys cannot be decrypted by the active secret", async () => {
		const report = await buildFederationJwksSecretCompatibilityReport({
			betterAuthSecret: "current-secret-current-secret-current-secret",
			rows: [
				{
					id: "stale-key",
					privateKey: JSON.stringify("not-a-current-secret-ciphertext"),
					publicKey: JSON.stringify({ crv: "Ed25519", kty: "OKP", x: "public" }),
				},
			],
		});

		expect(report).toEqual({
			algorithmCompatible: true,
			checked: true,
			compatible: false,
			expectedAlg: "RS256",
			invalidAlgorithmKeyIds: [],
			invalidKeyIds: ["stale-key"],
			keyCount: 1,
			status: "jwks_secret_mismatch",
			validKeyIds: [],
		});
	});

	it("blocks route readiness when existing JWKS key material is not RSA for RS256", async () => {
		const { symmetricEncrypt } = await import("better-auth/crypto");
		const betterAuthSecret = "current-secret-current-secret-current-secret";
		const privateKey = await symmetricEncrypt({
			data: JSON.stringify({ crv: "Ed25519", d: "private", kty: "OKP", x: "public" }),
			key: betterAuthSecret,
		});

		const report = await buildFederationJwksSecretCompatibilityReport({
			betterAuthSecret,
			rows: [
				{
					id: "ed25519-key",
					privateKey: JSON.stringify(privateKey),
					publicKey: JSON.stringify({ crv: "Ed25519", kty: "OKP", x: "public" }),
				},
			],
		});

		expect(report).toEqual({
			algorithmCompatible: false,
			checked: true,
			compatible: false,
			expectedAlg: "RS256",
			invalidAlgorithmKeyIds: ["ed25519-key"],
			invalidKeyIds: [],
			keyCount: 1,
			status: "jwks_algorithm_mismatch",
			validKeyIds: ["ed25519-key"],
		});
	});

	it("accepts existing RSA JWKS key material for RS256", async () => {
		const { symmetricEncrypt } = await import("better-auth/crypto");
		const betterAuthSecret = "current-secret-current-secret-current-secret";
		const privateKey = await symmetricEncrypt({
			data: JSON.stringify({ d: "private", kty: "RSA" }),
			key: betterAuthSecret,
		});

		const report = await buildFederationJwksSecretCompatibilityReport({
			betterAuthSecret,
			rows: [
				{
					id: "rsa-key",
					privateKey: JSON.stringify(privateKey),
					publicKey: JSON.stringify({ e: "AQAB", kty: "RSA", n: "modulus" }),
				},
			],
		});

		expect(report).toEqual({
			algorithmCompatible: true,
			checked: true,
			compatible: true,
			expectedAlg: "RS256",
			invalidAlgorithmKeyIds: [],
			invalidKeyIds: [],
			keyCount: 1,
			status: "jwks_secret_compatible",
			validKeyIds: ["rsa-key"],
		});
	});

	it("includes JWKS secret compatibility in database-backed readiness", async () => {
		const report = await buildFederationRuntimeReadinessReportWithDatabase({
			betterAuthSecret: "current-secret-current-secret-current-secret",
			pool: {
				query: async () => ({
					rows: [
						{
							id: "stale-key",
							privateKey: JSON.stringify("not-a-current-secret-ciphertext"),
							publicKey: JSON.stringify({ crv: "Ed25519", kty: "OKP", x: "public" }),
						},
					],
				}),
			} as never,
		});

		expect(report.jwksSecretCompatibility).toMatchObject({
			compatible: false,
			invalidKeyIds: ["stale-key"],
			status: "jwks_secret_mismatch",
		});
		expect(report.status).toBe("blocked_before_route_exposure");
	});
});
