import { Client } from "pg";

import { createApp } from "../src/app";
import {
	buildSmokeIdentityProvisionRuntimeEnv,
	provisionSmokeIdentity,
	readSmokeIdentityProvisionInput,
} from "./provision-smoke-identity-lib.mjs";

function resolveSslConfig(databaseSslMode: string) {
	return databaseSslMode === "disable"
		? false
		: {
				rejectUnauthorized: false as const,
			};
}

function resolveOperatorConnectionString(env: NodeJS.ProcessEnv): string {
	const connectionString = env.APP_API_OPERATOR_DATABASE_URL?.trim();
	if (!connectionString) {
		throw new Error("APP_API_OPERATOR_DATABASE_URL is required.");
	}
	const nextUrl = new URL(connectionString);
	nextUrl.searchParams.delete("sslmode");
	return nextUrl.toString();
}

const databaseSslMode =
	process.env.APP_API_DATABASE_SSLMODE?.trim() === "disable"
		? "disable"
		: process.env.APP_API_DATABASE_SSLMODE?.trim() === "prefer"
			? "prefer"
			: "require";

async function main() {
	const input = readSmokeIdentityProvisionInput(process.argv.slice(2), process.env);
	const runtimeEnv = buildSmokeIdentityProvisionRuntimeEnv(input);

	const summary = await provisionSmokeIdentity(
		{
			...input,
			runtimeEnv,
		},
		{
			appFetch(request) {
				const app = createApp(runtimeEnv);

				return app.fetch(request);
			},
			async executeSql(sql, params) {
				const client = new Client({
					connectionString: resolveOperatorConnectionString(process.env),
					ssl: resolveSslConfig(databaseSslMode),
				});

				await client.connect();
				try {
					return await client.query(sql, params);
				} finally {
					await client.end();
				}
			},
		},
	);

	console.log(JSON.stringify(summary, null, 2));
}

void main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
