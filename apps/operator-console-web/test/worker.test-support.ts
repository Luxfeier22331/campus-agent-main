import type { JWTPayload } from "jose";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import packageManifestRaw from "../package.json?raw";

export const packageManifest = JSON.parse(packageManifestRaw) as {
	dependencies?: Record<string, string | undefined>;
	devDependencies?: Record<string, string | undefined>;
	scripts?: Record<string, string | undefined>;
};

export { default as stagingAccessServiceTokenSmokeSource } from "../e2e/staging-access-service-token.ts?raw";
export { default as stagingBrowserE2ESource } from "../e2e/staging-browser.ts?raw";
export { default as localAccessSmokeServerSource } from "../e2e/support/local-access-server.ts?raw";
export { default as stagingPreflightSource } from "../scripts/preflight-staging.ts?raw";
export { default as uploadStagingVersionSource } from "../scripts/upload-staging-version.ts?raw";
export { default as worker } from "../src/index";
export { default as viteConfigSource } from "../vite.config.ts?raw";
export { default as wranglerLocalSmokeConfig } from "../wrangler.local-smoke.toml?raw";
export { default as wranglerConfig } from "../wrangler.toml?raw";

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
	const { accessTeamDomain, audience = "operator-console-test-audience", claims } = options;
	const originalFetch = globalThis.fetch;
	const certsUrl = `${accessTeamDomain}/cdn-cgi/access/certs`;
	const { privateKey, publicKey } = await generateKeyPair("ES256");
	const publicJwk = await exportJWK(publicKey);
	publicJwk.kid = "operator-console-test-key";
	const token = await new SignJWT(
		claims ?? {
			email: "ops@example.com",
			sub: "operator-001",
		},
	)
		.setProtectedHeader({ alg: "ES256", kid: "operator-console-test-key" })
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
