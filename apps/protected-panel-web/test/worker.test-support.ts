import type { JWTPayload } from "jose";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { vi } from "vitest";

import type { OperatorQueryService } from "../../app-api/src/modules/operator-query";
import packageManifestRaw from "../package.json?raw";

export const packageManifest = JSON.parse(packageManifestRaw) as {
	dependencies?: Record<string, string | undefined>;
	scripts?: Record<string, string | undefined>;
};

export { createApp as createAppApi } from "../../app-api/src/app";
export { default as deployStagingSource } from "../scripts/deploy-staging.mjs?raw";
export { default as worker } from "../src/index";
export { default as viteConfigSource } from "../vite.config.ts?raw";
export { default as wranglerConfig } from "../wrangler.toml?raw";

export function createOperatorQueryServiceMock(
	overrides: Partial<OperatorQueryService> = {},
): OperatorQueryService {
	return {
		getById: vi.fn(),
		getObservabilityById: vi.fn(),
		getAuditById: vi.fn(),
		getOverview: vi.fn(),
		getQualitySummary: vi.fn(),
		getQualityTimeseries: vi.fn(),
		getSafetySummary: vi.fn(),
		listSafetyAnomalies: vi.fn(),
		getCostSummary: vi.fn(),
		getCostTimeseries: vi.fn(),
		list: vi.fn().mockResolvedValue({
			page: {
				nextCursor: null,
			},
			requests: [],
		}),
		listAudit: vi.fn(),
		listQualityBadcases: vi.fn(),
		listQualityEvalCandidates: vi.fn(),
		...overrides,
	};
}

export function createHtmlShellResponse() {
	return new Response('<!doctype html><html><body><div id="root"></div></body></html>', {
		headers: {
			"content-type": "text/html; charset=utf-8",
		},
		status: 200,
	});
}

export async function withAccessAssertion<T>(
	options: {
		accessTeamDomain: string;
		audience?: string;
		claims?: JWTPayload;
	},
	run: (token: string) => Promise<T>,
): Promise<T> {
	const { accessTeamDomain, audience = "panel-operator-audience", claims } = options;
	const originalFetch = globalThis.fetch;
	const certsUrl = `${accessTeamDomain}/cdn-cgi/access/certs`;
	const { privateKey, publicKey } = await generateKeyPair("ES256");
	const publicJwk = await exportJWK(publicKey);
	publicJwk.kid = "panel-test-key";
	const token = await new SignJWT(
		claims ?? {
			email: "ops@example.com",
			sub: "operator-001",
		},
	)
		.setProtectedHeader({ alg: "ES256", kid: "panel-test-key" })
		.setIssuer(accessTeamDomain)
		.setAudience(audience)
		.setIssuedAt()
		.setExpirationTime("5m")
		.sign(privateKey);

	globalThis.fetch = (async (request: Request | URL | string) => {
		const inbound = request instanceof Request ? request : new Request(request);
		if (inbound.url === certsUrl) {
			return new Response(JSON.stringify({ keys: [publicJwk] }), {
				status: 200,
				headers: {
					"content-type": "application/json",
				},
			});
		}

		throw new Error(`Unexpected fetch call: ${inbound.url}`);
	}) as typeof fetch;

	try {
		return await run(token);
	} finally {
		globalThis.fetch = originalFetch;
	}
}
