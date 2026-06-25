import { readFile } from "node:fs/promises";

function fail(message) {
	console.error(message);
	process.exit(1);
}

function expectContains(source, needle, message) {
	if (!source.includes(needle)) {
		fail(message);
	}
}

function expectNotContains(source, needle, message) {
	if (source.includes(needle)) {
		fail(message);
	}
}

const configPath = new URL("../wrangler.toml", import.meta.url);
const source = await readFile(configPath, "utf8");

expectContains(
	source,
	'pattern = "api-staging.mucwiki-edge.link"',
	"Missing staging custom domain route.",
);
expectContains(source, "custom_domain = true", "Missing staging custom domain route flag.");
expectContains(
	source,
	'AUTH_SHELL_ORIGIN = "https://campus-staging.mucwiki-edge.link"',
	"Missing staging auth shell origin.",
);
expectContains(source, 'APP_API_ENVIRONMENT = "staging"', "Missing APP_API_ENVIRONMENT=staging.");
expectContains(source, 'SENTRY_ENVIRONMENT = "staging"', "Missing SENTRY_ENVIRONMENT=staging.");
expectContains(
	source,
	'APP_API_OTEL_INGEST_ENDPOINT = "https://otel-collector-staging.mucwiki-edge.link"',
	"Missing APP_API_OTEL_INGEST_ENDPOINT staging value.",
);
expectContains(source, 'binding = "APP_API_DB"', "Missing APP_API_DB Hyperdrive binding.");
expectContains(
	source,
	'binding = "APP_API_DB_FRESH"',
	"Missing APP_API_DB_FRESH Hyperdrive binding.",
);
expectNotContains(
	source,
	'SENTRY_RELEASE = "',
	"Static SENTRY_RELEASE must not remain in app-api staging config.",
);
