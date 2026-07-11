// @vitest-environment node

import type { JWTPayload } from "jose";
import { CompactSign, exportJWK, generateKeyPair } from "jose";
import { afterEach, describe, expect, it } from "vitest";
import {
	getMissingAccessConfig,
	normalizeConfiguredAccessPolicyAud,
	normalizeConfiguredAccessTeamDomain,
	operatorCanReadRawObservability,
	validateCloudflareAccessRequest,
} from "../src/server/ops-admission";

const ACCESS_TEAM_DOMAIN = "https://team-ops-web.cloudflareaccess.com";
const ACCESS_POLICY_AUD = "ops-web-test-audience";
const signingKeyPair = generateAccessSigningKeyPair();

afterEach(() => {
	globalThis.fetch = originalFetch;
});

const originalFetch = globalThis.fetch;

describe("ops admission", () => {
	it("normalizes configured Cloudflare Access settings", () => {
		expect(normalizeConfiguredAccessTeamDomain(`${ACCESS_TEAM_DOMAIN}/anything`)).toBe(
			ACCESS_TEAM_DOMAIN,
		);
		expect(normalizeConfiguredAccessTeamDomain("https://team.cloudflareaccess.com")).toBeNull();
		expect(normalizeConfiguredAccessPolicyAud(ACCESS_POLICY_AUD)).toBe(ACCESS_POLICY_AUD);
		expect(normalizeConfiguredAccessPolicyAud("ops-web-audience")).toBeNull();
	});

	it("reports missing protection configuration", () => {
		expect(getMissingAccessConfig({})).toEqual([
			"OPS_WEB_PROTECTION_ENVELOPE=cloudflare-access",
			"ACCESS_TEAM_DOMAIN",
			"ACCESS_POLICY_AUD",
			"one of OPS_WEB_ACCESS_HUMAN_OPERATOR_EMAIL_ALLOWLIST, OPS_WEB_ACCESS_SERVICE_TOKEN_OPERATOR_ALLOWLIST",
		]);
	});

	it("rejects protected requests without Access JWT", async () => {
		const result = await validateCloudflareAccessRequest(new Request("https://ops.example/api"), {
			ACCESS_POLICY_AUD,
			ACCESS_TEAM_DOMAIN,
			OPS_WEB_ACCESS_HUMAN_OPERATOR_EMAIL_ALLOWLIST: "ops@example.com",
			OPS_WEB_PROTECTION_ENVELOPE: "cloudflare-access",
		});

		expect(result.operator).toBeNull();
		expect(result.response?.status).toBe(401);
		await expect(result.response?.json()).resolves.toMatchObject({
			error: { code: "OPS_ACCESS_JWT_MISSING" },
		});
	});

	it("admits human operators from the Access assertion header", async () => {
		await withAccessAssertion(async (token) => {
			const result = await validateCloudflareAccessRequest(
				new Request("https://ops.example/api", {
					headers: { "cf-access-jwt-assertion": token },
				}),
				{
					ACCESS_POLICY_AUD,
					ACCESS_TEAM_DOMAIN,
					OPS_WEB_ACCESS_HUMAN_OPERATOR_EMAIL_ALLOWLIST: "ops@example.com",
					OPS_WEB_PROTECTION_ENVELOPE: "cloudflare-access",
				},
			);

			expect(result.response).toBeNull();
			expect(result.operator).toMatchObject({
				email: "ops@example.com",
				operatorId: "ops@example.com",
				principalClass: "human",
				subject: "operator-001",
			});
		});
	});

	it("rejects human operators unless an email or group allowlist admits them", async () => {
		await withAccessAssertion(
			async (token) => {
				const baseEnv = {
					ACCESS_POLICY_AUD,
					ACCESS_TEAM_DOMAIN,
					OPS_WEB_ACCESS_HUMAN_OPERATOR_EMAIL_ALLOWLIST: "other@example.com",
					OPS_WEB_PROTECTION_ENVELOPE: "cloudflare-access",
				};

				const rejected = await validateCloudflareAccessRequest(
					new Request("https://ops.example/api", {
						headers: { "cf-access-jwt-assertion": token },
					}),
					baseEnv,
				);
				expect(rejected.operator).toBeNull();
				expect(rejected.response?.status).toBe(401);
				await expect(rejected.response?.json()).resolves.toMatchObject({
					error: { code: "OPS_ACCESS_JWT_INVALID" },
				});

				const allowedByEmail = await validateCloudflareAccessRequest(
					new Request("https://ops.example/api", {
						headers: { "cf-access-jwt-assertion": token },
					}),
					{
						...baseEnv,
						OPS_WEB_ACCESS_HUMAN_OPERATOR_EMAIL_ALLOWLIST: "ops@example.com",
					},
				);
				expect(allowedByEmail.response).toBeNull();
				expect(allowedByEmail.operator?.operatorId).toBe("ops@example.com");

				const allowedByGroup = await validateCloudflareAccessRequest(
					new Request("https://ops.example/api", {
						headers: { "cf-access-jwt-assertion": token },
					}),
					{
						...baseEnv,
						OPS_WEB_ACCESS_HUMAN_OPERATOR_GROUP_ALLOWLIST: "ops-admins",
					},
				);
				expect(allowedByGroup.response).toBeNull();
				expect(allowedByGroup.operator?.groups).toContain("ops-admins");
			},
			{
				custom: { groups: ["ops-admins"] },
				email: "ops@example.com",
				sub: "operator-001",
			},
		);
	});

	it("does not treat a group-only origin allowlist as reliable admission configuration", () => {
		expect(
			getMissingAccessConfig({
				ACCESS_POLICY_AUD,
				ACCESS_TEAM_DOMAIN,
				OPS_WEB_ACCESS_HUMAN_OPERATOR_GROUP_ALLOWLIST: "ops-admins",
				OPS_WEB_PROTECTION_ENVELOPE: "cloudflare-access",
			}),
		).toEqual([
			"one of OPS_WEB_ACCESS_HUMAN_OPERATOR_EMAIL_ALLOWLIST, OPS_WEB_ACCESS_SERVICE_TOKEN_OPERATOR_ALLOWLIST",
		]);
	});

	it("reports missing operator allowlist as admission misconfiguration", async () => {
		const result = await validateCloudflareAccessRequest(new Request("https://ops.example/api"), {
			ACCESS_POLICY_AUD,
			ACCESS_TEAM_DOMAIN,
			OPS_WEB_PROTECTION_ENVELOPE: "cloudflare-access",
		});

		expect(result.operator).toBeNull();
		expect(result.response?.status).toBe(503);
		await expect(result.response?.json()).resolves.toMatchObject({
			error: {
				code: "OPS_ADMISSION_NOT_CONFIGURED",
				details: {
					missing: [
						"one of OPS_WEB_ACCESS_HUMAN_OPERATOR_EMAIL_ALLOWLIST, OPS_WEB_ACCESS_SERVICE_TOKEN_OPERATOR_ALLOWLIST",
					],
				},
			},
		});
	});

	it("admits allowed Access service tokens from the Access cookie", async () => {
		await withAccessAssertion(
			async (token) => {
				const result = await validateCloudflareAccessRequest(
					new Request("https://ops.example/api", {
						headers: { cookie: `CF_Authorization=${token}` },
					}),
					{
						ACCESS_POLICY_AUD,
						ACCESS_TEAM_DOMAIN,
						OPS_WEB_ACCESS_SERVICE_TOKEN_OPERATOR_ALLOWLIST: "ops-web-staging-smoke",
						OPS_WEB_PROTECTION_ENVELOPE: "cloudflare-access",
					},
				);

				expect(result.response).toBeNull();
				expect(result.operator).toMatchObject({
					operatorId: "ops-web-staging-smoke",
					principalClass: "service",
					serviceId: "ops-web-staging-smoke",
				});
			},
			{
				common_name: "ops-web-staging-smoke.access",
				sub: "",
				type: "app",
			},
		);
	});

	it("rejects allowlisted common_name claims that are not Access service tokens", async () => {
		await withAccessAssertion(
			async (token) => {
				const result = await validateCloudflareAccessRequest(
					new Request("https://ops.example/api", {
						headers: { "cf-access-jwt-assertion": token },
					}),
					{
						ACCESS_POLICY_AUD,
						ACCESS_TEAM_DOMAIN,
						OPS_WEB_ACCESS_SERVICE_TOKEN_OPERATOR_ALLOWLIST: "ops-web-staging-smoke",
						OPS_WEB_PROTECTION_ENVELOPE: "cloudflare-access",
					},
				);

				expect(result.operator).toBeNull();
				expect(result.response?.status).toBe(401);
				await expect(result.response?.json()).resolves.toMatchObject({
					error: { code: "OPS_ACCESS_JWT_INVALID" },
				});
			},
			{
				common_name: "ops-web-staging-smoke.access",
				sub: "operator-001",
				type: "user",
			},
		);
	});

	it("rejects service tokens that are not explicitly allowed", async () => {
		await withAccessAssertion(
			async (token) => {
				const result = await validateCloudflareAccessRequest(
					new Request("https://ops.example/api", {
						headers: { "cf-access-jwt-assertion": token },
					}),
					{
						ACCESS_POLICY_AUD,
						ACCESS_TEAM_DOMAIN,
						OPS_WEB_ACCESS_SERVICE_TOKEN_OPERATOR_ALLOWLIST: "another-service",
						OPS_WEB_PROTECTION_ENVELOPE: "cloudflare-access",
					},
				);

				expect(result.operator).toBeNull();
				expect(result.response?.status).toBe(401);
				await expect(result.response?.json()).resolves.toMatchObject({
					error: { code: "OPS_ACCESS_JWT_INVALID" },
				});
			},
			{
				common_name: "ops-web-staging-smoke.access",
				sub: "",
				type: "app",
			},
		);
	});

	it("keeps raw observability read permission separate from summary admission", () => {
		expect(
			operatorCanReadRawObservability(
				{
					displayName: "Ops",
					email: "ops@example.com",
					groups: ["ops-readers"],
					operatorId: "ops@example.com",
					principalClass: "human",
					serviceId: null,
					subject: "operator-001",
				},
				{},
			),
		).toBe(false);
		expect(
			operatorCanReadRawObservability(
				{
					displayName: "Ops",
					email: "ops@example.com",
					groups: ["ops-readers"],
					operatorId: "ops@example.com",
					principalClass: "human",
					serviceId: null,
					subject: "operator-001",
				},
				{ OPS_WEB_RAW_HUMAN_OPERATOR_GROUP_ALLOWLIST: "ops-readers" },
			),
		).toBe(true);
		expect(
			operatorCanReadRawObservability(
				{
					displayName: "ops-web-staging-smoke",
					email: null,
					groups: [],
					operatorId: "ops-web-staging-smoke",
					principalClass: "service",
					serviceId: "ops-web-staging-smoke",
					subject: "ops-web-staging-smoke",
				},
				{ OPS_WEB_RAW_SERVICE_TOKEN_OPERATOR_ALLOWLIST: "ops-web-staging-smoke" },
			),
		).toBe(true);
	});
});

