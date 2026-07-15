import { readFile } from "node:fs/promises";

function fail(message: string): never {
	console.error(message);
	process.exit(1);
}

function expectContains(source: string, needle: string, message: string): void {
	if (!source.includes(needle)) {
		fail(message);
	}
}

function expectNotContains(source: string, needle: string, message: string): void {
	if (source.includes(needle)) {
		fail(message);
	}
}

async function main(): Promise<void> {
	const configPath = new URL("../wrangler.toml", import.meta.url);
	const source = await readFile(configPath, "utf8");

	expectNotContains(
		source,
		"[[env.staging.routes]]",
		"Staging custom-domain traffic is owned by the GitOps Terraform configuration.",
	);
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
}

main().catch((error: unknown) => {
	fail(error instanceof Error ? error.message : String(error));
});
