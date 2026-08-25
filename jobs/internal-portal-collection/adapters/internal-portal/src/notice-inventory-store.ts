import { parsePortalReleaseTime } from "@campus-agent/notices";
import type { InternalPortalNoticeSource } from "ingestion-contracts";
import type { Pool } from "pg";

export interface NoticeInventoryMappings {
	noticeTypes: Record<string, string>;
	organizations: Record<string, string>;
}

export interface NoticeInventoryStore {
	register(source: InternalPortalNoticeSource): Promise<"reused" | "written">;
	upsertMappings(mappings: NoticeInventoryMappings): Promise<void>;
}

export function createNoticeInventoryStore(pool: Pool): NoticeInventoryStore {
	return {
		async upsertMappings(mappings) {
			for (const [id, name] of Object.entries(mappings.noticeTypes)) {
				await pool.query(
					"INSERT INTO notices.notice_types(notice_type, name) VALUES ($1, $2) ON CONFLICT (notice_type) DO UPDATE SET name=EXCLUDED.name",
					[Number(id), name],
				);
			}
			for (const [id, name] of Object.entries(mappings.organizations)) {
				await pool.query(
					"INSERT INTO notices.organizations(organization_id, name) VALUES ($1, $2) ON CONFLICT (organization_id) DO UPDATE SET name=EXCLUDED.name",
					[id, name],
				);
			}
		},
		async register(source) {
			const releasedAt = parsePortalReleaseTime(
				source.notice_release_time,
				`internal_portal/notices/${source.notice_id}.json`,
			);
			const inserted = await pool.query(
				`INSERT INTO notices.notices(
					notice_id, notice_type, organization_id, title, released_at,
					is_external, external_url
				 ) VALUES ($1,$2,$3,$4,$5,$6,$7)
				 ON CONFLICT (notice_id) DO NOTHING
				 RETURNING notice_id`,
				[
					source.notice_id,
					source.notice_type,
					source.organization_id,
					source.notice_title,
					releasedAt,
					source.is_external,
					source.external_url,
				],
			);
			if (inserted.rowCount === 1) {
				return "written";
			}
			const existing = await pool.query(
				`SELECT notice_type, organization_id, title, released_at, is_external, external_url
				 FROM notices.notices WHERE notice_id=$1`,
				[source.notice_id],
			);
			const row = existing.rows[0] as Record<string, unknown> | undefined;
			const actual = row
				? [
						Number(row.notice_type),
						row.organization_id ?? null,
						row.title,
						new Date(String(row.released_at)).toISOString(),
						row.is_external,
						row.external_url ?? null,
					]
				: [];
			const expected = [
				source.notice_type,
				source.organization_id,
				source.notice_title,
				releasedAt,
				source.is_external,
				source.external_url,
			];
			if (JSON.stringify(actual) !== JSON.stringify(expected)) {
				throw new Error(`registered notice conflicts with source: ${source.notice_id}`);
			}
			return "reused";
		},
	};
}
