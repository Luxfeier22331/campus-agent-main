// @vitest-environment node

import type { JWTPayload } from "jose";
import { CompactSign, exportJWK, generateKeyPair } from "jose";
import { afterEach, describe, expect, it } from "vitest";
import {
	createOpsAdmissionFromEnv,
	getMissingAccessConfig,
	normalizeConfiguredAccessPolicyAud,
	normalizeConfiguredAccessTeamDomain,
	validateCloudflareAccessRequest,
} from "../src/server/ops-admission";

const ACCESS_TEAM_DOMAIN = "https://team-ops-web.cloudflareaccess.com";
const ACCESS_POLICY_AUD = "ops-web-test-audience";
const signingKeyPair = generateAccessSigningKeyPair();
const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("ops admission", () => {
	it.each([
		"local",
		"development",
	])("uses a local operator in the %s deployment environment", async (deploymentEnvironment) => {
		const admission = createOpsAdmissionFromEnv({
			DEPLOYMENT_ENVIRONMENT: deploymentEnvironment,
		});
		const result = await admission.admit(new Request("http://127.0.0.1/api"));

		expect(result.response).toBeNull();
		expect(result.operator).toMatchObject({
			displayName: "Local Operator",
			email: "local@localhost",
			operatorId: "local",
			subject: "local",
		});
	});

	it.each([
		undefined,
		"staging",
		"production",
	])("keeps Cloudflare Access enabled outside local development (%s)", async (deploymentEnvironment) => {
		const admission = createOpsAdmissionFromEnv({
			DEPLOYMENT_ENVIRONMENT: deploymentEnvironment,
		});
		const result = await admission.admit(new Request("https://ops.example/api"));

		expect(result.operator).toBeNull();
		expect(result.response?.status).toBe(503);
	});

	it("requires only the Cloudflare Access issuer and audience", () => {
		expect(getMissingAccessConfig({})).toEqual(["ACCESS_TEAM_DOMAIN", "ACCESS_POLICY_AUD"]);
		expect(getMissingAccessConfig({ ACCESS_POLICY_AUD, ACCESS_TEAM_DOMAIN })).toEqual([]);
		expect(normalizeConfiguredAccessTeamDomain(`${ACCESS_TEAM_DOMAIN}/anything`)).toBe(
			ACCESS_TEAM_DOMAIN,
		);
		expect(normalizeConfiguredAccessTeamDomain("https://team.cloudflareaccess.com")).toBeNull();
		expect(normalizeConfiguredAccessPolicyAud("ops-web-audience")).toBeNull();
	});

	it("rejects protected requests without Access JWT", async () => {
		const result = await validateCloudflareAccessRequest(new Request("https://ops.example/api"), {
			ACCESS_POLICY_AUD,
			ACCESS_TEAM_DOMAIN,
		});
		expect(result.operator).toBeNull();
		expect(result.response?.status).toBe(401);
	});

	it("admits a person selected by the Cloudflare Access application policy", async () => {
		await withAccessAssertion(async (token) => {
			const result = await validateCloudflareAccessRequest(
				new Request("https://ops.example/api", {
					headers: { "cf-access-jwt-assertion": token },
				}),
				{ ACCESS_POLICY_AUD, ACCESS_TEAM_DOMAIN },
			);
			expect(result.response).toBeNull();
			expect(result.operator).toMatchObject({
				email: "ops@example.com",
				operatorId: "ops@example.com",
				subject: "operator-001",
			});
		});
	});

	it("rejects Access service tokens", async () => {
		await withAccessAssertion(
			async (token) => {
				const result = await validateCloudflareAccessRequest(
					new Request("https://ops.example/api", {
						headers: { cookie: `CF_Authorization=${token}` },
					}),
					{ ACCESS_POLICY_AUD, ACCESS_TEAM_DOMAIN },
				);
				expect(result.operator).toBeNull();
				expect(result.response?.status).toBe(401);
			},
			{ common_name: "ops-web-smoke.access", sub: "", type: "app" },
		);
	});
});

async function withAccessAssertion(run: (token: string) => Promise<void>, claims?: JWTPayload) {
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
				...(claims ?? { email: "ops@example.com", sub: "operator-001" }),
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
