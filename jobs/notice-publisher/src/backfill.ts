import type { PoolClient } from "pg";
import type { InternalPortalNoticeSource } from "ingestion-contracts";
import { parseNoticeSource } from "./publisher.ts";
import type { PublisherObjectStore } from "./store.ts";

export interface AttachmentLinkBackfillResult {
	alreadyFilled: number;
	mode: "apply" | "dry_run";
	notices: number;
	pending: number;
	updated: number;
	attachments: number;
}

interface AttachmentRow {
	noticeId: number;
	ordinal: number;
	portalAnnexId: string | null;
	sourceRef: string | null;
}

interface AttachmentUpdate {
	noticeId: number;
	ordinal: number;
	portalAnnexId: string;
}

export async function backfillAttachmentLinks(input: {
	client: PoolClient;
	dryRun: boolean;
	noticeIds?: readonly number[];
	objectStore: PublisherObjectStore;
}): Promise<AttachmentLinkBackfillResult> {
	const rows = await loadAttachmentRows(input.client, input.noticeIds);
	const updates: AttachmentUpdate[] = [];
	const failures: string[] = [];
	const noticeIds = new Set<number>();
	const sourcePromises = new Map<number, Promise<InternalPortalNoticeSource>>();

	for (const row of rows) {
		noticeIds.add(row.noticeId);
		try {
			const source = await loadSourceCached(input.objectStore, sourcePromises, row.noticeId, row.sourceRef);
			const attachment = source.attachments[row.ordinal];
			if (!attachment) {
				throw new Error(`attachment ordinal ${row.ordinal} is absent from source`);
			}
			const portalAnnexId = attachment.notice_annex_id?.trim();
			if (!portalAnnexId) {
				throw new Error(`attachment ordinal ${row.ordinal} has no notice_annex_id`);
			}
			if (row.portalAnnexId !== null && row.portalAnnexId !== portalAnnexId) {
				throw new Error(
					`stored portal_annex_id ${row.portalAnnexId} conflicts with source ${portalAnnexId}`,
				);
			}
			if (row.portalAnnexId === null) {
				updates.push({ noticeId: row.noticeId, ordinal: row.ordinal, portalAnnexId });
			}
		} catch (error) {
			failures.push(
				`notice ${row.noticeId} attachment ${row.ordinal}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	if (failures.length > 0) {
		throw new Error(`attachment link backfill failed:\n${failures.join("\n")}`);
	}

	if (!input.dryRun && updates.length > 0) {
		await input.client.query("BEGIN");
		try {
			for (const update of updates) {
				const result = await input.client.query(
					`UPDATE notices.notice_assets
					 SET portal_annex_id = $3
					 WHERE notice_id = $1 AND asset_kind = 'attachment' AND ordinal = $2`,
					[update.noticeId, update.ordinal, update.portalAnnexId],
				);
				if (result.rowCount !== 1) {
					throw new Error(
						`notice ${update.noticeId} attachment ${update.ordinal} disappeared during backfill`,
					);
				}
			}
			await input.client.query("COMMIT");
		} catch (error) {
			await input.client.query("ROLLBACK");
			throw error;
		}
	}

	return {
		alreadyFilled: rows.length - updates.length,
		attachments: rows.length,
		mode: input.dryRun ? "dry_run" : "apply",
		notices: noticeIds.size,
		pending: input.dryRun ? updates.length : 0,
		updated: input.dryRun ? 0 : updates.length,
	};
}

async function loadAttachmentRows(
	client: PoolClient,
	noticeIds?: readonly number[],
): Promise<AttachmentRow[]> {
	const result = noticeIds && noticeIds.length > 0
		? await client.query(
				`SELECT notice_id::text, ordinal, portal_annex_id, (SELECT published_source_ref FROM notices.notices n WHERE n.notice_id=notice_assets.notice_id) AS source_ref
				 FROM notices.notice_assets
				 WHERE asset_kind = 'attachment' AND notice_id = ANY($1::bigint[])
				 ORDER BY notice_id, ordinal`,
				[[...noticeIds]],
			)
		: await client.query(
				`SELECT notice_id::text, ordinal, portal_annex_id, (SELECT published_source_ref FROM notices.notices n WHERE n.notice_id=notice_assets.notice_id) AS source_ref
				 FROM notices.notice_assets
				 WHERE asset_kind = 'attachment'
				 ORDER BY notice_id, ordinal`,
			);
	return result.rows.map((row) => ({
		noticeId: Number(row.notice_id),
		sourceRef: row.source_ref ?? null,
		ordinal: Number(row.ordinal),
		portalAnnexId: row.portal_annex_id === null ? null : String(row.portal_annex_id),
	}));
}

async function loadSource(
	objectStore: PublisherObjectStore,
	noticeId: number,
	sourceRef: string | null,
): Promise<InternalPortalNoticeSource> {
	const key = sourceRef ?? `internal_portal/notices/${noticeId}.json`;
	const source = parseNoticeSource((await objectStore.getSource(key)).body, key);
	if (source.notice_id !== noticeId) {
		throw new Error(`source notice_id is ${source.notice_id}`);
	}
	return source;
}

function loadSourceCached(
	objectStore: PublisherObjectStore,
	cache: Map<number, Promise<InternalPortalNoticeSource>>,
	noticeId: number,
	sourceRef: string | null,
): Promise<InternalPortalNoticeSource> {
	const existing = cache.get(noticeId);
	if (existing) {
		return existing;
	}
	const source = loadSource(objectStore, noticeId, sourceRef);
	cache.set(noticeId, source);
	return source;
}
