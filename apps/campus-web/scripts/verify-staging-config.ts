import { readFile } from "node:fs/promises";

const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";

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

async function main(): Promise<void> {
	const turnstileSiteKey = process.env.CAMPUS_AUTH_TURNSTILE_SITE_KEY?.trim();
	if (!turnstileSiteKey) {
		fail("CAMPUS_AUTH_TURNSTILE_SITE_KEY is required for apps/campus-web staging preflight.");
	}

	if (turnstileSiteKey === TURNSTILE_TEST_SITE_KEY) {
		fail(
			"CAMPUS_AUTH_TURNSTILE_SITE_KEY must not use the Cloudflare Turnstile testing sitekey in staging preflight.",
		);
	}

	const configPath = new URL("../dist/campus_web/wrangler.json", import.meta.url);
	const rawConfig = await readFile(configPath, "utf8");
	const config = JSON.parse(rawConfig);
	const environments = config.env as Record<string, Record<string, unknown>> | undefined;
	if (
		Object.hasOwn(config, "observability") ||
		Object.hasOwn(environments?.staging ?? {}, "observability")
	) {
		fail("Worker observability is owned by GitOps and must not be declared in Wrangler config.");
	}
	const services = Array.isArray(config.services) ? config.services : [];
	const vars: Record<string, unknown> =
		config.vars && typeof config.vars === "object" ? config.vars : {};

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
	expectAbsent(
		vars,
		"AUTH_TURNSTILE_SITE_KEY",
		"AUTH_TURNSTILE_SITE_KEY must not remain as a repo-fixed staging var in built config.",
	);

	if (Array.isArray(config.routes) && config.routes.length > 0) {
		fail("Built staging config must leave custom-domain traffic to GitOps Terraform.");
	}
}

main().catch((error: unknown) => {
	fail(error instanceof Error ? error.message : String(error));
});
