import { readFile } from "node:fs/promises";
import { parse } from "smol-toml";

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
	for (const name of ["local", "staging"]) {
		const environment = environments?.[name];
		const images = environment?.images as { binding?: unknown; remote?: unknown } | undefined;
		if (images?.binding !== "DINING_IMAGES") {
			fail(`Missing ${name} DINING_IMAGES binding.`);
		}
		if (name === "local" && images.remote !== false) {
			fail("Local DINING_IMAGES must use local emulation.");
		}
		const secrets = environment?.secrets as { required?: unknown } | undefined;
		for (const secret of ["OBJECT_STORE_DERIVED_ACCESS_KEY", "OBJECT_STORE_DERIVED_SECRET_KEY"]) {
			if (!(Array.isArray(secrets?.required) && secrets.required.includes(secret))) {
				fail(`Missing ${name} ${secret} required secret declaration.`);
			}
		}
	}

	if (
		Object.hasOwn(config, "observability") ||
		Object.hasOwn(environments?.staging ?? {}, "observability")
	) {
		fail("Worker observability is owned by GitOps and must not be declared in Wrangler config.");
	}

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
	expectNotContains(source, "APP_API_OTEL_INGEST_", "Retired app-api OTLP ingest config remains.");
	expectContains(source, 'binding = "APP_API_DB"', "Missing APP_API_DB Hyperdrive binding.");
}

main().catch((error: unknown) => {
	fail(error instanceof Error ? error.message : String(error));
});
