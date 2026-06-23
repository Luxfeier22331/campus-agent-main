#!/usr/bin/env node
import process from "node:process";
import { loadRepoStagingEnvFile } from "../../../scripts/load-repo-env.mjs";

const DEFAULT_BASE_URL = "https://panel-staging.mucwiki-edge.link";
const EXPECTED_OPERATOR_API_ERROR = "Invalid Access JWT.";

loadRepoStagingEnvFile(import.meta.url, "../../..");

function readRequiredEnv(name) {
	const value = process.env[name]?.trim();
	if (!value) {
		throw new Error(`${name} is required for operator-console staging Access service token smoke.`);
	}
	return value;
}

function resolveBaseUrl() {
	const raw = process.env.STAGING_OPERATOR_CONSOLE_BASE_URL?.trim() || DEFAULT_BASE_URL;
	const parsed = new URL(raw);
	if (parsed.protocol !== "https:") {
		throw new Error("STAGING_OPERATOR_CONSOLE_BASE_URL must use https.");
	}
	return parsed;
}

function summarizeBody(contentType, body) {
	if (contentType.includes("json") && body && typeof body === "object") {
		return {
			dependencies: body.dependencies ? Object.keys(body.dependencies).sort() : null,
			errorCode: body.error?.code ?? null,
			status: body.status ?? null,
		};
	}

	return {
		textPreview: typeof body === "string" ? body.slice(0, 120) : null,
	};
}

async function readResponseBody(response) {
	const contentType = response.headers.get("content-type") ?? "";
	if (contentType.includes("json")) {
		return response.json().catch(() => null);
	}
	return response.text().catch(() => "");
}

async function fetchPanel(input) {
	const url = new URL(input.path, input.baseUrl);
	const response = await fetch(url, {
		headers: input.headers,
		redirect: "manual",
		signal: AbortSignal.timeout(30_000),
	});
	const contentType = response.headers.get("content-type") ?? "";
	const body = await readResponseBody(response);
	return {
		body,
		contentType,
		location: response.headers.get("location") ?? "",
		status: response.status,
		url: url.toString(),
	};
}

function assertAccessRedirect(result) {
	if (result.status !== 302) {
		throw new Error(
			`Unauthenticated readyz expected Access redirect 302, received ${result.status}.`,
		);
	}
	const location = result.location ? new URL(result.location) : null;
	if (!location?.hostname.endsWith("cloudflareaccess.com")) {
		throw new Error("Unauthenticated readyz must redirect to Cloudflare Access.");
	}
}

function assertJsonReady(result, label, expectedStatus) {
	if (result.status !== expectedStatus) {
		throw new Error(`${label} expected ${expectedStatus}, received ${result.status}.`);
	}
	if (!result.contentType.includes("json")) {
		throw new Error(`${label} must return JSON.`);
	}
}

function assertServiceTokenIsNotOperator(result) {
	if (result.status !== 401) {
		throw new Error(`Service token operator API smoke expected 401, received ${result.status}.`);
	}
	const message = typeof result.body === "string" ? result.body.trim() : "";
	if (message !== EXPECTED_OPERATOR_API_ERROR) {
		throw new Error(`Service token operator API smoke expected ${EXPECTED_OPERATOR_API_ERROR}`);
	}
}

async function main() {
	const baseUrl = resolveBaseUrl();
	const serviceTokenHeaders = {
		accept: "application/json",
		"CF-Access-Client-Id": readRequiredEnv("STAGING_OPERATOR_CONSOLE_ACCESS_CLIENT_ID"),
		"CF-Access-Client-Secret": readRequiredEnv("STAGING_OPERATOR_CONSOLE_ACCESS_CLIENT_SECRET"),
	};

	const unauthenticatedReadyz = await fetchPanel({
		baseUrl,
		headers: { accept: "application/json" },
		path: "/readyz",
	});
	assertAccessRedirect(unauthenticatedReadyz);

	const healthz = await fetchPanel({
		baseUrl,
		headers: serviceTokenHeaders,
		path: "/healthz",
	});
	assertJsonReady(healthz, "Service-token healthz", 200);

	const readyz = await fetchPanel({
		baseUrl,
		headers: serviceTokenHeaders,
		path: "/readyz",
	});
	assertJsonReady(readyz, "Service-token readyz", 200);

	const operatorApi = await fetchPanel({
		baseUrl,
		headers: serviceTokenHeaders,
		path: "/api/overview",
	});
	assertServiceTokenIsNotOperator(operatorApi);

	console.log(
		JSON.stringify(
			{
				baseUrl: baseUrl.toString(),
				checks: {
					serviceTokenDoesNotGrantLocalOperatorAdmission: {
						status: operatorApi.status,
					},
					serviceTokenHealthz: {
						...summarizeBody(healthz.contentType, healthz.body),
						statusCode: healthz.status,
					},
					serviceTokenReadyz: {
						...summarizeBody(readyz.contentType, readyz.body),
						statusCode: readyz.status,
					},
					unauthenticatedReadyz: {
						locationHost: new URL(unauthenticatedReadyz.location).hostname,
						status: unauthenticatedReadyz.status,
					},
				},
				surface: "operator-console-web",
			},
			null,
			2,
		),
	);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
