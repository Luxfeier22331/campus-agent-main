import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_CAMPUS_BASE_URL = "https://campus-staging.mucwiki-edge.link";
const DEFAULT_APP_API_READYZ_URL = "https://api-staging.mucwiki-edge.link/readyz";
const DEFAULT_SMOKE_EMAIL = "help_bot@outlook.com";
const DEFAULT_SMOKE_NAME = "Campus Agent Smoke";
const EXPECTED_CAMPUS_ORIGIN = "https://campus-staging.mucwiki-edge.link";
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

function buildSmokePassword() {
	return `SmokePass!${randomBytes(12).toString("base64url")}`;
}

function parseArgs(argv, env = process.env) {
	let campusBaseUrl =
		normalizeOptionalValue(env.CAMPUS_STAGING_BASE_URL) ?? DEFAULT_CAMPUS_BASE_URL;
	let appApiReadyzUrl =
		normalizeOptionalValue(env.APP_API_STAGING_READYZ_URL) ?? DEFAULT_APP_API_READYZ_URL;
	let email = normalizeOptionalValue(env.APP_API_STAGING_SMOKE_EMAIL) ?? DEFAULT_SMOKE_EMAIL;
	let name = normalizeOptionalValue(env.APP_API_STAGING_SMOKE_NAME) ?? DEFAULT_SMOKE_NAME;
	let smokeAuthSecret =
		normalizeOptionalValue(env.APP_API_STAGING_SMOKE_AUTH_SECRET) ??
		normalizeOptionalValue(env.STAGING_APP_API_SMOKE_AUTH_SECRET) ??
		"";
	let artifactDir = normalizeOptionalValue(env.IDENTITY_ACCEPTANCE_ARTIFACT_DIR);

	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (token === "--campus-base-url") {
			const value = normalizeOptionalValue(argv[index + 1]);
			if (!value) {
				throw new Error("--campus-base-url requires a non-empty value.");
			}
			campusBaseUrl = value;
			index += 1;
			continue;
		}
		if (token === "--app-api-readyz-url") {
			const value = normalizeOptionalValue(argv[index + 1]);
			if (!value) {
				throw new Error("--app-api-readyz-url requires a non-empty value.");
			}
			appApiReadyzUrl = value;
			index += 1;
			continue;
		}
		if (token === "--email") {
			const value = normalizeOptionalValue(argv[index + 1]);
			if (!value) {
				throw new Error("--email requires a non-empty value.");
			}
			email = value.toLowerCase();
			index += 1;
			continue;
		}
		if (token === "--name") {
			const value = normalizeOptionalValue(argv[index + 1]);
			if (!value) {
				throw new Error("--name requires a non-empty value.");
			}
			name = value;
			index += 1;
			continue;
		}
		if (token === "--smoke-auth-secret") {
			const value = normalizeOptionalValue(argv[index + 1]);
			if (!value) {
				throw new Error("--smoke-auth-secret requires a non-empty value.");
			}
			smokeAuthSecret = value;
			index += 1;
			continue;
		}
		if (token === "--artifact-dir") {
			const value = normalizeOptionalValue(argv[index + 1]);
			if (!value) {
				throw new Error("--artifact-dir requires a non-empty value.");
			}
			artifactDir = value;
			index += 1;
			continue;
		}

		throw new Error(`Unknown argument: ${token}`);
	}

	const campusUrl = new URL(campusBaseUrl);
	const appApiReadyz = new URL(appApiReadyzUrl);
	assertStagingOrigin(campusUrl, EXPECTED_CAMPUS_ORIGIN, "campus");
	assertStagingOrigin(appApiReadyz, EXPECTED_APP_API_ORIGIN, "app-api");

	if (!smokeAuthSecret) {
		throw new Error(
			"APP_API_STAGING_SMOKE_AUTH_SECRET or STAGING_APP_API_SMOKE_AUTH_SECRET is required.",
		);
	}

	return {
		appApiReadyzUrl: appApiReadyz.toString(),
		artifactDir: artifactDir
			? resolve(repoRoot, artifactDir)
			: resolve(repoRoot, ".tmp/identity-acceptance"),
		campusBaseUrl: campusUrl.origin,
		email,
		name,
		smokeAuthSecret,
	};
}

