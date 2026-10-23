import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { DINING_BOOTSTRAP_FLOORPLANS } from "@campus-agent/dining/bootstrap";
import { diningMapBundleFingerprint } from "@campus-agent/dining/publisher";
import pg from "pg";
import { createDiningFloorplanAssetStoreFromEnv } from "../../src/server/dining-floorplan-assets.ts";
import { createPgDiningStore } from "../../src/server/dining-store.ts";
import type { DiningMapStore } from "../../src/server/dining-store-contract.ts";
import { readDatabaseConnectionConfig } from "./postgres-tls.ts";

const BOOTSTRAP_ACTOR = {
	displayName: "Dining bootstrap",
	principalId: "system:dining-bootstrap",
} as const;

interface BootstrapDatabase {
	query(
		sql: string,
		values?: unknown[],
	): Promise<{ rowCount: number | null; rows: Record<string, unknown>[] }>;
}

interface BootstrapInventory {
	draftCount: number;
	publicationCount: number;
	releaseCount: number;
	resolvedPublicationCount: number;
}

export interface DiningBootstrapResult {
	releaseId: string;
	revision: number;
	status: "already_published" | "baseline_published" | "initialized_and_published";
}

export async function bootstrapDiningPublication(input: {
	database: BootstrapDatabase;
	now?: Date;
	store: Pick<DiningMapStore, "getState" | "publish">;
}): Promise<DiningBootstrapResult> {
	let inventory = await loadBootstrapInventory(input.database);
	let insertedDraft = false;

	if (isEmptyInventory(inventory)) {
		insertedDraft = await insertBootstrapDraft(input.database, input.now ?? new Date());
		inventory = await loadBootstrapInventory(input.database);
	}

	assertSupportedInventory(inventory);
	const state = await input.store.getState();
	if (state.currentRelease) {
		return {
			releaseId: state.currentRelease.releaseId,
			revision: state.draft.revision,
			status: "already_published",
		};
	}

	if (inventory.publicationCount > 0 || inventory.releaseCount > 0) {
		throw new Error("Dining bootstrap found releases without a valid current publication.");
	}

	const bootstrapFingerprint = diningMapBundleFingerprint(DINING_BOOTSTRAP_FLOORPLANS);
	if (state.draft.fingerprint !== bootstrapFingerprint) {
		throw new Error("Dining bootstrap refuses to publish a non-baseline draft.");
	}

	const release = await input.store.publish(BOOTSTRAP_ACTOR, state.draft.revision);
	return {
		releaseId: release.releaseId,
		revision: state.draft.revision,
		status: insertedDraft ? "initialized_and_published" : "baseline_published",
	};
}

export async function bootstrapDiningMap(
	env: NodeJS.ProcessEnv = process.env,
): Promise<DiningBootstrapResult> {
	const config = readDatabaseConnectionConfig(env, {
		caCertPath: "OPS_WEB_DATABASE_CA_CERT_PATH",
		databaseUrl: "OPS_WEB_DATABASE_URL",
		sslMode: "OPS_WEB_DATABASE_SSLMODE",
	});
	const pool = new pg.Pool({ ...config, max: 1 });
	try {
		return await bootstrapDiningPublication({
			database: pool,
			store: createPgDiningStore({
				assetStore: createDiningFloorplanAssetStoreFromEnv(env),
				pool,
			}),
		});
	} finally {
		await pool.end();
	}
}

async function loadBootstrapInventory(database: BootstrapDatabase): Promise<BootstrapInventory> {
	const result = await database.query(`
		select
			(select count(*) from dining.map_draft) as draft_count,
			(select count(*) from dining.map_releases) as release_count,
			(select count(*) from dining.map_publication) as publication_count,
			(select count(*)
			 from dining.map_publication publication
			 join dining.map_releases release on release.release_id = publication.release_id
			) as resolved_publication_count
	`);
	const row = result.rows[0];
	if (!row) {
		throw new Error("Dining bootstrap inventory query returned no row.");
	}
	return {
		draftCount: nonNegativeInteger(row.draft_count, "draft count"),
		publicationCount: nonNegativeInteger(row.publication_count, "publication count"),
		releaseCount: nonNegativeInteger(row.release_count, "release count"),
		resolvedPublicationCount: nonNegativeInteger(
			row.resolved_publication_count,
			"resolved publication count",
		),
	};
}

async function insertBootstrapDraft(database: BootstrapDatabase, now: Date): Promise<boolean> {
	const fingerprint = diningMapBundleFingerprint(DINING_BOOTSTRAP_FLOORPLANS);
	const inserted = await database.query(
		`insert into dining.map_draft
		 (scope, bundle_json, fingerprint, revision, updated_at, updated_by)
		 values ('global', $1, $2, 1, $3, $4)
		 on conflict (scope) do nothing
		 returning revision`,
		[DINING_BOOTSTRAP_FLOORPLANS, fingerprint, now.toISOString(), BOOTSTRAP_ACTOR.principalId],
	);
	return inserted.rowCount === 1;
}

function isEmptyInventory(inventory: BootstrapInventory): boolean {
	return (
		inventory.draftCount === 0 &&
		inventory.releaseCount === 0 &&
		inventory.publicationCount === 0 &&
		inventory.resolvedPublicationCount === 0
	);
}

function assertSupportedInventory(inventory: BootstrapInventory): void {
	if (inventory.draftCount !== 1) {
		throw new Error("Dining bootstrap requires exactly one global draft.");
	}
	if (inventory.publicationCount > 1 || inventory.resolvedPublicationCount > 1) {
		throw new Error("Dining bootstrap found multiple current publications.");
	}
	if (
		inventory.publicationCount === 1 &&
		(inventory.releaseCount < 1 || inventory.resolvedPublicationCount !== 1)
	) {
		throw new Error("Dining bootstrap found a publication with a missing release.");
	}
	if (inventory.publicationCount === 0 && inventory.resolvedPublicationCount !== 0) {
		throw new Error("Dining bootstrap inventory is inconsistent.");
	}
}

function nonNegativeInteger(value: unknown, label: string): number {
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 0) {
		throw new Error(`Dining bootstrap ${label} is invalid.`);
	}
	return parsed;
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
