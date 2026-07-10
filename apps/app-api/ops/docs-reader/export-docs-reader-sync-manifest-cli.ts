import { writeFileSync } from "node:fs";
import process from "node:process";
import { Client, type ClientConfig } from "pg";

import type { Env } from "../../src/config";
import { buildOperatorDatabaseConfig } from "../../src/db/runtime";
import {
	buildDocsReaderSyncManifestPayload,
	resolveDocsReaderSyncManifestOutputPath,
} from "./export-docs-reader-sync-manifest";

function buildEnv(source: NodeJS.ProcessEnv): Env {
	return {
		APP_API_DATABASE_SSLMODE: source.APP_API_DATABASE_SSLMODE as Env["APP_API_DATABASE_SSLMODE"],
		APP_API_ENVIRONMENT: source.APP_API_ENVIRONMENT as Env["APP_API_ENVIRONMENT"],
		APP_API_OPERATOR_DATABASE_URL: source.APP_API_OPERATOR_DATABASE_URL,
	};
}

async function main(): Promise<void> {
	const client = new Client(buildOperatorDatabaseConfig(buildEnv(process.env)) as ClientConfig);
	await client.connect();
	try {
		const payload = await buildDocsReaderSyncManifestPayload(client);
		const outputPath = resolveDocsReaderSyncManifestOutputPath(process.argv.slice(2), process.env);
		if (outputPath) {
			writeFileSync(outputPath, payload, "utf8");
		} else {
			process.stdout.write(payload);
		}
	} finally {
		await client.end();
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.stack || error.message : String(error));
		process.exit(1);
	});
}
