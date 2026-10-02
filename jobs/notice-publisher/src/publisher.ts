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
import { noticeSourceRef } from "ingestion-contracts/notice-source-ref";
import type { PoolClient } from "pg";
import { recordNoticeProcessingFailure } from "@campus-agent/notice-database";

export class NoticePublicationDataError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "NoticePublicationDataError";
	}
}

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
	sourceRef: string | null;
	publishedSourceRef: string | null;
}

interface RegisteredNotice extends Omit<DatabaseNotice, "category"> {
	category: NoticeCategory;
}

interface PublishedNotice extends RegisteredNotice {
	assets: AssetRow[];
	contentHtml: string | null;
	contentText: string | null;
	source: InternalPortalNoticeSource;
}

export async function publishNotices(input: {
	client: PoolClient;
	signal?: AbortSignal;
	noticeIds?: readonly number[];
	onProgress?: (progress: NoticePublicationProgress) => void;
	objectStore: PublisherObjectStore;
	portalHost: string;
}): Promise<{ assets: number; notices: number; failed: number; outcome: "success" | "partial" }> {
	const candidates = await loadCandidates(input.client, input.noticeIds);
	const result = { assets: 0, notices: 0, failed: 0, outcome: "success" as "success" | "partial" };
	if (!candidates.length) {
		input.onProgress?.({ phase: "finalizing", processed: 0, total: 0 });
		return result;
	}
	const meta = await loadMeta(input.objectStore);
	let processed = 0;
	for (const candidate of candidates) {
		input.signal?.throwIfAborted();
		input.onProgress?.({ phase: "processing", processed, total: candidates.length });
		try {
			const record = await loadRecord(input.objectStore, meta, candidate, input.portalHost);
			input.signal?.throwIfAborted();
			await input.client.query("BEGIN");
			try {
				await publishOrVerify(input.client, record);
				await input.client.query("DELETE FROM notices.processing_failures WHERE notice_id=$1 AND stage='publication'", [record.noticeId]);
				await input.client.query("COMMIT");
			} catch (error) {
				await input.client.query("ROLLBACK");
				throw error;
			}
			result.assets += record.assets.length;
			result.notices += 1;
		} catch (error) {
			if (!(error instanceof NoticePublicationDataError)) throw error;
			input.signal?.throwIfAborted();
			await recordNoticeProcessingFailure(input.client, candidate.noticeId, "publication", error);
			result.failed += 1;
			result.outcome = "partial";
		}
		processed += 1;
		input.onProgress?.({ phase: "writing", processed, total: candidates.length });
	}
	input.onProgress?.({ phase: "finalizing", processed, total: candidates.length });
	return result;
}

export interface NoticeRepublishResult {
	assets: number;
	failed: number;
	notices: number;
	outcome: "success" | "partial";
	skipped: number;
	unchanged: number;
	updated: number;
}

