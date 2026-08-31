import { createHash } from "node:crypto";
import { extname } from "node:path";

import {
	normalizeNoticeContent,
	parsePortalReleaseTime,
	type NoticeAssetKind,
	type NoticeCategory,
} from "@campus-agent/notices";
import {
	type InternalPortalMeta,
	type InternalPortalNoticeSource,
	validateInternalPortalMeta,
	validateInternalPortalNoticeSource,
} from "ingestion-contracts";
import type { PoolClient } from "pg";

import type { PublisherObjectStore } from "./store.ts";

interface AssetRow {
	assetKind: NoticeAssetKind;
	byteSize: number;
	contentSha256: string;
	contentType: string;
	ordinal: number;
	originalName: string | null;
	portalAnnexId: string | null;
}

interface DatabaseNotice {
	category: NoticeCategory | null;
	externalUrl: string | null;
	isExternal: boolean;
	isPublished: boolean;
	noticeId: number;
	noticeType: number;
	organizationId: string | null;
	releasedAt: string;
	title: string;
}

interface RegisteredNotice extends Omit<DatabaseNotice, "category"> {
	category: NoticeCategory;
}

interface PublishedNotice extends RegisteredNotice {
	assets: AssetRow[];
	contentHtml: string | null;
	contentText: string | null;
}

export async function publishNotices(input: {
	client: PoolClient;
	noticeIds?: readonly number[];
	onProgress?: (progress: NoticePublicationProgress) => void;
	objectStore: PublisherObjectStore;
	portalHost: string;
}): Promise<{ assets: number; notices: number }> {
	const candidates = await loadCandidates(input.client, input.noticeIds);
	if (candidates.length === 0) {
		input.onProgress?.({ phase: "finalizing", processed: 0, total: 0 });
		return { assets: 0, notices: 0 };
	}
	const meta = await loadMeta(input.objectStore);
	const records: PublishedNotice[] = [];
	input.onProgress?.({ phase: "processing", processed: 0, total: candidates.length });
	for (const candidate of candidates) {
		records.push(await loadRecord(input.objectStore, meta, candidate, input.portalHost));
		input.onProgress?.({
			phase: "processing",
			processed: records.length,
			total: candidates.length,
		});
	}

	await input.client.query("BEGIN");
	try {
		for (const [index, record] of records.entries()) {
			input.onProgress?.({ phase: "writing", processed: index, total: records.length });
			await publishOrVerify(input.client, record);
			input.onProgress?.({ phase: "writing", processed: index + 1, total: records.length });
		}
		await input.client.query("COMMIT");
	} catch (error) {
		await input.client.query("ROLLBACK");
		throw error;
	}
	const result = {
		assets: records.reduce((sum, item) => sum + item.assets.length, 0),
		notices: records.length,
	};
	input.onProgress?.({ phase: "finalizing", processed: result.notices, total: result.notices });
	return result;
}

export interface NoticeRepublishResult {
	assets: number;
	notices: number;
	skipped: number;
	unchanged: number;
	updated: number;
}

export async function republishNotices(input: {
	client: PoolClient;
	noticeIds?: readonly number[];
	onProgress?: (progress: NoticePublicationProgress) => void;
	objectStore: PublisherObjectStore;
	portalHost: string;
}): Promise<NoticeRepublishResult> {
	const candidates = await loadCandidates(input.client, input.noticeIds, "republish");
	if (candidates.length === 0) {
		input.onProgress?.({ phase: "finalizing", processed: 0, total: 0 });
		return { assets: 0, notices: 0, skipped: 0, unchanged: 0, updated: 0 };
	}
	const meta = await loadMeta(input.objectStore);
	const records: PublishedNotice[] = [];
	let skipped = 0;
	input.onProgress?.({ phase: "processing", processed: 0, total: candidates.length });
	for (const candidate of candidates) {
		const record = await loadRecord(input.objectStore, meta, candidate, input.portalHost, {
			skipAssetsWhenNoText: true,
		});
		if (record.contentText === null) {
			if (input.noticeIds?.length) {
				throw new Error(`notice ${record.noticeId} has no source body to republish`);
			}
			skipped += 1;
		} else {
			records.push(record);
		}
		input.onProgress?.({
			phase: "processing",
			processed: records.length + skipped,
			total: candidates.length,
		});
	}
	if (records.length === 0) {
		const result = { assets: 0, notices: 0, skipped, unchanged: 0, updated: 0 };
		input.onProgress?.({ phase: "finalizing", processed: 0, total: 0 });
		return result;
	}

	let updated = 0;
	let unchanged = 0;
	await input.client.query("BEGIN");
	try {
		for (const [index, record] of records.entries()) {
			input.onProgress?.({ phase: "writing", processed: index, total: records.length });
			if (await updatePublishedContent(input.client, record)) {
				updated += 1;
			} else {
				unchanged += 1;
			}
			await insertOrVerifyAssets(input.client, record);
			input.onProgress?.({ phase: "writing", processed: index + 1, total: records.length });
		}
		await input.client.query("COMMIT");
	} catch (error) {
		await input.client.query("ROLLBACK");
		throw error;
	}
	const result = {
		assets: records.reduce((sum, item) => sum + item.assets.length, 0),
		notices: records.length,
		skipped,
		unchanged,
		updated,
	};
	input.onProgress?.({ phase: "finalizing", processed: result.notices, total: result.notices });
	return result;
}

