import process from "node:process";

import { readJsonResponse } from "./smoke-auth-runtime";
import { parseStagingDocsGatedSmokeArgs } from "./staging-docs-gated-smoke.args";
import { buildSmokePassword, fetchReadyz, mintStagingSmokeSession } from "./staging-smoke-support";

function buildGatedReaderUrl(input: { docsBaseUrl: string; gatedReaderPath: string }): string {
	return new URL(input.gatedReaderPath, input.docsBaseUrl).toString();
}

function headerContainsToken(headerValue: string | null, expectedToken: string): boolean {
	const normalizedExpected = expectedToken.toLowerCase();
	return (headerValue ?? "")
		.split(",")
		.map((value) => value.trim().toLowerCase())
		.includes(normalizedExpected);
}

function assertNoStore(response: Response, label: string): void {
	const cacheControl = response.headers.get("cache-control") ?? "";
	if (
		!cacheControl
			.toLowerCase()
			.split(",")
			.map((value) => value.trim())
			.includes("no-store")
	) {
		throw new Error(`${label} must include Cache-Control: no-store.`);
	}
}

function assertVaryAuth(response: Response, label: string): void {
	const vary = response.headers.get("vary");
	if (!(headerContainsToken(vary, "Cookie") && headerContainsToken(vary, "Authorization"))) {
		throw new Error(`${label} must include Vary: Cookie, Authorization.`);
	}
}

async function fetchGatedReader(input: {
	cookieHeader?: string;
	url: string;
}): Promise<{ body: unknown; response: Response }> {
	const response = await fetch(input.url, {
		headers: {
			accept: "application/json",
			...(input.cookieHeader ? { cookie: input.cookieHeader } : {}),
		},
		method: "GET",
		signal: AbortSignal.timeout(30_000),
	});
	return {
		body: await readJsonResponse(response),
		response,
	};
}

function assertExpectedGatedResponse(input: {
	body: unknown;
	expectedStatus: number;
	label: string;
	response: Response;
}): void {
	if (input.response.status !== input.expectedStatus) {
		throw new Error(
			`${input.label} expected ${input.expectedStatus}, received ${input.response.status}: ${JSON.stringify(input.body)}`,
		);
	}
	assertNoStore(input.response, input.label);
	assertVaryAuth(input.response, input.label);
}

export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env) {
	const args = parseStagingDocsGatedSmokeArgs(argv, env);
	const gatedReaderUrl = buildGatedReaderUrl(args);
	const smokePassword = buildSmokePassword();
	const cookieHeader = await mintStagingSmokeSession({
		appApiReadyzUrl: args.appApiReadyzUrl,
		email: args.email,
		name: args.name,
		password: smokePassword,
		resetIdentity: true,
		smokeAuthSecret: args.smokeAuthSecret,
	});

	const appApiReadyz = await fetchReadyz(args.appApiReadyzUrl);
	const docsReadyzUrl = new URL("/readyz", args.docsBaseUrl).toString();
	const docsReadyz = await fetchReadyz(docsReadyzUrl);
	const unauthenticated = await fetchGatedReader({ url: gatedReaderUrl });
	assertExpectedGatedResponse({
		body: unauthenticated.body,
		expectedStatus: 404,
		label: "Unauthenticated gated reader request",
		response: unauthenticated.response,
	});
	const authorized = await fetchGatedReader({
		cookieHeader,
		url: gatedReaderUrl,
	});
	assertExpectedGatedResponse({
		body: authorized.body,
		expectedStatus: 200,
		label: "Authorized gated reader request",
		response: authorized.response,
	});

	console.log(
		JSON.stringify(
			{
				gatedReader: {
					authorizedStatus: authorized.response.status,
					contentType: authorized.response.headers.get("content-type") ?? "",
					unauthenticatedStatus: unauthenticated.response.status,
					url: gatedReaderUrl,
				},
				identity: {
					email: args.email,
					resetViaDeployedRuntime: true,
				},
				surfaceChecks: {
					appApiReadyz: {
						status: appApiReadyz.status,
						url: args.appApiReadyzUrl,
					},
					docsReadyz: {
						status: docsReadyz.status,
						url: docsReadyzUrl,
					},
				},
			},
			null,
			2,
		),
	);
}

void main(process.argv.slice(2)).catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