async function withAccessAssertion(
	run: (token: string) => Promise<void>,
	claims?: JWTPayload,
): Promise<void> {
	const certsUrl = `${ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`;
	const { privateKey, publicJwk } = await signingKeyPair;
	const now = Math.floor(Date.now() / 1000);
	const token = await new CompactSign(
		new TextEncoder().encode(
			JSON.stringify({
				aud: ACCESS_POLICY_AUD,
				exp: now + 300,
				iat: now,
				iss: ACCESS_TEAM_DOMAIN,
				...(claims ?? {
					email: "ops@example.com",
					sub: "operator-001",
				}),
			}),
		),
	)
		.setProtectedHeader({ alg: "ES256", kid: "ops-web-test-key" })
		.sign(privateKey);

	globalThis.fetch = (async (request: Request | URL | string) => {
		const inbound = request instanceof Request ? request : new Request(request);
		if (inbound.url === certsUrl) {
			return new Response(JSON.stringify({ keys: [publicJwk] }), {
				headers: { "content-type": "application/json" },
				status: 200,
			});
		}
		throw new Error(`Unexpected fetch call: ${inbound.url}`);
	}) as typeof fetch;

	await run(token);
}

async function generateAccessSigningKeyPair() {
	const { privateKey, publicKey } = await generateKeyPair("ES256");
	const publicJwk = await exportJWK(publicKey);
	publicJwk.kid = "ops-web-test-key";
	return { privateKey, publicJwk };
}
