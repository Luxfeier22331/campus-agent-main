import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_HUB_BASE_URL = "https://hub-staging.mucwiki-edge.link";
const DEFAULT_APP_API_READYZ_URL = "https://api-staging.mucwiki-edge.link/readyz";
const DEFAULT_CLIENT_ID = "muc-wiki";
const DEFAULT_REDIRECT_URI = "https://wiki.mucwiki-edge.link/wiki/Special:PluggableAuthLogin";
const DEFAULT_POST_LOGOUT_REDIRECT_URI = "https://wiki.mucwiki-edge.link/wiki/Special:UserLogout";
const DEFAULT_SMOKE_EMAIL = "help_bot@outlook.com";
const DEFAULT_SMOKE_NAME = "Campus Agent Federation Smoke";
const EXPECTED_HUB_ORIGIN = "https://hub-staging.mucwiki-edge.link";
const EXPECTED_APP_API_ORIGIN = "https://api-staging.mucwiki-edge.link";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../..");

function normalizeOptionalValue(value) {
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function readArgValue(argv, flag) {
	const index = argv.indexOf(flag);
	if (index === -1) {
		return null;
	}
	return normalizeOptionalValue(argv[index + 1]);
}

function requireAbsoluteUrl(value, label) {
	const parsed = new URL(value);
	if (!(parsed.protocol === "https:" && parsed.hostname)) {
		throw new Error(`${label} must be an absolute https URL.`);
	}
	return parsed.toString();
}

function assertStagingOrigin(url, expectedOrigin, label) {
	if (url.origin !== expectedOrigin) {
		throw new Error(`${label} staging smoke requires ${expectedOrigin}; received ${url.origin}.`);
	}
}

function parseArgs(argv, env = process.env) {
	const hubUrl = new URL(
		readArgValue(argv, "--hub-base-url") ??
			normalizeOptionalValue(env.HUB_STAGING_BASE_URL) ??
			DEFAULT_HUB_BASE_URL,
	);
	const appApiReadyz = new URL(
		readArgValue(argv, "--app-api-readyz-url") ??
			normalizeOptionalValue(env.APP_API_STAGING_READYZ_URL) ??
			DEFAULT_APP_API_READYZ_URL,
	);
	assertStagingOrigin(hubUrl, EXPECTED_HUB_ORIGIN, "hub");
	assertStagingOrigin(appApiReadyz, EXPECTED_APP_API_ORIGIN, "app-api");

	const smokeAuthSecret =
		readArgValue(argv, "--smoke-auth-secret") ??
		normalizeOptionalValue(env.APP_API_STAGING_SMOKE_AUTH_SECRET) ??
		normalizeOptionalValue(env.STAGING_APP_API_SMOKE_AUTH_SECRET);
	if (!smokeAuthSecret) {
		throw new Error(
			"APP_API_STAGING_SMOKE_AUTH_SECRET or STAGING_APP_API_SMOKE_AUTH_SECRET is required.",
		);
	}

	const clientSecret =
		readArgValue(argv, "--client-secret") ??
		normalizeOptionalValue(env.APP_API_FEDERATION_MUC_WIKI_CLIENT_SECRET);
	if (!clientSecret) {
		throw new Error("APP_API_FEDERATION_MUC_WIKI_CLIENT_SECRET is required.");
	}

	const email =
		readArgValue(argv, "--email") ??
		normalizeOptionalValue(env.APP_API_STAGING_SMOKE_EMAIL) ??
		DEFAULT_SMOKE_EMAIL;
	const name =
		readArgValue(argv, "--name") ??
		normalizeOptionalValue(env.APP_API_STAGING_SMOKE_NAME) ??
		DEFAULT_SMOKE_NAME;
	const artifactDir =
		readArgValue(argv, "--artifact-dir") ??
		normalizeOptionalValue(env.IDENTITY_ACCEPTANCE_ARTIFACT_DIR);

	return {
		appApiReadyzUrl: appApiReadyz.toString(),
		artifactDir: artifactDir
			? resolve(repoRoot, artifactDir)
			: resolve(repoRoot, ".tmp/identity-acceptance"),
		clientId: readArgValue(argv, "--client-id") ?? DEFAULT_CLIENT_ID,
		clientSecret,
		email: email.toLowerCase(),
		hubBaseUrl: hubUrl.origin,
		name,
		postLogoutRedirectUri: requireAbsoluteUrl(
			readArgValue(argv, "--post-logout-redirect-uri") ??
				normalizeOptionalValue(env.APP_API_FEDERATION_MUC_WIKI_POST_LOGOUT_REDIRECT_URI) ??
				DEFAULT_POST_LOGOUT_REDIRECT_URI,
			"post logout redirect URI",
		),
		redirectUri: requireAbsoluteUrl(
			readArgValue(argv, "--redirect-uri") ??
				normalizeOptionalValue(env.APP_API_FEDERATION_MUC_WIKI_REDIRECT_URI) ??
				DEFAULT_REDIRECT_URI,
			"redirect URI",
		),
		smokeAuthSecret,
	};
}

function base64BasicCredential(input) {
	return Buffer.from(input).toString("base64");
}

function buildPkcePair() {
	const verifier = randomBytes(32).toString("base64url");
	return {
		challenge: createHash("sha256").update(verifier).digest("base64url"),
		verifier,
	};
}

function buildSmokePassword() {
	return `SmokePass!${randomBytes(12).toString("base64url")}`;
}

async function readJsonResponse(response, label) {
	const text = await response.text();
	if (!text) {
		throw new Error(`${label} returned an empty body.`);
	}
	try {
		return JSON.parse(text);
	} catch {
		throw new Error(`${label} returned non-JSON body: ${text.slice(0, 500)}`);
	}
}

async function expectJsonStatus(url, expectedStatus, label) {
	const response = await fetch(url, {
		headers: {
			accept: "application/json",
		},
		redirect: "manual",
		signal: AbortSignal.timeout(30_000),
	});
	if (response.status !== expectedStatus) {
		const text = await response.text();
		throw new Error(`${label} expected ${expectedStatus}, received ${response.status}: ${text}`);
	}
	return readJsonResponse(response, label);
}

async function expectStatus(url, expectedStatus, label) {
	const response = await fetch(url, {
		headers: {
			accept: "application/json",
		},
		redirect: "manual",
		signal: AbortSignal.timeout(30_000),
	});
	if (response.status !== expectedStatus) {
		const text = await response.text();
		throw new Error(`${label} expected ${expectedStatus}, received ${response.status}: ${text}`);
	}
	return response;
}

async function assertDiscovery(args) {
	const metadata = await expectJsonStatus(
		new URL("/.well-known/openid-configuration", args.hubBaseUrl).toString(),
		200,
		"openid discovery",
	);
	const expected = {
		authorization_endpoint: `${args.hubBaseUrl}/api/federation/authorize`,
		end_session_endpoint: `${args.hubBaseUrl}/api/federation/logout`,
		issuer: args.hubBaseUrl,
		jwks_uri: `${args.hubBaseUrl}/api/federation/jwks`,
		token_endpoint: `${args.hubBaseUrl}/api/federation/token`,
		userinfo_endpoint: `${args.hubBaseUrl}/api/federation/userinfo`,
	};
	for (const [field, value] of Object.entries(expected)) {
		if (metadata[field] !== value) {
			throw new Error(`${field} mismatch: expected ${value}, received ${metadata[field]}`);
		}
	}
	for (const claim of [
		"sub",
		"email",
		"email_verified",
		"name",
		"preferred_username",
		"updated_at",
	]) {
		if (!metadata.claims_supported?.includes(claim)) {
			throw new Error(`openid discovery is missing supported claim: ${claim}`);
		}
	}
	return metadata;
}

async function assertJwks(args) {
	const jwks = await expectJsonStatus(
		new URL("/api/federation/jwks", args.hubBaseUrl).toString(),
		200,
		"jwks",
	);
	if (!Array.isArray(jwks.keys) || jwks.keys.length === 0) {
		throw new Error("JWKS endpoint returned no public keys.");
	}
	if (JSON.stringify(jwks).includes("private")) {
		throw new Error("JWKS response exposed private key material.");
	}
	return jwks;
}

async function mintStagingSession(args, password) {
	const response = await fetch(
		new URL("/api/internal/staging-smoke/auth/session", args.appApiReadyzUrl).toString(),
		{
			body: JSON.stringify({
				email: args.email,
				name: args.name,
				password,
				resetIdentity: true,
			}),
			headers: {
				accept: "application/json",
				"content-type": "application/json",
				"x-app-staging-smoke-auth": args.smokeAuthSecret,
			},
			method: "POST",
			signal: AbortSignal.timeout(30_000),
		},
	);
	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Staging smoke session mint failed (${response.status}): ${text}`);
	}
	return extractCookieHeader(response);
}

function extractCookieHeader(response) {
	const cookies =
		typeof response.headers.getSetCookie === "function"
			? response.headers.getSetCookie()
			: splitSetCookieHeader(response.headers.get("set-cookie") ?? "");
	const pairs = cookies.map((setCookie) => setCookie.split(";", 1)[0]?.trim()).filter(Boolean);
	if (pairs.length === 0) {
		throw new Error("Expected staging smoke session mint to return session cookies.");
	}
	return pairs.join("; ");
}

function splitSetCookieHeader(value) {
	return value
		.split(/,(?=\s*[^;,=\s]+=[^;]+)/)
		.map((item) => item.trim())
		.filter(Boolean);
}

async function beginAuthorize(args, cookieHeader, pkce) {
	const state = randomBytes(16).toString("base64url");
	const nonce = randomBytes(16).toString("base64url");
	const url = new URL("/api/federation/authorize", args.hubBaseUrl);
	url.searchParams.set("client_id", args.clientId);
	url.searchParams.set("redirect_uri", args.redirectUri);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("scope", "openid profile email");
	url.searchParams.set("state", state);
	url.searchParams.set("nonce", nonce);
	url.searchParams.set("code_challenge", pkce.challenge);
	url.searchParams.set("code_challenge_method", "S256");

	const response = await fetch(url, {
		headers: {
			accept: "text/html,application/json",
			cookie: cookieHeader,
		},
		redirect: "manual",
		signal: AbortSignal.timeout(30_000),
	});
	if (![302, 303].includes(response.status)) {
		const text = await response.text();
		throw new Error(`Authorize expected redirect, received ${response.status}: ${text}`);
	}
	const location = response.headers.get("location");
	if (!location) {
		throw new Error("Authorize redirect did not include a Location header.");
	}
	const redirect = new URL(location, args.hubBaseUrl);
	if (redirect.origin !== new URL(args.redirectUri).origin) {
		throw new Error(`Authorize redirected to unexpected origin: ${redirect.toString()}`);
	}
	if (redirect.toString().startsWith(args.redirectUri) !== true) {
		throw new Error(`Authorize redirected outside registered redirect URI: ${redirect.toString()}`);
	}
	if (redirect.searchParams.get("state") !== state) {
		throw new Error("Authorize redirect did not preserve state.");
	}
	const code = redirect.searchParams.get("code");
	if (!code) {
		throw new Error(`Authorize redirect did not include an authorization code: ${redirect}`);
	}
	return {
		code,
		nonce,
		redirect: redirect.toString(),
		state,
	};
}

async function exchangeToken(args, code, pkce) {
	const body = new URLSearchParams({
		client_id: args.clientId,
		code,
		code_verifier: pkce.verifier,
		grant_type: "authorization_code",
		redirect_uri: args.redirectUri,
	});
	const response = await fetch(new URL("/api/federation/token", args.hubBaseUrl), {
		body,
		headers: {
			accept: "application/json",
			authorization: `Basic ${base64BasicCredential(`${args.clientId}:${args.clientSecret}`)}`,
			"content-type": "application/x-www-form-urlencoded",
		},
		method: "POST",
		redirect: "manual",
		signal: AbortSignal.timeout(30_000),
	});
	const payload = await readJsonResponse(response, "token");
	if (!response.ok) {
		throw new Error(`Token exchange failed (${response.status}): ${JSON.stringify(payload)}`);
	}
	for (const field of ["access_token", "id_token", "token_type", "expires_in"]) {
		if (!(field in payload)) {
			throw new Error(`Token response is missing ${field}.`);
		}
	}
	if (payload.token_type !== "Bearer") {
		throw new Error(`Token type mismatch: ${payload.token_type}`);
	}
	return payload;
}

async function assertUserinfo(args, accessToken) {
	const response = await fetch(new URL("/api/federation/userinfo", args.hubBaseUrl), {
		headers: {
			accept: "application/json",
			authorization: `Bearer ${accessToken}`,
		},
		redirect: "manual",
		signal: AbortSignal.timeout(30_000),
	});
	const payload = await readJsonResponse(response, "userinfo");
	if (!response.ok) {
		throw new Error(`Userinfo failed (${response.status}): ${JSON.stringify(payload)}`);
	}
	for (const field of [
		"sub",
		"email",
		"email_verified",
		"name",
		"preferred_username",
		"updated_at",
	]) {
		if (!(field in payload)) {
			throw new Error(`Userinfo response is missing ${field}.`);
		}
	}
	if (payload.email !== args.email) {
		throw new Error(`Userinfo email mismatch: ${payload.email}`);
	}
	for (const forbidden of ["profileMemory", "chatHistory", "operator", "sessionToken"]) {
		if (forbidden in payload || JSON.stringify(payload).includes(forbidden)) {
			throw new Error(`Userinfo leaked forbidden claim: ${forbidden}`);
		}
	}
	return payload;
}

async function runSmoke(args) {
	const events = [];
	await expectStatus(args.appApiReadyzUrl, 200, "app-api readyz");
	events.push("app_api_readyz_ok");
	await expectStatus(new URL("/readyz", args.hubBaseUrl).toString(), 200, "hub readyz");
	events.push("hub_readyz_ok");
	await assertDiscovery(args);
	events.push("openid_discovery_ok");
	await assertJwks(args);
	events.push("jwks_ok");
	const password = buildSmokePassword();
	const cookieHeader = await mintStagingSession(args, password);
	events.push("staging_session_minted");
	const pkce = buildPkcePair();
	const authorization = await beginAuthorize(args, cookieHeader, pkce);
	events.push("authorization_code_redirect_ok");
	const token = await exchangeToken(args, authorization.code, pkce);
	events.push("token_exchange_ok");
	await assertUserinfo(args, token.access_token);
	events.push("userinfo_claims_ok");
	return {
		authorizationRedirect: authorization.redirect,
		events,
		passed: true,
	};
}

function timestampForFile(date = new Date()) {
	const pad = (value) => String(value).padStart(2, "0");
	return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(
		date.getUTCHours(),
	)}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

export function writeSummary(args, result) {
	mkdirSync(args.artifactDir, { recursive: true });
	const path = resolve(args.artifactDir, `${timestampForFile()}-federation-smoke.md`);
	const lines = [
		"# MUC Wiki Federation Smoke",
		"",
		`- timestamp: ${new Date().toISOString()}`,
		`- hub: ${args.hubBaseUrl}`,
		`- app_api_readyz: ${args.appApiReadyzUrl}`,
		`- client_id: ${args.clientId}`,
		`- redirect_uri: ${args.redirectUri}`,
		`- post_logout_redirect_uri: ${args.postLogoutRedirectUri}`,
		`- identity: ${args.email}`,
		`- passed: ${result.passed ? "true" : "false"}`,
		"",
		"## Checks",
		"",
		...(result.events ?? []).map((event) => `- ${event}`),
	];
	if (result.authorizationRedirect) {
		const redactedRedirect = new URL(result.authorizationRedirect);
		redactedRedirect.searchParams.set("code", "<redacted>");
		lines.push("", "## Authorization Redirect", "", redactedRedirect.toString());
	}
	if (result.error) {
		lines.push("", "## Failure", "", result.error);
	}
	writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
	return path;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
	let args;
	try {
		args = parseArgs(argv, env);
		const result = await runSmoke(args);
		const summaryPath = writeSummary(args, result);
		console.log(`MUC Wiki federation smoke passed. Summary: ${summaryPath}`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (args) {
			const summaryPath = writeSummary(args, {
				error: message,
				events: [],
				passed: false,
			});
			console.error(`MUC Wiki federation smoke failed. Summary: ${summaryPath}`);
		}
		console.error(message);
		process.exit(1);
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	void main();
}
