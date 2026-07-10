import { readFile } from "node:fs/promises";

const DEFAULT_TURNSTILE_APPEARANCE = "interaction-only";
const DEFAULT_TURNSTILE_EXECUTION = "render";
const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";
const VALID_TURNSTILE_APPEARANCES = new Set(["always", "execute", "interaction-only"]);
const VALID_TURNSTILE_EXECUTIONS = new Set(["render", "execute"]);

function fail(message: string): never {
	console.error(message);
	process.exit(1);
}

function expectEqual(actual: unknown, expected: unknown, message: string): void {
	if (actual !== expected) {
		fail(`${message} Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
	}
}

function expectAbsent(record: Record<string, unknown>, key: string, message: string): void {
	if (Object.hasOwn(record, key)) {
		fail(message);
	}
}

function resolveTurnstileOption(
	name: string,
	rawValue: string | undefined,
	validValues: Set<string>,
	defaultValue: string,
): string {
	const value = rawValue?.trim();
	if (!value) {
		return defaultValue;
	}
	if (!validValues.has(value)) {
		fail(
			`${name} must be one of ${JSON.stringify(Array.from(validValues))}. Received ${JSON.stringify(value)}.`,
		);
	}
	return value;
}

async function main(): Promise<void> {
	const turnstileSiteKey = process.env.STAGING_CAMPUS_AUTH_TURNSTILE_SITE_KEY?.trim();
	if (!turnstileSiteKey) {
		fail(
			"STAGING_CAMPUS_AUTH_TURNSTILE_SITE_KEY is required for apps/campus-web staging preflight.",
		);
	}

	if (turnstileSiteKey === TURNSTILE_TEST_SITE_KEY) {
		fail(
			"STAGING_CAMPUS_AUTH_TURNSTILE_SITE_KEY must not use the Cloudflare Turnstile testing sitekey in staging preflight.",
		);
	}

	resolveTurnstileOption(
		"STAGING_CAMPUS_AUTH_TURNSTILE_APPEARANCE",
		process.env.STAGING_CAMPUS_AUTH_TURNSTILE_APPEARANCE,
		VALID_TURNSTILE_APPEARANCES,
		DEFAULT_TURNSTILE_APPEARANCE,
	);
	resolveTurnstileOption(
		"STAGING_CAMPUS_AUTH_TURNSTILE_EXECUTION",
		process.env.STAGING_CAMPUS_AUTH_TURNSTILE_EXECUTION,
		VALID_TURNSTILE_EXECUTIONS,
		DEFAULT_TURNSTILE_EXECUTION,
	);

	const configPath = new URL("../dist/campus_web/wrangler.json", import.meta.url);
	const rawConfig = await readFile(configPath, "utf8");
	const config = JSON.parse(rawConfig);
	const services = Array.isArray(config.services) ? config.services : [];
	const vars: Record<string, unknown> =
		config.vars && typeof config.vars === "object" ? config.vars : {};
	const routes = Array.isArray(config.routes) ? config.routes : [];

	const hasAppApiService = services.some(
		(service) => service?.binding === "APP_API" && service?.service === "app-api-staging",
	);

	if (!hasAppApiService) {
		fail("Missing required service binding APP_API -> app-api-staging in built staging config.");
	}

	expectEqual(
		vars.APP_API_BASE_URL,
		"https://app-api.internal",
		"Built staging config must keep APP_API_BASE_URL fixed.",
	);
	expectEqual(
		vars.CAMPUS_WEB_HOSTNAME,
		"campus-staging.mucwiki-edge.link",
		"Built staging config must keep CAMPUS_WEB_HOSTNAME fixed.",
	);
	expectEqual(
		vars.AUTH_TURNSTILE_APPEARANCE,
		"interaction-only",
		"Built staging config must keep AUTH_TURNSTILE_APPEARANCE fixed.",
	);
	expectEqual(
		vars.AUTH_TURNSTILE_EXECUTION,
		"render",
		"Built staging config must keep AUTH_TURNSTILE_EXECUTION fixed.",
	);
	expectEqual(
		vars.SENTRY_ENVIRONMENT,
		"staging",
		"Built staging config must keep SENTRY_ENVIRONMENT fixed.",
	);
	expectAbsent(
		vars,
		"AUTH_TURNSTILE_SITE_KEY",
		"AUTH_TURNSTILE_SITE_KEY must not remain as a repo-fixed staging var in built config.",
	);
	expectAbsent(
		vars,
		"SENTRY_RELEASE",
		"SENTRY_RELEASE must not remain as a static staging var in built config.",
	);

	const hasRoute = routes.some(
		(route) =>
			route?.pattern === "campus-staging.mucwiki-edge.link" && route?.custom_domain === true,
	);
	if (!hasRoute) {
		fail(
			"Missing required campus-staging.mucwiki-edge.link custom domain route in built staging config.",
		);
	}
}

main().catch((error: unknown) => {
	fail(error instanceof Error ? error.message : String(error));
});
