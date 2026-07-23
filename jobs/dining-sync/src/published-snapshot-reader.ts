import {
	type DiningPublishedSnapshot,
	parseDiningPublishedSnapshot,
} from "@campus-agent/dining/domain";
import { Client } from "pg";

export interface DiningPublishedSnapshotRef {
	releaseId: string;
	snapshot: DiningPublishedSnapshot;
}

export class PostgresDiningPublishedSnapshotReader {
	private readonly databaseUrl: string;

	constructor(databaseUrl: string) {
		this.databaseUrl = databaseUrl;
	}

	async read(): Promise<DiningPublishedSnapshotRef> {
		const client = new Client({ connectionString: this.databaseUrl });
		await client.connect();
		try {
			const result = await client.query(`
				select p.catalog_release_id as release_id, r.payload_json, r.snapshot_hash
				from dining.publication p
				join dining.releases r on r.release_id = p.catalog_release_id
				where p.scope = 'global'
				limit 1
			`);
			const row = result.rows[0];
			if (!(row && typeof row.release_id === "string")) {
				throw new Error("Dining review sync requires a published dining snapshot.");
			}
			return {
				releaseId: row.release_id,
				snapshot: parseDiningPublishedSnapshot(row.payload_json, {
					releaseId: row.release_id,
					snapshotHash: String(row.snapshot_hash),
				}),
			};
		} finally {
			await client.end();
		}
	}
}