export interface NoticePublicationProgress {
	phase: "processing" | "writing" | "finalizing";
	processed: number;
	total: number;
}

async function loadCandidates(
	client: PoolClient,
	noticeIds?: readonly number[],
	mode: "publish" | "republish" = "publish",
): Promise<RegisteredNotice[]> {
	const explicit = noticeIds !== undefined && noticeIds.length > 0;
	const result = explicit
		? await client.query(
				`SELECT notice_id::text, notice_type, organization_id, title, released_at,
				        is_external, external_url, category, is_published
				 FROM notices.notices
				 WHERE notice_id = ANY($1::bigint[])
				 ORDER BY notice_id`,
				[[...noticeIds]],
			)
		: await client.query(
				`SELECT notice_id::text, notice_type, organization_id, title, released_at,
				        is_external, external_url, category, is_published
				 FROM notices.notices
				 WHERE ${mode === "republish" ? "is_published AND NOT is_external" : "category IS NOT NULL AND NOT is_published"}
				 ORDER BY notice_id`,
			);
	const rows = result.rows.map(toDatabaseNotice);
	if (explicit) {
		const byId = new Map(rows.map((row) => [row.noticeId, row]));
		for (const noticeId of noticeIds) {
			const row = byId.get(noticeId);
			if (!row) {
				throw new Error(`notice does not exist: ${noticeId}`);
			}
			if (row.category === null) {
				throw new Error(`notice ${noticeId} has no category`);
			}
			if (mode === "republish" && !row.isPublished) {
				throw new Error(`notice ${noticeId} is not published`);
			}
			if (mode === "republish" && row.isExternal) {
				throw new Error(`notice ${noticeId} is external and cannot be republished`);
			}
		}
	}
	return rows.map((row) => {
		if (row.category === null) {
			throw new Error(`notice ${row.noticeId} has no category`);
		}
		if (mode === "republish" && !row.isPublished) {
			throw new Error(`notice ${row.noticeId} is not published`);
		}
		if (mode === "republish" && row.isExternal) {
			throw new Error(`notice ${row.noticeId} is external and cannot be republished`);
		}
		return { ...row, category: row.category };
	});
}

function toDatabaseNotice(row: Record<string, unknown>): DatabaseNotice {
	return {
		...registeredNoticeFields(row),
		category: row.category === null ? null : (String(row.category) as NoticeCategory),
	};
}

function registeredNoticeFields(row: Record<string, unknown>) {
	return {
		externalUrl: row.external_url === null ? null : String(row.external_url),
		isExternal: Boolean(row.is_external),
		isPublished: Boolean(row.is_published),
		noticeId: Number(row.notice_id),
		noticeType: Number(row.notice_type),
		organizationId: row.organization_id === null ? null : String(row.organization_id),
		releasedAt: new Date(String(row.released_at)).toISOString(),
		title: String(row.title),
	};
}

async function loadMeta(store: PublisherObjectStore): Promise<InternalPortalMeta> {
	const stored = await store.getSource("internal_portal/meta.json");
	let value: unknown;
	try {
		value = JSON.parse(Buffer.from(stored.body).toString("utf8"));
	} catch (error) {
		throw new Error("internal_portal/meta.json is not valid JSON", { cause: error });
	}
	const valid = validateInternalPortalMeta(value);
	if (!valid.ok) {
		throw new Error(`internal_portal/meta.json violates its contract: ${valid.errors.join("; ")}`);
	}
	return value as InternalPortalMeta;
}

export function parseNoticeSource(body: Uint8Array, key: string): InternalPortalNoticeSource {
	let value: unknown;
	try {
		value = JSON.parse(Buffer.from(body).toString("utf8"));
	} catch (error) {
		throw new Error(`${key} is not valid JSON`, { cause: error });
	}
	const valid = validateInternalPortalNoticeSource(value);
	if (!valid.ok) {
		throw new Error(`${key} violates its contract: ${valid.errors.join("; ")}`);
	}
	return value as InternalPortalNoticeSource;
}