function assertStagingOrigin(url, expectedOrigin, label) {
	if (url.origin !== expectedOrigin) {
		throw new Error(`${label} staging smoke requires ${expectedOrigin}; received ${url.origin}.`);
	}
}

async function expectResponseStatus(url, expectedStatus) {
	const response = await fetch(url, {
		headers: {
			accept: "application/json",
		},
		signal: AbortSignal.timeout(30_000),
	});
	if (response.status !== expectedStatus) {
		const text = await response.text();
		throw new Error(
			`Expected ${url} to return ${expectedStatus}, received ${response.status}: ${text}`,
		);
	}
	return response;
}

async function mintStagingSession(args) {
	const password = buildSmokePassword();
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

	return response;
}

function extractSetCookieHeaders(response) {
	const headersWithGetSetCookie = response.headers;
	if (typeof headersWithGetSetCookie.getSetCookie === "function") {
		return headersWithGetSetCookie.getSetCookie();
	}
	const setCookie = response.headers.get("set-cookie");
	return setCookie ? splitSetCookieHeader(setCookie) : [];
}

function splitSetCookieHeader(value) {
	return value
		.split(/,(?=\s*[^;,=\s]+=[^;]+)/)
		.map((item) => item.trim())
		.filter(Boolean);
}

function toPlaywrightCookies(setCookies, campusBaseUrl) {
	const cookies = [];
	for (const setCookie of setCookies) {
		const firstPair = setCookie.split(";", 1)[0]?.trim();
		if (!firstPair) {
			continue;
		}
		const separatorIndex = firstPair.indexOf("=");
		if (separatorIndex <= 0) {
			continue;
		}
		cookies.push({
			name: firstPair.slice(0, separatorIndex),
			url: campusBaseUrl,
			value: firstPair.slice(separatorIndex + 1),
		});
	}
	if (cookies.length === 0) {
		throw new Error("Expected staging smoke session mint to return at least one session cookie.");
	}
	return cookies;
}

async function expectVisible(page, text) {
	await page.getByText(text, { exact: true }).first().waitFor({
		state: "visible",
		timeout: 30_000,
	});
}

async function assertCampusHome(page, campusBaseUrl) {
	await page.goto(new URL("/", campusBaseUrl).toString(), { waitUntil: "domcontentloaded" });
	for (const text of [
		"中央民族大学校园问答",
		"问校园信息，从这里开始。",
		"文档",
		"校园地图",
		"饭堂分布图",
		"反馈",
	]) {
		await expectVisible(page, text);
	}
	if ((await page.getByText("MUC Wiki Hub", { exact: true }).count()) > 0) {
		throw new Error("Campus homepage must not expose retired Hub launcher branding.");
	}
}

async function assertLoggedOutAccount(page, campusBaseUrl) {
	await page.goto(new URL("/account", campusBaseUrl).toString(), { waitUntil: "domcontentloaded" });
	await expectVisible(page, "尚未登录");
	await page.getByRole("link", { name: "登录" }).first().waitFor({
		state: "visible",
		timeout: 30_000,
	});
	await page.getByRole("link", { name: "注册" }).first().waitFor({
		state: "visible",
		timeout: 30_000,
	});
}

async function assertLoggedInAccount(page, args) {
	await page.goto(new URL("/account", args.campusBaseUrl).toString(), {
		waitUntil: "domcontentloaded",
	});
	await expectVisible(page, "当前登录账号");
	await expectVisible(page, args.email);
	for (const text of [
		"校园身份",
		"可用应用",
		"资料记忆",
		"会话与联邦",
		"MUC Wiki 登录联邦",
		"未启用",
	]) {
		await expectVisible(page, text);
	}
}

