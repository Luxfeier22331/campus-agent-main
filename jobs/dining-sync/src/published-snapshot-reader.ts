import type { DiningPublishedSnapshot } from "@campus-agent/dining/domain";
import { Client } from "pg";

export class PostgresDiningPublishedSnapshotReader {
	constructor(private readonly databaseUrl: string) {}

	async read(): Promise<DiningPublishedSnapshot> {
		const client = new Client({ connectionString: this.databaseUrl });
		await client.connect();
		try {
			const result = await client.query(`
				select p.catalog_release_id as release_id, r.payload_json
				from "dining"."publication" p
				join "dining"."releases" r on r.release_id = p.catalog_release_id
				where p.scope = 'global'
				limit 1
			`);
			const row = result.rows[0];
			if (!row) {
				throw new Error("Dining review sync requires a published dining snapshot.");
			}
			return parsePublishedSnapshot(row.payload_json, row.release_id);
		} finally {
			await client.end();
		}
	}
}

function parsePublishedSnapshot(value: unknown, releaseId: unknown): DiningPublishedSnapshot {
	if (!isRecord(value) || !Array.isArray(value.halls) || !isRecord(value.floors)) {
		throw new Error("Dining published snapshot has an invalid payload.");
	}
	if (!isRecord(value.source) || value.source.releaseId !== releaseId) {
		throw new Error("Dining published snapshot release identity does not match its latest pointer.");
	}
	return value as unknown as DiningPublishedSnapshot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
