import process from "node:process";

import { readJsonResponse } from "./support/smoke-auth-runtime";
import {
	parseStagingDocsGatedSmokeArgs,
	resolveStagingDocsGatedSmokeTargets,
} from "./support/staging-docs-gated-smoke.args";
import { fetchReadyz, signInE2eIdentity } from "./support/staging-smoke-support";

function buildGatedReaderUrl(input: { docsBaseUrl: string; gatedReaderPath: string }): string {
	return new URL(input.gatedReaderPath, input.docsBaseUrl).toString();
}

function buildGatedCollectionNavigationUrl(input: {
	docsBaseUrl: string;
	gatedCollectionNavigationPath: string;
}): string {
	return new URL(input.gatedCollectionNavigationPath, input.docsBaseUrl).toString();
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

async function fetchDocsJson(input: {
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

function assertExpectedGatedNavigationResponse(input: {
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
	if (input.expectedStatus !== 200) {
		return;
	}

	const navigation = input.body as {
		nodes?: Array<{
			canonicalUrl?: unknown;
			title?: unknown;
		}>;
	};
	if (!Array.isArray(navigation.nodes) || navigation.nodes.length === 0) {
		throw new Error(`${input.label} must include at least one navigation node.`);
	}
	for (const [index, node] of navigation.nodes.entries()) {
		if (typeof node.title !== "string" || node.title.trim().length === 0) {
			throw new Error(`${input.label} node ${index} must include a non-empty title.`);
		}
		if (typeof node.canonicalUrl !== "string" || !node.canonicalUrl.startsWith("/docs/")) {
			throw new Error(`${input.label} node ${index} must include a docs canonicalUrl.`);
		}
	}

	const serialized = JSON.stringify(input.body);
	for (const forbidden of [
		"/_gated-docs/",
		"sourceObjects",
		"source_objects",
		"rawSourceLocator",
		"raw_source_locator",
		"reader-assets/",
		"s3://",
	]) {
		if (serialized.includes(forbidden)) {
			throw new Error(`${input.label} must not leak storage or gated asset locator ${forbidden}.`);
		}
	}
}

export async function main(argv: string[]) {
	const args = resolveStagingDocsGatedSmokeTargets(parseStagingDocsGatedSmokeArgs(argv));
	const gatedReaderUrl = buildGatedReaderUrl(args);
	const gatedCollectionNavigationUrl = buildGatedCollectionNavigationUrl(args);
	const cookieHeader = await signInE2eIdentity({
		captchaToken: args.captchaToken,
		chatBaseUrl: args.chatBaseUrl,
		email: args.email,
		password: args.password,
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
	const unauthenticatedNavigation = await fetchDocsJson({
		url: gatedCollectionNavigationUrl,
	});
	assertExpectedGatedNavigationResponse({
		body: unauthenticatedNavigation.body,
		expectedStatus: args.gatedCollectionNavigationUnauthenticatedStatus,
		label: "Unauthenticated gated collection navigation request",
		response: unauthenticatedNavigation.response,
	});
	const authorizedNavigation = await fetchDocsJson({
		cookieHeader,
		url: gatedCollectionNavigationUrl,
	});
	assertExpectedGatedNavigationResponse({
		body: authorizedNavigation.body,
		expectedStatus: 200,
		label: "Authorized gated collection navigation request",
		response: authorizedNavigation.response,
	});

	console.log(
		JSON.stringify(
			{
				gatedCollectionNavigation: {
					authorizedStatus: authorizedNavigation.response.status,
					contentType: authorizedNavigation.response.headers.get("content-type") ?? "",
					nodeCount: Array.isArray((authorizedNavigation.body as { nodes?: unknown } | null)?.nodes)
						? ((authorizedNavigation.body as { nodes: unknown[] }).nodes.length ?? 0)
						: 0,
					unauthenticatedStatus: unauthenticatedNavigation.response.status,
					url: gatedCollectionNavigationUrl,
				},
				gatedReader: {
					authorizedStatus: authorized.response.status,
					contentType: authorized.response.headers.get("content-type") ?? "",
					unauthenticatedStatus: unauthenticated.response.status,
					url: gatedReaderUrl,
				},
				identity: {
					email: args.email,
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
