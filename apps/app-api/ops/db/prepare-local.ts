import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { migrateAppApiSchema } from "./schema.ts";

export async function prepareLocalAppApiSchema(
	envOverrides: NodeJS.ProcessEnv = process.env,
): Promise<{ schemaReady: true }> {
	const localEnv = {
		...envOverrides,
		APP_API_SCHEMA_DATABASE_SSLMODE:
			envOverrides.APP_API_SCHEMA_DATABASE_SSLMODE?.trim() === "prefer"
				? "disable"
				: envOverrides.APP_API_SCHEMA_DATABASE_SSLMODE,
	};
	await migrateAppApiSchema(localEnv);
	return { schemaReady: true };
}

async function main(): Promise<void> {
	console.log(JSON.stringify(await prepareLocalAppApiSchema()));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	void main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
