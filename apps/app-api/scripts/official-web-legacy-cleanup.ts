import process from "node:process";
import { pathToFileURL } from "node:url";
import type { Env } from "../src/config";
import {
	buildOfficialWebRunAdmissionCleanupService,
	createPgOfficialWebRunAdmissionCleanupStore,
} from "../src/modules/official-web-run-admission";

export interface OfficialWebLegacyCleanupArgs {
	action: "apply" | "dry-run";
	before: string;
	limit?: number;
	siteId: string;
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

export function parseOfficialWebLegacyCleanupArgs(argv: string[]): OfficialWebLegacyCleanupArgs {
	const [actionToken, ...rest] = argv.filter((token) => token !== "--");
	const action = actionToken === "apply" ? "apply" : actionToken === "dry-run" ? "dry-run" : null;
	if (!action) {
		throw new Error("Usage: official-web-legacy-cleanup.ts <dry-run|apply> --before <iso>");
	}

	let before: string | undefined;
	let limit: number | undefined;
	let siteId = "muc_public";
	for (let index = 0; index < rest.length; index += 1) {
		const token = rest[index];
		if (token === "--before") {
			before = rest[index + 1];
			index += 1;
			continue;
		}
		if (token === "--site-id") {
			siteId = rest[index + 1] ?? "";
			index += 1;
			continue;
		}
		if (token === "--limit") {
			const value = Number.parseInt(rest[index + 1] ?? "", 10);
			if (!Number.isFinite(value) || value < 1) {
				throw new Error("--limit must be a positive integer.");
			}
			limit = value;
			index += 1;
			continue;
		}
		throw new Error(`Unknown argument: ${token}`);
	}
	if (!before) {
		throw new Error("--before is required and must be an ISO timestamp.");
	}
	if (!siteId) {
		throw new Error("--site-id must be non-empty.");
	}

	return {
		action,
		before,
		limit,
		siteId,
	};
}

export function buildLocalOfficialWebLegacyCleanupEnv(sourceEnv: NodeJS.ProcessEnv): Env {
	const connectionString = readOptionalString(
		sourceEnv,
		"CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB",
	);
	if (!connectionString) {
		throw new Error("CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB is required.");
	}

	return {
		APP_API_DATABASE_SSLMODE: readOptionalString(sourceEnv, "APP_API_DATABASE_SSLMODE") as
			| Env["APP_API_DATABASE_SSLMODE"]
			| undefined,
		APP_API_DB: {
			connectionString,
		},
		APP_API_ENVIRONMENT: readOptionalString(sourceEnv, "APP_API_ENVIRONMENT") as
			| Env["APP_API_ENVIRONMENT"]
			| undefined,
		APP_API_OPERATOR_DATABASE_URL:
			readOptionalString(sourceEnv, "APP_API_OPERATOR_DATABASE_URL") ||
			readOptionalString(sourceEnv, "APP_API_MANAGEMENT_DATABASE_URL"),
		APP_API_MANAGEMENT_DATABASE_URL:
			readOptionalString(sourceEnv, "APP_API_OPERATOR_DATABASE_URL") ||
			readOptionalString(sourceEnv, "APP_API_MANAGEMENT_DATABASE_URL"),
	};
}

export async function runOfficialWebLegacyCleanup(
	env: Env,
	args: OfficialWebLegacyCleanupArgs,
): Promise<unknown> {
	const service = buildOfficialWebRunAdmissionCleanupService({
		store: createPgOfficialWebRunAdmissionCleanupStore(env),
	});
	return args.action === "apply"
		? service.applyLegacyCleanup(args)
		: service.planLegacyCleanup(args);
}

async function main(argv: string[]): Promise<void> {
	const args = parseOfficialWebLegacyCleanupArgs(argv);
	const env = buildLocalOfficialWebLegacyCleanupEnv(process.env);
	const result = await runOfficialWebLegacyCleanup(env, args);
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
