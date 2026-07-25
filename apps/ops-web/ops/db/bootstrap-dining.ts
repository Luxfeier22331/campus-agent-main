import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { DINING_BOOTSTRAP_FLOORPLANS } from "@campus-agent/dining/bootstrap";
import { diningMapBundleFingerprint } from "@campus-agent/dining/publisher";
import pg from "pg";
import { readDatabaseConnectionConfig } from "./postgres-tls.ts";

const BOOTSTRAP_ACTOR = "system:dining-bootstrap";

interface BootstrapClient {
	query(
		sql: string,
		values?: unknown[],
	): Promise<{ rowCount: number | null; rows: Record<string, unknown>[] }>;
}

export async function bootstrapDiningDraft(
	client: BootstrapClient,
	now: Date = new Date(),
): Promise<{ revision: number; status: "already_initialized" | "initialized" }> {
	const fingerprint = diningMapBundleFingerprint(DINING_BOOTSTRAP_FLOORPLANS);
	await client.query("begin");
	try {
		const inserted = await client.query(
			`insert into dining.map_draft
			 (scope, bundle_json, fingerprint, revision, updated_at, updated_by)
			 values ('global', $1, $2, 1, $3, $4)
			 on conflict (scope) do nothing
			 returning revision`,
			[DINING_BOOTSTRAP_FLOORPLANS, fingerprint, now.toISOString(), BOOTSTRAP_ACTOR],
		);
		if (inserted.rowCount === 1) {
			await client.query("commit");
			return { revision: 1, status: "initialized" };
		}
		const existing = await client.query(
			"select revision from dining.map_draft where scope = 'global'",
		);
		const revision = Number(existing.rows[0]?.revision);
		if (!Number.isSafeInteger(revision) || revision < 1) {
			throw new Error("Existing Dining map draft has an invalid revision.");
		}
		await client.query("commit");
		return { revision, status: "already_initialized" };
	} catch (error) {
		await client.query("rollback");
		throw error;
	}
}

export async function bootstrapDiningMap(
	env: NodeJS.ProcessEnv = process.env,
): Promise<{ revision: number; status: "already_initialized" | "initialized" }> {
	const config = readDatabaseConnectionConfig(env, {
		caCertPath: "OPS_WEB_DATABASE_CA_CERT_PATH",
		databaseUrl: "OPS_WEB_DATABASE_URL",
		sslMode: "OPS_WEB_DATABASE_SSLMODE",
	});
	const client = new pg.Client(config);
	await client.connect();
	try {
		return await bootstrapDiningDraft(client);
	} finally {
		await client.end();
	}
}

async function main(): Promise<void> {
	console.log(JSON.stringify(await bootstrapDiningMap(), null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	void main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
