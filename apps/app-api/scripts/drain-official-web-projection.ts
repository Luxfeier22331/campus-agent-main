import process from "node:process";
import { pathToFileURL } from "node:url";
import type { Env } from "../src/config";

export interface OfficialWebProjectionDrainArgs {
	limit?: number;
}

export interface LocalOfficialWebProjectionDrainRuntime {
	env: Env;
	handoffConfigured: boolean;
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

	const handoffUrl = readOptionalString(sourceEnv, "APP_API_OFFICIAL_WEB_HANDOFF_URL");
	const handoffToken = readOptionalString(sourceEnv, "APP_API_OFFICIAL_WEB_HANDOFF_TOKEN");
	const handoffTimeoutMs = readOptionalString(sourceEnv, "APP_API_OFFICIAL_WEB_HANDOFF_TIMEOUT_MS");
	const handoffConfigured = Boolean(handoffUrl && handoffToken);

	if (handoffUrl) {
		env.APP_API_OFFICIAL_WEB_HANDOFF_URL = handoffUrl;
	}
	if (handoffToken) {
		env.APP_API_OFFICIAL_WEB_HANDOFF_TOKEN = handoffToken;
	}
	if (handoffTimeoutMs) {
		env.APP_API_OFFICIAL_WEB_HANDOFF_TIMEOUT_MS = handoffTimeoutMs;
	}

	return {
		env,
		handoffConfigured,
	};
}

export async function drainOfficialWebProjection(
	runtime: LocalOfficialWebProjectionDrainRuntime,
	input: OfficialWebProjectionDrainArgs,
): Promise<{
	abandoned: number;
	failed: number;
	handoffConfigured: boolean;
	processed: number;
	skipped: number;
}> {
	const [{ createOfficialWebHandoffPublisher }, projectionModule] = await Promise.all([
		import("../src/modules/integration/official-web-handoff"),
		import("../src/modules/official-web-projection"),
	]);
	const projector = projectionModule.buildOfficialWebProjectionProjector({
		handoffPublisher: runtime.handoffConfigured
			? createOfficialWebHandoffPublisher(runtime.env)
			: undefined,
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
		handoffConfigured: runtime.handoffConfigured,
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
