import process from "node:process";
import { Client, type ClientConfig } from "pg";

import type { Env } from "../../src/config";
import { buildOperatorDatabaseConfig } from "../../src/db/runtime";
import {
	buildDocsReadModelPlanFromManifestPath,
	importDocsReadModelPlan,
	resolveDocsReadModelManifestPath,
} from "./import-docs-read-model";

function buildEnv(source: NodeJS.ProcessEnv): Env {
	return {
		APP_API_DATABASE_SSLMODE: source.APP_API_DATABASE_SSLMODE as Env["APP_API_DATABASE_SSLMODE"],
		APP_API_ENVIRONMENT: source.APP_API_ENVIRONMENT as Env["APP_API_ENVIRONMENT"],
		APP_API_OPERATOR_DATABASE_URL: source.APP_API_OPERATOR_DATABASE_URL,
	};
}

async function main(): Promise<void> {
	const manifestPath = resolveDocsReadModelManifestPath(process.argv.slice(2), process.env);
	const plan = buildDocsReadModelPlanFromManifestPath(manifestPath);
	const client = new Client(buildOperatorDatabaseConfig(buildEnv(process.env)) as ClientConfig);
	await client.connect();
	try {
		await importDocsReadModelPlan(client, plan);
	} finally {
		await client.end();
	}
	console.log(
		JSON.stringify({
			collections: plan.collections.length,
			documents: plan.documents.length,
			readerAssets: plan.readerAssets.length,
			searchUnits: plan.searchUnits.length,
		}),
	);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.stack || error.message : String(error));
		process.exit(1);
	});
}
