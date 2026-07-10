import { Client } from "pg";

import {
	provisionMucWikiFederationClient,
	readMucWikiFederationClientProvisionInput,
} from "../../src/script-support/provisioning/provision-muc-wiki-federation-client-lib.ts";

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
	const input = readMucWikiFederationClientProvisionInput(process.env, process.argv.slice(2));
	const client = new Client({
		connectionString: resolveOperatorConnectionString(process.env),
		ssl: resolveSslConfig(databaseSslMode),
	});

	await client.connect();
	try {
		const summary = await provisionMucWikiFederationClient(input, {
			executeSql(sql, params) {
				return client.query(sql, params);
			},
		});
		console.log(JSON.stringify(summary, null, 2));
	} finally {
		await client.end();
	}
}

void main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
