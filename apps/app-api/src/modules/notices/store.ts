import type { NoticeListRequestQuery } from "campus-contracts/notices";
import { type SQL, sql } from "drizzle-orm";

import type { Env } from "../../config";
import { createRuntimeDbGetter, type RuntimeDatabase } from "../../db/runtime";
import type { NoticeAssetRecord, NoticeListRecords, NoticeRecord, NoticeStore } from "./types";

type RuntimeDbGetter = () => Promise<RuntimeDatabase>;

interface NoticeRow extends Record<string, unknown> {
	domain: string;
	external_url: string | null;
	is_external: boolean;
	notice_id: string | number;
	notice_type: number;
	notice_type_name: string;
	organization_id: string | null;
	organization_name: string | null;
	released_at: Date | string;
	title: string;
}

interface NoticeDetailRow extends NoticeRow {
	content_html: string | null;
}

interface NoticeAssetRow extends Record<string, unknown> {
	asset_kind: "attachment" | "image";
	byte_size: string | number;
	content_sha256: string;
	content_type: string;
	ordinal: number;
	original_name: string | null;
	portal_annex_id: string | null;
}

export function createPgNoticeStore(
	env: Env,
	input: { getDb?: RuntimeDbGetter } = {},
): NoticeStore {
	const getDb = input.getDb ?? createRuntimeDbGetter(env);

	return {
		async getDetail(noticeId) {
			const db = await getDb();
			const noticeResult = await db.execute<NoticeDetailRow>(sql`
				SELECT
					n.domain,
					n.external_url,
					n.is_external,
					n.notice_id::text,
					n.notice_type,
					t.name AS notice_type_name,
					n.organization_id,
					o.name AS organization_name,
					n.released_at,
					n.title,
					n.content_html
				FROM notices.notices AS n
				JOIN notices.notice_types AS t ON t.notice_type = n.notice_type
				LEFT JOIN notices.organizations AS o ON o.organization_id = n.organization_id
				WHERE n.notice_id = ${noticeId}::bigint AND NOT n.is_external
			`);
			const row = noticeResult.rows[0];
			if (!row) {
				return null;
			}
			const assetResult = await db.execute<NoticeAssetRow>(sql`
				SELECT
					asset_kind,
					ordinal,
					original_name,
					content_type,
					byte_size::text,
					content_sha256,
					portal_annex_id
				FROM notices.notice_assets
				WHERE notice_id = ${noticeId}::bigint
				ORDER BY asset_kind, ordinal
			`);
			return {
				...toNoticeRecord(row),
				assets: assetResult.rows.map(toNoticeAssetRecord),
				contentHtml: row.content_html,
			};
		},
		async getImageAsset(noticeId, ordinal) {
			const result = await (await getDb()).execute<NoticeAssetRow>(sql`
				SELECT
					a.asset_kind,
					a.ordinal,
					a.original_name,
					a.content_type,
					a.byte_size::text,
					a.content_sha256,
					a.portal_annex_id
				FROM notices.notice_assets AS a
				JOIN notices.notices AS n ON n.notice_id = a.notice_id
				WHERE
					a.notice_id = ${noticeId}::bigint
					AND a.asset_kind = 'image'
					AND a.ordinal = ${ordinal}
					AND NOT n.is_external
			`);
			const row = result.rows[0];
			return row
				? {
						byteSize: String(row.byte_size),
						contentSha256: row.content_sha256,
						contentType: row.content_type,
					}
				: null;
		},
		async list(input) {
			const db = await getDb();
			const where = noticeWhere(input);
			const offset = (input.page - 1) * 30;
			const [countResult, itemResult, typeResult, organizationResult] = await Promise.all([
				db.execute<{ count: string }>(sql`
					SELECT count(*)::text AS count
					FROM notices.notices AS n
					${where}
				`),
				db.execute<NoticeRow>(sql`
					SELECT
						n.domain,
						n.external_url,
						n.is_external,
						n.notice_id::text,
						n.notice_type,
						t.name AS notice_type_name,
						n.organization_id,
						o.name AS organization_name,
						n.released_at,
						n.title
					FROM notices.notices AS n
					JOIN notices.notice_types AS t ON t.notice_type = n.notice_type
					LEFT JOIN notices.organizations AS o ON o.organization_id = n.organization_id
					${where}
					ORDER BY n.released_at DESC, n.notice_id DESC
					LIMIT 30 OFFSET ${offset}
				`),
				db.execute<{ name: string; notice_type: number }>(sql`
					SELECT notice_type, name FROM notices.notice_types ORDER BY notice_type
				`),
				db.execute<{ name: string; organization_id: string }>(sql`
					SELECT o.organization_id, o.name
					FROM notices.organizations AS o
					WHERE EXISTS (
						SELECT 1
						FROM notices.notices AS n
						WHERE n.organization_id = o.organization_id
					)
					ORDER BY o.name, o.organization_id
				`),
			]);
			return {
				items: itemResult.rows.map(toNoticeRecord),
				noticeTypes: typeResult.rows.map((row) => ({ id: row.notice_type, name: row.name })),
				organizations: organizationResult.rows.map((row) => ({
					id: row.organization_id,
					name: row.name,
				})),
				totalItems: Number(countResult.rows[0]?.count ?? "0"),
			} satisfies NoticeListRecords;
		},
	};
}

function noticeWhere(input: NoticeListRequestQuery): SQL {
	const conditions: SQL[] = [];
	if (input.q) {
		const pattern = containsPattern(input.q);
		conditions.push(
			sql`(n.title ILIKE ${pattern} OR COALESCE(n.content_text, '') ILIKE ${pattern})`,
		);
	}
	if (input.domain) {
		conditions.push(sql`n.domain = ${input.domain}`);
	}
	if (input.organization_id) {
		conditions.push(sql`n.organization_id = ${input.organization_id}`);
	}
	if (input.notice_type !== undefined) {
		conditions.push(sql`n.notice_type = ${input.notice_type}`);
	}
	if (input.is_external !== undefined) {
		conditions.push(sql`n.is_external = ${input.is_external}`);
	}
	if (input.from) {
		conditions.push(
			sql`n.released_at >= (${input.from}::date::timestamp AT TIME ZONE 'Asia/Shanghai')`,
		);
	}
	if (input.to) {
		conditions.push(
			sql`n.released_at < ((${input.to}::date + 1)::timestamp AT TIME ZONE 'Asia/Shanghai')`,
		);
	}
	return conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;
}

function containsPattern(value: string): string {
	return `%${value.replace(/[\\%_]/gu, "\\$&")}%`;
}

function toNoticeRecord(row: NoticeRow): NoticeRecord {
	return {
		domain: row.domain,
		externalUrl: row.external_url,
		isExternal: row.is_external,
		noticeId: String(row.notice_id),
		noticeType: { id: row.notice_type, name: row.notice_type_name },
		organization:
			row.organization_id && row.organization_name
				? { id: row.organization_id, name: row.organization_name }
				: null,
		releasedAt: row.released_at,
		title: row.title,
	};
}

function toNoticeAssetRecord(row: NoticeAssetRow): NoticeAssetRecord {
	return {
		byteSize: String(row.byte_size),
		contentSha256: row.content_sha256,
		contentType: row.content_type,
		kind: row.asset_kind,
		name: row.original_name,
		ordinal: row.ordinal,
		portalAnnexId: row.portal_annex_id,
	};
}
