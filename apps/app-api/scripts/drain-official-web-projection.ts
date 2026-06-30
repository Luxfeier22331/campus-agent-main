import process from "node:process";
import { pathToFileURL } from "node:url";
import type { Env } from "../src/config";

export interface OfficialWebProjectionDrainArgs {
	limit?: number;
}

export interface LocalOfficialWebProjectionDrainRuntime {
	env: Env;
	ingestionControlConfigured: boolean;
}

function readOptionalString(
	env: NodeJS.ProcessEnv,
	key: keyof NodeJS.ProcessEnv,
): string | undefined {
	const value = env[key];
	if (typeof value !== "string") {
		return;
	}
	const trimmed = value.trim();
	return trimmed ? trimmed : undefined;
}

export function parseOfficialWebProjectionDrainArgs(
	argv: string[],
): OfficialWebProjectionDrainArgs {
	let limit: number | undefined;

	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (token === "--") {
			continue;
		}
		if (token !== "--limit") {
			throw new Error(`Unknown argument: ${token}`);
		}

		const value = argv[index + 1];
		if (!value) {
			throw new Error("--limit requires a positive integer value.");
		}
		const parsed = Number.parseInt(value, 10);
		if (!Number.isFinite(parsed) || parsed < 1) {
			throw new Error("--limit must be a positive integer.");
		}
		limit = parsed;
		index += 1;
	}

	return { limit };
}

export function buildLocalOfficialWebProjectionDrainRuntime(
	sourceEnv: NodeJS.ProcessEnv,
): LocalOfficialWebProjectionDrainRuntime {
	const connectionString = readOptionalString(
		sourceEnv,
		"CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB",
	);
	if (!connectionString) {
		throw new Error("CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB is required.");
	}

	const env: Env = {
		APP_API_DATABASE_SSLMODE: readOptionalString(sourceEnv, "APP_API_DATABASE_SSLMODE") as
			| Env["APP_API_DATABASE_SSLMODE"]
			| undefined,
		APP_API_DB: {
			connectionString,
		},
		APP_API_ENVIRONMENT: readOptionalString(sourceEnv, "APP_API_ENVIRONMENT") as
			| Env["APP_API_ENVIRONMENT"]
			| undefined,
		APP_API_OPERATOR_DATABASE_URL: readOptionalString(sourceEnv, "APP_API_OPERATOR_DATABASE_URL"),
	};

	const ingestionControlBaseUrl = readOptionalString(sourceEnv, "INGESTION_CONTROL_BASE_URL");
	const sourceBucket = readOptionalString(sourceEnv, "OBJECT_STORE_BUCKET_SOURCE");
	const ingestionControlConfigured = Boolean(ingestionControlBaseUrl);
	if (ingestionControlConfigured && !sourceBucket) {
		throw new Error(
			"OBJECT_STORE_BUCKET_SOURCE is required when INGESTION_CONTROL_BASE_URL is set.",
		);
	}

	if (ingestionControlBaseUrl) {
		env.INGESTION_CONTROL_BASE_URL = ingestionControlBaseUrl;
	}
	if (sourceBucket) {
		env.OBJECT_STORE_BUCKET_SOURCE = sourceBucket;
	}

	return {
		env,
		ingestionControlConfigured,
	};
}

export async function drainOfficialWebProjection(
	runtime: LocalOfficialWebProjectionDrainRuntime,
	input: OfficialWebProjectionDrainArgs,
): Promise<{
	abandoned: number;
	failed: number;
	ingestionControlConfigured: boolean;
	processed: number;
	skipped: number;
}> {
	const [{ createIngestionTaskProjectionClient }, projectionModule] = await Promise.all([
		import("../src/modules/integration/ingestion-control"),
		import("../src/modules/official-web-projection"),
	]);
	const projector = projectionModule.buildOfficialWebProjectionProjector({
		ingestionTasks: runtime.ingestionControlConfigured
			? createIngestionTaskProjectionClient(runtime.env)
			: undefined,
		sourceBucket: runtime.env.OBJECT_STORE_BUCKET_SOURCE,
		store: projectionModule.createPgOfficialWebProjectionStore(runtime.env),
	});
	const result = await projector.drain(
		input.limit
			? {
					limit: input.limit,
				}
			: undefined,
	);

	return {
		...result,
		ingestionControlConfigured: runtime.ingestionControlConfigured,
	};
}

async function main(argv: string[]): Promise<void> {
	const args = parseOfficialWebProjectionDrainArgs(argv);
	const runtime = buildLocalOfficialWebProjectionDrainRuntime(process.env);
	const result = await drainOfficialWebProjection(runtime, args);
	console.log(JSON.stringify(result, null, 2));
}

const isEntrypoint =
	typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
	void main(process.argv.slice(2)).catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