async function loadRecord(
	store: PublisherObjectStore,
	meta: InternalPortalMeta,
	registered: RegisteredNotice,
	portalHost: string,
	options: { skipAssetsWhenNoText?: boolean } = {},
): Promise<PublishedNotice> {
	const key = `internal_portal/notices/${registered.noticeId}.json`;
	const stored = await store.getSource(key);
	const source = parseNoticeSource(stored.body, key);
	if (source.notice_id !== registered.noticeId) {
		throw new Error(`${key} has mismatched notice_id`);
	}
	if (!meta.notice_types[String(source.notice_type)]) {
		throw new Error(`${key} references unknown notice_type ${source.notice_type}`);
	}
	if (source.organization_id !== null && !meta.organizations[source.organization_id]) {
		throw new Error(`${key} references unknown organization_id ${source.organization_id}`);
	}
	assertRegisteredSourceMatches(registered, source, key);
	if (!source.is_external) {
		for (const [ordinal, attachment] of source.attachments.entries()) {
			if (!attachment.notice_annex_id) {
				throw new Error(`notice ${source.notice_id} attachment ${ordinal} has no notice_annex_id`);
			}
		}
	}

	const content = normalizePublishedNoticeContent({
		html: source.notice_content_html,
		isExternal: source.is_external,
		portalHost,
		title: source.notice_title,
	});
	const assets: AssetRow[] = [];
	if (!source.is_external && !(options.skipAssetsWhenNoText && content.contentText === null)) {
		for (const image of content.images) {
			assets.push(
				await loadAsset({
					contentTypeSource: image.normalizedUrl,
					kind: "image",
					noticeId: source.notice_id,
					ordinal: image.ordinal,
					originalName: null,
					portalAnnexId: null,
					sourceOrdinal: image.sourceOrdinal,
					store,
				}),
			);
		}
		for (const [ordinal, attachment] of source.attachments.entries()) {
			assets.push(
				await loadAsset({
					contentTypeSource: attachment.notice_annex_name ?? attachment.notice_annex_path,
					kind: "attachment",
					noticeId: source.notice_id,
					ordinal,
					originalName: attachment.notice_annex_name,
					portalAnnexId: attachment.notice_annex_id,
					sourceOrdinal: ordinal,
					store,
				}),
			);
		}
	}

	return {
		...registered,
		assets,
		contentHtml: content.contentHtml,
		contentText: content.contentText,
	};
}

async function updatePublishedContent(client: PoolClient, record: PublishedNotice): Promise<boolean> {
	const existing = await client.query(
		"SELECT content_html, content_text, is_published FROM notices.notices WHERE notice_id=$1 FOR UPDATE",
		[record.noticeId],
	);
	const row = existing.rows[0] as Record<string, unknown> | undefined;
	if (!row || row.is_published !== true) {
		throw new Error(`notice is no longer published: ${record.noticeId}`);
	}
	const unchanged =
		(row.content_html ?? null) === record.contentHtml &&
		(row.content_text ?? null) === record.contentText;
	if (unchanged) {
		return false;
	}
	const updatedResult = await client.query(
		`UPDATE notices.notices
		 SET content_html=$2, content_text=$3
		 WHERE notice_id=$1 AND is_published`,
		[record.noticeId, record.contentHtml, record.contentText],
	);
	if (updatedResult.rowCount !== 1) {
		throw new Error(`notice is no longer published: ${record.noticeId}`);
	}
	return true;
}

function assertRegisteredSourceMatches(
	registered: RegisteredNotice,
	source: InternalPortalNoticeSource,
	key: string,
): void {
	const actual = [
		source.notice_id,
		source.notice_type,
		source.organization_id,
		source.notice_title,
		parsePortalReleaseTime(source.notice_release_time, key),
		source.is_external,
		source.external_url,
	];
	const expected = [
		registered.noticeId,
		registered.noticeType,
		registered.organizationId,
		registered.title,
		registered.releasedAt,
		registered.isExternal,
		registered.externalUrl,
	];
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`registered notice conflicts with source: ${registered.noticeId}`);
	}
}

export function normalizePublishedNoticeContent(input: {
	html: string | null;
	isExternal: boolean;
	portalHost: string;
	title: string;
}): ReturnType<typeof normalizeNoticeContent> {
	if (input.isExternal) {
		return { contentHtml: null, contentText: null, images: [] };
	}
	return normalizeNoticeContent({
		html: input.html,
		portalHost: input.portalHost,
		title: input.title,
	});
}

