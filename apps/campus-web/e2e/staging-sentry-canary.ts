import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import {
	hashCanonicalSentryCanarySentinels,
	SENTRY_CANARY_EVIDENCE_ELEMENT_ID,
	SENTRY_CANARY_ROUTE,
	type SentryCanarySentinels,
} from "../src/platform/telemetry/sentry-canary";

const DEFAULT_CAMPUS_BASE_URL = "https://campus-staging.mucwiki-edge.link";
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../..");

export interface StagingSentryCanaryArgs {
	campusBaseUrl: string;
	evidencePath: string;
	headed: boolean;
	smokeAuthSecret: string;
	timeoutMs: number;
}

export interface StagingSentryCanaryInput {
	productRequestId: string;
	runtimeTraceId: string;
	sentinels: SentryCanarySentinels;
}

export interface StagingSentryCanaryResult {
	appApiEventId: string;
	appApiRelease: string;
	browserEventId: string;
	campusWebRelease: string;
	edgeEventId: string;
	sentinelSha256: string;
}

interface BrowserMarker {
	appApiEventId: string;
	browserEventId: string;
	edgeEventId: string;
	release: string;
	sentinelSha256: string;
}

function optionalValue(value: string | undefined): string | null {
	const normalized = value?.trim();
	return normalized ? normalized : null;
}

export function parseStagingSentryCanaryArgs(
	argv: string[],
	env: NodeJS.ProcessEnv = process.env,
): StagingSentryCanaryArgs {
	const args: StagingSentryCanaryArgs = {
		campusBaseUrl:
			optionalValue(env.STAGING_CAMPUS_BASE_URL) ??
			optionalValue(env.CAMPUS_WEB_STAGING_BASE_URL) ??
			DEFAULT_CAMPUS_BASE_URL,
		evidencePath:
			optionalValue(env.SENTRY_CANARY_EVIDENCE_PATH) ??
			resolve(repoRoot, "var/staging-evidence/observability-canary.json"),
		headed: false,
		smokeAuthSecret:
			optionalValue(env.APP_API_STAGING_SMOKE_AUTH_SECRET) ??
			optionalValue(env.STAGING_APP_API_SMOKE_AUTH_SECRET) ??
			"",
		timeoutMs: Number.parseInt(optionalValue(env.SENTRY_CANARY_TIMEOUT_MS) ?? "30000", 10),
	};
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (token === "--") {
			continue;
		}
		if (token === "--headed") {
			args.headed = true;
			continue;
		}
		const next = optionalValue(argv[index + 1]);
		if (token === "--campus-base-url" && next) {
			args.campusBaseUrl = new URL(next).origin;
			index += 1;
			continue;
		}
		if (token === "--evidence-path" && next) {
			args.evidencePath = resolve(next);
			index += 1;
			continue;
		}
		throw new Error(`Unknown or incomplete argument: ${token}`);
	}
	if (!args.smokeAuthSecret) {
		throw new Error(
			"APP_API_STAGING_SMOKE_AUTH_SECRET or STAGING_APP_API_SMOKE_AUTH_SECRET is required.",
		);
	}
	if (!(Number.isFinite(args.timeoutMs) && args.timeoutMs >= 5_000 && args.timeoutMs <= 120_000)) {
		throw new Error("SENTRY_CANARY_TIMEOUT_MS must be between 5000 and 120000.");
	}
	return args;
}

export async function runStagingSentryCanary(
	args: StagingSentryCanaryArgs,
	input: StagingSentryCanaryInput,
): Promise<StagingSentryCanaryResult> {
	const sentinelSha256 = await hashCanonicalSentryCanarySentinels(input.sentinels);
	const canaryUrl = new URL(SENTRY_CANARY_ROUTE, args.campusBaseUrl);
	const browser = await chromium.launch({ headless: !args.headed });
	try {
		const page = await browser.newPage();
		let intercepted = false;
		await page.route(
			new RegExp(`^${escapeRegExp(canaryUrl.origin + SENTRY_CANARY_ROUTE)}(?:\\?.*)?$`, "u"),
			async (route) => {
				const navigation = route.request();
				const url = new URL(navigation.url());
				if (
					intercepted ||
					!navigation.isNavigationRequest() ||
					navigation.method() !== "POST" ||
					url.origin !== canaryUrl.origin ||
					url.pathname !== SENTRY_CANARY_ROUTE
				) {
					await route.abort("blockedbyclient");
					return;
				}
				intercepted = true;
				await route.continue({
					headers: {
						...navigation.headers(),
						authorization: `Synthetic ${input.sentinels.credential}`,
						"x-app-staging-smoke-auth": args.smokeAuthSecret,
						"x-observability-canary": input.sentinels.header,
						"x-request-id": input.productRequestId,
						"x-trace-id": input.runtimeTraceId,
					},
				});
			},
			{ times: 1 },
		);

		await page.goto(new URL("/", args.campusBaseUrl).toString(), {
			timeout: args.timeoutMs,
			waitUntil: "domcontentloaded",
		});
		const navigationPromise = page.waitForNavigation({
			timeout: args.timeoutMs,
			waitUntil: "domcontentloaded",
		});
		await page.evaluate(
			({ action, body, query, user }) => {
				const form = document.createElement("form");
				form.action = action;
				form.method = "POST";
				for (const [name, value] of Object.entries({ body, query, user })) {
					const field = document.createElement("input");
					field.name = name;
					field.type = "hidden";
					field.value = value;
					form.appendChild(field);
				}
				document.body.appendChild(form);
				form.submit();
			},
			{
				action: canaryUrl.toString(),
				body: input.sentinels.body,
				query: input.sentinels.query,
				user: input.sentinels.user,
			},
		);
		const navigationResponse = await navigationPromise;
		if (!(intercepted && navigationResponse?.ok())) {
			throw new Error(`Sentry canary navigation failed (${navigationResponse?.status() ?? 0}).`);
		}

		await page
			.locator(`#${SENTRY_CANARY_EVIDENCE_ELEMENT_ID}`)
			.waitFor({ state: "attached", timeout: args.timeoutMs });
		const markerText = await page.locator(`#${SENTRY_CANARY_EVIDENCE_ELEMENT_ID}`).textContent();
		const marker = parseBrowserMarker(markerText);
		if (marker.sentinelSha256 !== sentinelSha256) {
			throw new Error("Browser Sentry canary returned a different sentinel hash.");
		}
		const headers = navigationResponse.headers();
		return {
			appApiEventId: marker.appApiEventId,
			appApiRelease: headers["x-app-api-sentry-release"] ?? "",
			browserEventId: marker.browserEventId,
			campusWebRelease: headers["x-campus-web-sentry-release"] ?? marker.release,
			edgeEventId: marker.edgeEventId,
			sentinelSha256,
		};
	} finally {
		await browser.close();
	}
}

function parseBrowserMarker(source: string | null): BrowserMarker {
	let value: unknown;
	try {
		value = JSON.parse(source ?? "");
	} catch {
		throw new Error("Browser Sentry canary evidence marker is invalid.");
	}
	if (!(value && typeof value === "object")) {
		throw new Error("Browser Sentry canary evidence marker is invalid.");
	}
	return value as BrowserMarker;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