async function togglePreferencesAndAssertPersistence(page) {
	const button = page.getByRole("button", { name: /资料记忆/ }).first();
	await button.waitFor({ state: "visible", timeout: 30_000 });
	const beforeLabel = (await button.textContent())?.trim() ?? "";
	if (!(beforeLabel === "关闭资料记忆" || beforeLabel === "开启资料记忆")) {
		throw new Error(`Unexpected profile memory button label: ${beforeLabel}`);
	}
	const expectedButtonLabel = beforeLabel === "关闭资料记忆" ? "开启资料记忆" : "关闭资料记忆";
	const expectedStateText = beforeLabel === "关闭资料记忆" ? "已关闭" : "已开启";

	await button.click();
	await page.getByRole("button", { name: expectedButtonLabel }).first().waitFor({
		state: "visible",
		timeout: 30_000,
	});
	await expectVisible(page, expectedStateText);
	await page.reload({ waitUntil: "domcontentloaded" });
	await expectVisible(page, expectedStateText);
	await page.getByRole("button", { name: expectedButtonLabel }).first().waitFor({
		state: "visible",
		timeout: 30_000,
	});

	return {
		after: expectedStateText,
		before: beforeLabel === "关闭资料记忆" ? "已开启" : "已关闭",
	};
}

async function signOutAndAssertLoggedOut(page) {
	await page.getByRole("button", { name: "退出登录" }).first().click();
	await page.getByText("尚未登录", { exact: true }).first().waitFor({
		state: "visible",
		timeout: 30_000,
	});
}

async function runBrowserSmoke(args) {
	const events = [];
	await expectResponseStatus(args.appApiReadyzUrl, 200);
	await expectResponseStatus(new URL("/readyz", args.campusBaseUrl).toString(), 200);
	const sessionResponse = await mintStagingSession(args);
	const setCookies = extractSetCookieHeaders(sessionResponse);

	const { chromium } = await import("playwright");
	const browser = await chromium.launch({ headless: true });
	const context = await browser.newContext();
	const page = await context.newPage();
	try {
		await assertCampusHome(page, args.campusBaseUrl);
		events.push("campus_home_ok");
		await assertLoggedOutAccount(page, args.campusBaseUrl);
		events.push("account_logged_out_ok");
		await context.addCookies(toPlaywrightCookies(setCookies, args.campusBaseUrl));
		await assertLoggedInAccount(page, args);
		events.push("account_logged_in_sections_ok");
		const preferenceTransition = await togglePreferencesAndAssertPersistence(page);
		events.push(
			`preferences_persisted:${preferenceTransition.before}->${preferenceTransition.after}`,
		);
		await signOutAndAssertLoggedOut(page);
		events.push("sign_out_ok");
		await expectResponseStatus(
			new URL("/api/unknown-identity-smoke", args.campusBaseUrl).toString(),
			404,
		);
		events.push("unknown_api_fail_closed_ok");
		return {
			events,
			passed: true,
		};
	} catch (error) {
		if (error instanceof Error) {
			error.completedEvents = events;
		}
		throw error;
	} finally {
		await browser.close();
	}
}

function timestampForFile(date = new Date()) {
	const pad = (value) => String(value).padStart(2, "0");
	return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(
		date.getUTCHours(),
	)}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

export function writeSummary(args, result) {
	mkdirSync(args.artifactDir, { recursive: true });
	const path = resolve(args.artifactDir, `${timestampForFile()}-campus-account-browser-smoke.md`);
	const lines = [
		"# Campus Account Browser Smoke",
		"",
		`- timestamp: ${new Date().toISOString()}`,
		`- campus: ${args.campusBaseUrl}`,
		`- app_api_readyz: ${args.appApiReadyzUrl}`,
		`- identity: ${args.email}`,
		`- passed: ${result.passed ? "true" : "false"}`,
		"",
		"## Checks",
		"",
		...(result.events ?? []).map((event) => `- ${event}`),
	];
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
		const result = await runBrowserSmoke(args);
		const summaryPath = writeSummary(args, result);
		console.log(`Campus account browser smoke passed. Summary: ${summaryPath}`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const events =
			error instanceof Error && Array.isArray(error.completedEvents) ? error.completedEvents : [];
		if (args) {
			const summaryPath = writeSummary(args, {
				error: message,
				events,
				passed: false,
			});
			console.error(`Campus account browser smoke failed. Summary: ${summaryPath}`);
		}
		console.error(message);
		process.exit(1);
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	void main();
}
