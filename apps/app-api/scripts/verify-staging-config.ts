import { readFile } from "node:fs/promises";
import { parse } from "smol-toml";
import { assertApplicationLogOnlyObservability } from "../../../scripts/deploy/worker-observability-config";

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
	const config = parse(source) as Record<string, unknown>;
	const environments = config.env as Record<string, Record<string, unknown>> | undefined;

	assertApplicationLogOnlyObservability(config.observability, {
		destinations: [],
		surface: "app-api default",
	});
	assertApplicationLogOnlyObservability(environments?.staging?.observability, {
		destinations: ["axiom-staging-logs"],
		surface: "app-api staging",
	});

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
	expectContains(
		source,
		'DEPLOYMENT_ENVIRONMENT = "staging"',
		"Missing DEPLOYMENT_ENVIRONMENT=staging.",
	);
	expectNotContains(
		source,
		"axiom-staging-traces",
		"Native Worker trace destination must stay disabled.",
	);
	expectNotContains(source, "APP_API_OTEL_INGEST_", "Retired app-api OTLP ingest config remains.");
	expectContains(source, 'binding = "APP_API_DB"', "Missing APP_API_DB Hyperdrive binding.");
	expectNotContains(
		source,
		'DEPLOYMENT_RELEASE = "',
		"Static DEPLOYMENT_RELEASE must not remain in app-api staging config.",
	);
}

main().catch((error: unknown) => {
	fail(error instanceof Error ? error.message : String(error));
});
