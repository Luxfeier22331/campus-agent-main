import { readFile } from "node:fs/promises";
import { assertApplicationLogOnlyObservability } from "../../../scripts/deploy/worker-observability-config";

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

	const configPath = new URL("../dist/campus_web/wrangler.json", import.meta.url);
	const rawConfig = await readFile(configPath, "utf8");
	const config = JSON.parse(rawConfig);
	assertApplicationLogOnlyObservability(config.observability, {
		destinations: ["axiom-staging-logs"],
		surface: "campus-web built staging",
	});
	const services = Array.isArray(config.services) ? config.services : [];
	const r2Buckets = Array.isArray(config.r2_buckets) ? config.r2_buckets : [];
	const vars: Record<string, unknown> =
		config.vars && typeof config.vars === "object" ? config.vars : {};

	const hasAppApiService = services.some(
		(service) => service?.binding === "APP_API" && service?.service === "app-api-staging",
	);

	if (!hasAppApiService) {
		fail("Missing required service binding APP_API -> app-api-staging in built staging config.");
	}

	const mapBucketName = process.env.STAGING_MAP_DATA_BUCKET_NAME?.trim();
	if (!mapBucketName) {
		fail("STAGING_MAP_DATA_BUCKET_NAME is required for staging preflight.");
	}
	const hasMapBucket = r2Buckets.some(
		(bucket) => bucket?.binding === "MAP_DATA" && bucket?.bucket_name === mapBucketName,
	);
	if (!hasMapBucket) {
		fail(`Missing required MAP_DATA -> ${mapBucketName} binding in built staging config.`);
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
		"DOCS_RELEASE_ID",
		"DOCS_RELEASE_ID must be injected for the selected Worker candidate.",
	);
	expectAbsent(
		vars,
		"SENTRY_RELEASE",
		"SENTRY_RELEASE must not remain as a static staging var in built config.",
	);

	if (Array.isArray(config.routes) && config.routes.length > 0) {
		fail("Built staging config must leave custom-domain traffic to GitOps Terraform.");
	}
}

main().catch((error: unknown) => {
	fail(error instanceof Error ? error.message : String(error));
});