export async function republishNotices(input: {
	client: PoolClient;
	signal?: AbortSignal;
	noticeIds?: readonly number[];
	onProgress?: (progress: NoticePublicationProgress) => void;
	objectStore: PublisherObjectStore;
	portalHost: string;
}): Promise<NoticeRepublishResult> {
	const candidates = await loadCandidates(input.client, input.noticeIds, "republish");
	const result: NoticeRepublishResult = {
		assets: 0,
		failed: 0,
		notices: 0,
		outcome: "success",
		skipped: 0,
		unchanged: 0,
		updated: 0,
	};
	if (candidates.length === 0) {
		input.onProgress?.({ phase: "finalizing", processed: 0, total: 0 });
		return result;
	}
	const meta = await loadMeta(input.objectStore);
	for (const [index, candidate] of candidates.entries()) {
		input.signal?.throwIfAborted();
		input.onProgress?.({ phase: "processing", processed: index, total: candidates.length });
		try {
			const record = await loadRecord(input.objectStore, meta, candidate, input.portalHost);

			{
				await input.client.query("BEGIN");
				try {
					if (await updatePublishedContent(input.client, record, noticeSourceRef(record.source))) {
						result.updated += 1;
					} else {
						result.unchanged += 1;
					}
					await replaceAssets(input.client, record);
					await input.client.query(
						"DELETE FROM notices.processing_failures WHERE notice_id=$1 AND stage='publication'",
						[record.noticeId],
					);
					await input.client.query("COMMIT");
				} catch (error) {
					await input.client.query("ROLLBACK");
					throw error;
				}
				result.assets += record.assets.length;
				result.notices += 1;
			}
		} catch (error) {
			if (!(error instanceof NoticePublicationDataError)) throw error;
			input.signal?.throwIfAborted();
			await recordNoticeProcessingFailure(input.client, candidate.noticeId, "publication", error);
			result.failed += 1;
			result.outcome = "partial";
		}
		input.onProgress?.({ phase: "writing", processed: index + 1, total: candidates.length });
	}
	input.onProgress?.({ phase: "finalizing", processed: candidates.length, total: candidates.length });
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
				        is_external, external_url, category, is_published, source_ref, published_source_ref
				 FROM notices.notices
				 WHERE notice_id = ANY($1::bigint[])
				 ORDER BY notice_id`,
				[[...noticeIds]],
			)
		: await client.query(
				`SELECT notice_id::text, notice_type, organization_id, title, released_at,
				        is_external, external_url, category, is_published, source_ref, published_source_ref
				 FROM notices.notices
				 WHERE ${mode === "republish" ? "is_published" : "category IS NOT NULL AND (NOT is_published OR (source_ref IS NOT NULL AND source_ref IS DISTINCT FROM published_source_ref))"}
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
		}
	}
	return rows.map((row) => {
		if (row.category === null) {
			throw new Error(`notice ${row.noticeId} has no category`);
		}
		if (mode === "republish" && !row.isPublished) {
			throw new Error(`notice ${row.noticeId} is not published`);
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
		sourceRef: row.source_ref == null ? null : String(row.source_ref),
		publishedSourceRef: row.published_source_ref == null ? null : String(row.published_source_ref),
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
		throw new NoticePublicationDataError(`${key} is not valid JSON`, { cause: error });
	}
	const valid = validateInternalPortalNoticeSource(value);
	if (!valid.ok) {
		throw new NoticePublicationDataError(`${key} violates its contract: ${valid.errors.join("; ")}`);
	}
	return value as InternalPortalNoticeSource;
}

async function requiredNoticeSource(store: PublisherObjectStore, key: string) {
    try { return await store.getSource(key); }
    catch (error) {
        if (error instanceof Error && ["NoSuchKey", "NotFound"].includes(error.name)) {
            throw new NoticePublicationDataError(`required notice source is missing: ${key}`, { cause: error });
        }
        throw error;
    }
}

async function loadRecord(
	store: PublisherObjectStore,
	meta: InternalPortalMeta,
	registered: RegisteredNotice,
	portalHost: string,
): Promise<PublishedNotice> {
	const key = registered.sourceRef ?? `internal_portal/notices/${registered.noticeId}.json`;
	const stored = await requiredNoticeSource(store, key);
	const source = parseNoticeSource(stored.body, key);
	if (source.notice_id !== registered.noticeId) {
		throw new NoticePublicationDataError(`${key} has mismatched notice_id`);
	}
	if (registered.sourceRef && noticeSourceRef(source) !== registered.sourceRef) {
		throw new NoticePublicationDataError(`${key} does not match registered source: ${registered.noticeId}`);
	}
	if (!meta.notice_types[String(source.notice_type)]) {
		throw new NoticePublicationDataError(`${key} references unknown notice_type ${source.notice_type}`);
	}
	if (source.organization_id !== null && !meta.organizations[source.organization_id]) {
		throw new NoticePublicationDataError(`${key} references unknown organization_id ${source.organization_id}`);
	}
	if (!source.is_external) {
		for (const [ordinal, attachment] of source.attachments.entries()) {
			if (!attachment.notice_annex_id) {
				throw new NoticePublicationDataError(`notice ${source.notice_id} attachment ${ordinal} has no notice_annex_id`);
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
	if (!source.is_external) {
		for (const image of content.images) {
			const stored = await requiredNoticeSource(store,
				sourceResourceKey(source, "images", image.sourceOrdinal)!,
			);
			verifyResource(source, stored.body, "images", image.sourceOrdinal);
			assets.push(
				await projectAsset({
					contentTypeSource: image.normalizedUrl,
					kind: "image",
					ordinal: image.ordinal,
					originalName: null,
					portalAnnexId: null,
					stored,
					store,
				}),
			);
		}
		for (const [ordinal, attachment] of source.attachments.entries()) {
			const resourceKey = sourceResourceKey(source, "attachments", ordinal);
			if (resourceKey === null) continue;
			const stored = source.resources ? await requiredNoticeSource(store, resourceKey) : await store.getSourceIfExists(resourceKey);
			if (!stored) {
				continue;
			}
			verifyResource(source, stored.body, "attachments", ordinal);
			assets.push(
				await projectAsset({
					contentTypeSource: attachment.notice_annex_name ?? attachment.notice_annex_path,
					kind: "attachment",
					ordinal,
					originalName: attachment.notice_annex_name,
					portalAnnexId: attachment.notice_annex_id,
					stored,
					store,
				}),
			);
		}
	}

	return {
		...registered,
		externalUrl: source.external_url,
		isExternal: source.is_external,
		noticeType: source.notice_type,
		organizationId: source.organization_id,
		releasedAt: parsePortalReleaseTime(source.notice_release_time, key),
		title: source.notice_title,
		source,
		assets,
		contentHtml: content.contentHtml,
		contentText: content.contentText,
	};
}

async function updatePublishedContent(client: PoolClient, record: PublishedNotice, sourceRef: string): Promise<boolean> {
	const existing = await client.query(
		"SELECT content_html, content_text, is_published, source_ref, published_source_ref FROM notices.notices WHERE notice_id=$1 FOR UPDATE",
		[record.noticeId],
	);
	const row = existing.rows[0] as Record<string, unknown> | undefined;
	if (!row || row.is_published !== true) throw new NoticePublicationDataError(`notice is no longer published: ${record.noticeId}`);
	if ((row.source_ref ?? null) !== record.sourceRef) throw new NoticePublicationDataError(`notice source changed during publication: ${record.noticeId}`);
	const unchanged = record.sourceRef !== null ? row.published_source_ref === sourceRef :
		(row.content_html ?? null) === record.contentHtml && (row.content_text ?? null) === record.contentText;
	await publishProjection(client, record);
	return !unchanged;
}

async function replaceAssets(client: PoolClient, record: PublishedNotice): Promise<void> {
	const existing = await client.query(
		"SELECT asset_kind, ordinal, original_name, content_type, byte_size, content_sha256, portal_annex_id FROM notices.notice_assets WHERE notice_id=$1",
		[record.noticeId],
	);
	const byKey = new Map(
		record.assets.map((asset) => [`${asset.assetKind}/${asset.ordinal}`, asset]),
	);
	const unchanged =
		existing.rows.length === record.assets.length &&
		existing.rows.every((row) => {
			const asset = byKey.get(`${row.asset_kind}/${Number(row.ordinal)}`);
			return (
				asset !== undefined &&
				asset.originalName === (row.original_name ?? null) &&
				asset.contentType === row.content_type &&
				asset.byteSize === Number(row.byte_size) &&
				asset.contentSha256 === row.content_sha256 &&
				asset.portalAnnexId === (row.portal_annex_id ?? null)
			);
		});
	if (unchanged) return;
	await client.query("DELETE FROM notices.notice_assets WHERE notice_id=$1", [record.noticeId]);
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

function verifyResource(source: InternalPortalNoticeSource, body: Uint8Array, kind: "images" | "attachments", ordinal: number): void {
	if (!source.resources) return;
	const ref = source.resources.find((item) => item.kind === kind && item.ordinal === ordinal);
	if (!ref || ref.sha256 !== createHash("sha256").update(body).digest("hex") || ref.byte_size !== body.byteLength) throw new NoticePublicationDataError(`notice ${source.notice_id} resource does not match snapshot: ${kind}/${ordinal}`);
}

async function projectAsset(input: {
	contentTypeSource: string | null;
	kind: NoticeAssetKind;
	ordinal: number;
	originalName: string | null;
	portalAnnexId: string | null;
	stored: { body: Uint8Array; contentType: string | null };
	store: PublisherObjectStore;
}): Promise<AssetRow> {
	const contentSha256 = createHash("sha256").update(input.stored.body).digest("hex");
	const contentType = resolveAssetContentType(input.stored.contentType, input.contentTypeSource);
	if (input.kind === "image") {
		await input.store.createOrVerifyDerived({
			body: input.stored.body,
			contentType,
			digest: contentSha256,
		});
	}
	return {
		assetKind: input.kind,
		byteSize: input.stored.body.byteLength,
		contentSha256,
		contentType,
		ordinal: input.ordinal,
		originalName: input.originalName,
		portalAnnexId: input.portalAnnexId,
	};
}

function sourceResourceKey(source: InternalPortalNoticeSource, kind: "images" | "attachments", ordinal: number): string | null {
	if (source.resources) {
		const ref = source.resources.find((resource) => resource.kind === kind && resource.ordinal === ordinal);
		if (!ref || (kind === "images" && ref.object_key === null)) throw new NoticePublicationDataError(`notice ${source.notice_id} has no ${kind} resource ${ordinal}`);
		return ref.object_key;
	}
	return `internal_portal/notices/${source.notice_id}/${kind}/${ordinal}`;
}

async function publishOrVerify(client: PoolClient, record: PublishedNotice): Promise<void> {
	await publishProjection(client, record);
	await replaceAssets(client, record);
}

async function publishProjection(client: PoolClient, record: PublishedNotice): Promise<void> {
	const sourceRef = record.sourceRef;
	const updated = await client.query(
		`UPDATE notices.notices SET
		 notice_type=$2, organization_id=$3, title=$4, released_at=$5,
		 is_external=$6, external_url=$7, content_html=$8, content_text=$9,
		 is_published=true, published_source_ref=$10
		 WHERE notice_id=$1 AND source_ref IS NOT DISTINCT FROM $11`,
		[record.noticeId, record.noticeType, record.organizationId, record.title, record.releasedAt, record.isExternal, record.externalUrl, record.contentHtml, record.contentText, sourceRef, record.sourceRef],
	);
	if (updated.rowCount !== 1) throw new NoticePublicationDataError(`notice source changed during publication: ${record.noticeId}`);
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