async function loadAsset(input: {
	contentTypeSource: string | null;
	kind: NoticeAssetKind;
	noticeId: number;
	ordinal: number;
	originalName: string | null;
	portalAnnexId: string | null;
	sourceOrdinal: number;
	store: PublisherObjectStore;
}): Promise<AssetRow> {
	const source = await input.store.getSource(
		`internal_portal/notices/${input.noticeId}/${
			input.kind === "image" ? "images" : "attachments"
		}/${input.sourceOrdinal}`,
	);
	const contentSha256 = createHash("sha256").update(source.body).digest("hex");
	const contentType = resolveAssetContentType(source.contentType, input.contentTypeSource);
	if (input.kind === "image") {
		await input.store.createOrVerifyDerived({
			body: source.body,
			contentType,
			digest: contentSha256,
		});
	}
	return {
		assetKind: input.kind,
		byteSize: source.body.byteLength,
		contentSha256,
		contentType,
		ordinal: input.ordinal,
		originalName: input.originalName,
		portalAnnexId: input.portalAnnexId,
	};
}

async function publishOrVerify(client: PoolClient, record: PublishedNotice): Promise<void> {
	if (record.isPublished) {
		await verifyPublishedContent(client, record);
	} else {
		const updated = await client.query(
			`UPDATE notices.notices
			 SET content_html=$2, content_text=$3, is_published=true
			 WHERE notice_id=$1 AND NOT is_published`,
			[record.noticeId, record.contentHtml, record.contentText],
		);
		if (updated.rowCount !== 1) {
			await verifyPublishedContent(client, record);
		}
	}
	await insertOrVerifyAssets(client, record);
}

async function verifyPublishedContent(client: PoolClient, record: PublishedNotice): Promise<void> {
	const existing = await client.query(
		"SELECT content_html, content_text, is_published FROM notices.notices WHERE notice_id=$1",
		[record.noticeId],
	);
	const row = existing.rows[0] as Record<string, unknown> | undefined;
	if (
		!row ||
		row.is_published !== true ||
		(row.content_html ?? null) !== record.contentHtml ||
		(row.content_text ?? null) !== record.contentText
	) {
		throw new Error(`published notice conflicts: ${record.noticeId}`);
	}
}

async function insertOrVerifyAssets(client: PoolClient, record: PublishedNotice): Promise<void> {
	const storedAssets = await client.query(
		"SELECT asset_kind, ordinal, original_name, content_type, byte_size, content_sha256, portal_annex_id FROM notices.notice_assets WHERE notice_id=$1 ORDER BY asset_kind, ordinal",
		[record.noticeId],
	);
	if (storedAssets.rows.length) {
		const actual = storedAssets.rows.map((row) => [
			row.asset_kind,
			Number(row.ordinal),
			row.original_name ?? null,
			row.content_type,
			Number(row.byte_size),
			row.content_sha256,
			row.portal_annex_id ?? null,
		]);
		const expected = record.assets
			.map((asset) => [
				asset.assetKind,
				asset.ordinal,
				asset.originalName,
				asset.contentType,
				asset.byteSize,
				asset.contentSha256,
				asset.portalAnnexId,
			])
			.sort(compareAssetRows);
		if (JSON.stringify(actual) !== JSON.stringify(expected)) {
			throw new Error(`published notice assets conflict: ${record.noticeId}`);
		}
	} else {
		for (const asset of record.assets) {
			await client.query(
				"INSERT INTO notices.notice_assets(notice_id, asset_kind, ordinal, original_name, content_type, byte_size, content_sha256, portal_annex_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
				[
					record.noticeId,
					asset.assetKind,
					asset.ordinal,
					asset.originalName,
					asset.contentType,
					asset.byteSize,
					asset.contentSha256,
					asset.portalAnnexId,
				],
			);
		}
	}
}

function compareAssetRows(left: unknown[], right: unknown[]): number {
	return String(left[0]).localeCompare(String(right[0])) || Number(left[1]) - Number(right[1]);
}

export function resolveAssetContentType(
	sourceContentType: string | null,
	value: string | null,
): string {
	const normalizedSourceType = sourceContentType?.split(";", 1)[0]?.trim().toLowerCase();
	if (normalizedSourceType && normalizedSourceType !== "application/octet-stream") {
		return normalizedSourceType;
	}
	return guessContentType(value);
}

function guessContentType(value: string | null): string {
	const extension = extname(
		new URL(value ?? "file", "https://local.invalid").pathname,
	).toLowerCase();
	return (
		(
			{
				".bmp": "image/bmp",
				".doc": "application/msword",
				".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
				".gif": "image/gif",
				".jpeg": "image/jpeg",
				".jpg": "image/jpeg",
				".pdf": "application/pdf",
				".png": "image/png",
				".ppt": "application/vnd.ms-powerpoint",
				".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
				".rar": "application/vnd.rar",
				".xls": "application/vnd.ms-excel",
				".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
				".zip": "application/zip",
			} as Record<string, string>
		)[extension] ?? "application/octet-stream"
	);
}
