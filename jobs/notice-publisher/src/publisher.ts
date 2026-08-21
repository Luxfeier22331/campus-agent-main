import { createHash } from "node:crypto";
import { extname } from "node:path";

import {
	normalizeNoticeContent,
	type NoticeAssetKind,
} from "@campus-agent/notices";
import {
	type InternalPortalMeta,
	type InternalPortalNoticeSource,
	validateInternalPortalMeta,
	validateInternalPortalNoticeSource,
} from "ingestion-contracts";
import type { PoolClient } from "pg";

import {
	type Classification,
	parseClassifications,
	resolvePublishClassifications,
} from "./classifications.ts";
import type { PublisherObjectStore } from "./store.ts";
import { parsePortalReleaseTime } from "./time.ts";

export { parseClassifications } from "./classifications.ts";

interface AssetRow {
	assetKind: NoticeAssetKind;
	byteSize: number;
	contentSha256: string;
	contentType: string;
	ordinal: number;
	originalName: string | null;
	portalAnnexId: string | null;
}

interface PublishedNotice {
	assets: AssetRow[];
	category: Classification["category"];
	contentHtml: string | null;
	contentText: string | null;
	externalUrl: string | null;
	isExternal: boolean;
	noticeId: number;
	noticeType: number;
	organizationId: string | null;
	releasedAt: string;
	title: string;
}

export async function publishNotices(input: {
	classifications?: readonly Classification[];
	client: PoolClient;
	noticeIds?: readonly number[];
	objectStore: PublisherObjectStore;
	portalHost: string;
}): Promise<{ assets: number; notices: number }> {
	const classifications = await resolvePublishClassifications(input);
	const meta = await loadMeta(input.objectStore);
	const records: PublishedNotice[] = [];
	for (const classification of classifications) {
		records.push(
			await loadRecord(input.objectStore, meta, classification, input.portalHost),
		);
	}

	await input.client.query("BEGIN");
	try {
		await upsertMappings(input.client, meta);
		for (const record of records) {
			await insertOrVerify(input.client, record);
		}
		await input.client.query("COMMIT");
	} catch (error) {
		await input.client.query("ROLLBACK");
		throw error;
	}
	return {
		assets: records.reduce((sum, item) => sum + item.assets.length, 0),
		notices: records.length,
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
		throw new Error(
			`internal_portal/meta.json violates its contract: ${valid.errors.join("; ")}`,
		);
	}
	return value as InternalPortalMeta;
}

export function parseNoticeSource(
	body: Uint8Array,
	key: string,
): InternalPortalNoticeSource {
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
	classification: Classification,
	portalHost: string,
): Promise<PublishedNotice> {
	const key = `internal_portal/notices/${classification.noticeId}.json`;
	const stored = await store.getSource(key);
	const source = parseNoticeSource(stored.body, key);
	if (source.notice_id !== classification.noticeId) {
		throw new Error(`${key} has mismatched notice_id`);
	}
	if (!meta.notice_types[String(source.notice_type)]) {
		throw new Error(`${key} references unknown notice_type ${source.notice_type}`);
	}
	if (source.organization_id !== null && !meta.organizations[source.organization_id]) {
		throw new Error(`${key} references unknown organization_id ${source.organization_id}`);
	}
	if (!source.is_external) {
		for (const [ordinal, attachment] of source.attachments.entries()) {
			if (!attachment.notice_annex_id) {
				throw new Error(
					`notice ${source.notice_id} attachment ${ordinal} has no notice_annex_id`,
				);
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
					contentTypeSource:
						attachment.notice_annex_name ?? attachment.notice_annex_path,
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
		assets,
		category: classification.category,
		contentHtml: content.contentHtml,
		contentText: content.contentText,
		externalUrl: source.external_url,
		isExternal: source.is_external,
		noticeId: source.notice_id,
		noticeType: source.notice_type,
		organizationId: source.organization_id,
		releasedAt: parsePortalReleaseTime(source.notice_release_time, key),
		title: source.notice_title,
	};
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
	const contentType = resolveAssetContentType(
		source.contentType,
		input.contentTypeSource,
	);
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

async function upsertMappings(
	client: PoolClient,
	meta: InternalPortalMeta,
): Promise<void> {
	for (const [id, name] of Object.entries(meta.notice_types)) {
		await client.query(
			"INSERT INTO notices.notice_types(notice_type, name) VALUES ($1, $2) ON CONFLICT (notice_type) DO UPDATE SET name = EXCLUDED.name",
			[Number(id), name],
		);
	}
	for (const [id, name] of Object.entries(meta.organizations)) {
		await client.query(
			"INSERT INTO notices.organizations(organization_id, name) VALUES ($1, $2) ON CONFLICT (organization_id) DO UPDATE SET name = EXCLUDED.name",
			[id, name],
		);
	}
}

async function insertOrVerify(
	client: PoolClient,
	record: PublishedNotice,
): Promise<void> {
	const existing = await client.query(
		"SELECT notice_type, organization_id, title, released_at, is_external, external_url, category, content_html, content_text FROM notices.notices WHERE notice_id=$1",
		[record.noticeId],
	);
	if (existing.rows.length) {
		const row = existing.rows[0] as Record<string, unknown>;
		const comparable = [
			Number(row.notice_type),
			row.organization_id ?? null,
			row.title,
			new Date(String(row.released_at)).toISOString(),
			row.is_external,
			row.external_url ?? null,
			row.category,
			row.content_html ?? null,
			row.content_text ?? null,
		];
		const expected = [
			record.noticeType,
			record.organizationId,
			record.title,
			record.releasedAt,
			record.isExternal,
			record.externalUrl,
			record.category,
			record.contentHtml,
			record.contentText,
		];
		if (JSON.stringify(comparable) !== JSON.stringify(expected)) {
			throw new Error(`published notice conflicts: ${record.noticeId}`);
		}
	} else {
		await client.query(
			"INSERT INTO notices.notices(notice_id, notice_type, organization_id, title, released_at, is_external, external_url, category, content_html, content_text) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
			[
				record.noticeId,
				record.noticeType,
				record.organizationId,
				record.title,
				record.releasedAt,
				record.isExternal,
				record.externalUrl,
				record.category,
				record.contentHtml,
				record.contentText,
			],
		);
	}

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
	return (
		String(left[0]).localeCompare(String(right[0])) ||
		Number(left[1]) - Number(right[1])
	);
}

export function resolveAssetContentType(
	sourceContentType: string | null,
	value: string | null,
): string {
	const normalizedSourceType = sourceContentType
		?.split(";", 1)[0]
		?.trim()
		.toLowerCase();
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
		({
			".bmp": "image/bmp",
			".doc": "application/msword",
			".docx":
				"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			".gif": "image/gif",
			".jpeg": "image/jpeg",
			".jpg": "image/jpeg",
			".pdf": "application/pdf",
			".png": "image/png",
			".ppt": "application/vnd.ms-powerpoint",
			".pptx":
				"application/vnd.openxmlformats-officedocument.presentationml.presentation",
			".rar": "application/vnd.rar",
			".xls": "application/vnd.ms-excel",
			".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			".zip": "application/zip",
		} as Record<string, string>)[extension] ?? "application/octet-stream"
	);
}
