import { parsePortalReleaseTime } from "@campus-agent/notices";
import type { InternalPortalNoticeSource } from "ingestion-contracts";
import { noticeSourceRef } from "ingestion-contracts/notice-source-ref";
import type { Pool } from "pg";

import { NoticeIngestionDataError } from "./notice-ingestion-errors.js";

export interface NoticeInventoryMappings {
	noticeTypes: Record<string, string>;
	organizations: Record<string, string>;
}

export interface NoticeInventoryStore {
	getSourceRefs(noticeIds: readonly number[]): Promise<Map<number, string | null>>;
	register(source: InternalPortalNoticeSource): Promise<"reused" | "written" | "updated">;
	listExisting?(from: string, to: string): Promise<NoticeCandidateRecord[]>;
	markUnavailable(noticeId: number): Promise<void>;
	upsertMappings(mappings: NoticeInventoryMappings): Promise<void>;
}

export interface NoticeCandidateRecord {
	notice_id: number;
	notice_type: number;
	organization_id: string | null;
}

export function createNoticeInventoryStore(pool: Pick<Pool, "query">): NoticeInventoryStore {
	return {
		async getSourceRefs(noticeIds) {
			if (noticeIds.length === 0) return new Map();
			const result = await pool.query(
				"SELECT notice_id, source_ref FROM notices.notices WHERE notice_id = ANY($1::bigint[])",
				[[...noticeIds]],
			);
			return new Map(result.rows.map((row) => [Number(row.notice_id), row.source_ref ?? null]));
		},
		async listExisting(from, to) {
			const result = await pool.query(
				"SELECT notice_id, notice_type, organization_id FROM notices.notices WHERE released_at >= $1::date AT TIME ZONE 'Asia/Shanghai' AND released_at < $2::date AT TIME ZONE 'Asia/Shanghai' ORDER BY notice_id",
				[from, to],
			);
			return result.rows.map((row) => ({ notice_id: Number(row.notice_id), notice_type: Number(row.notice_type), organization_id: row.organization_id ?? null }));
		},
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
			let releasedAt: string;
			try {
				releasedAt = parsePortalReleaseTime(
					source.notice_release_time,
					`internal_portal/notices/${source.notice_id}.json`,
				);
			} catch (error) {
				throw new NoticeIngestionDataError({
					cause: error,
					message: `notice ${source.notice_id} has an invalid release time`,
					noticeId: source.notice_id,
					operation: "inventory",
				});
			}
			const sourceRef = noticeSourceRef(source);
			const inserted = await pool.query(
				`INSERT INTO notices.notices(
					notice_id, notice_type, organization_id, title, released_at,
					is_external, external_url, source_ref
				 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
				 ON CONFLICT (notice_id) DO UPDATE SET
					notice_type=CASE WHEN notices.notices.is_published THEN notices.notices.notice_type ELSE EXCLUDED.notice_type END,
					organization_id=CASE WHEN notices.notices.is_published THEN notices.notices.organization_id ELSE EXCLUDED.organization_id END,
					title=CASE WHEN notices.notices.is_published THEN notices.notices.title ELSE EXCLUDED.title END,
					released_at=CASE WHEN notices.notices.is_published THEN notices.notices.released_at ELSE EXCLUDED.released_at END,
					is_external=CASE WHEN notices.notices.is_published THEN notices.notices.is_external ELSE EXCLUDED.is_external END,
				external_url=CASE WHEN notices.notices.is_published THEN notices.notices.external_url ELSE EXCLUDED.external_url END,
				source_ref=EXCLUDED.source_ref,
				unavailable_at=NULL
			 WHERE notices.notices.source_ref IS DISTINCT FROM EXCLUDED.source_ref
				OR notices.notices.unavailable_at IS NOT NULL
			 RETURNING notice_id, (xmax = 0) AS inserted`,
				[
					source.notice_id,
					source.notice_type,
					source.organization_id,
					source.notice_title,
					releasedAt,
					source.is_external,
				source.external_url,
				sourceRef,
			],
			);
			if (inserted.rowCount === 1) {
				return inserted.rows[0]?.inserted === false ? "updated" : "written";
			}
			return "reused";
		},
		async markUnavailable(noticeId) {
			// Keep rows and objects; consumers filter on unavailable_at. Idempotent so
			// repeated portal confirmations do not move the timestamp.
			await pool.query(
				`UPDATE notices.notices
				 SET unavailable_at = now()
				 WHERE notice_id = $1 AND unavailable_at IS NULL`,
				[noticeId],
			);
		},
	};
}
