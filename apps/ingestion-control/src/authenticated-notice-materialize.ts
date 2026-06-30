import { createHash } from "node:crypto";

import { load } from "cheerio";

import {
	type TsTaskHandler,
	TsTaskHandlerRegistry,
	type TsTaskHandlerResult,
} from "./task-executor";
import type { IngestionArtifactRef, IngestionTaskRecord } from "./types";

const SOURCE_CHANNEL = "authenticated_notice_portal";
const SOURCE_SURFACE = "notice";
const MANIFEST_SCHEMA = "authenticated_notice_manifest_v1";
const BLOCK_SCHEMA = "authenticated_notice_block_v1";
const ATTACHMENT_REF_SCHEMA = "authenticated_notice_attachment_ref_v1";

export interface IngestionObjectStore {
	getObject(input: { bucket: string; key: string }): Promise<Uint8Array>;
	putObject(input: {
		bucket: string;
		key: string;
		body: Uint8Array;
		contentType: string;
	}): Promise<{ byteSize: number; contentSha256: string }>;
}

export function createAuthenticatedNoticeTsTaskHandlerRegistry(input: {
	objectStore: IngestionObjectStore;
}): TsTaskHandlerRegistry {
	const registry = new TsTaskHandlerRegistry();
	registry.register(
		{
			sourceFamily: "authenticated_notice",
			corpus: "campus_notices",
			collection: "internal_notice",
			taskKind: "source_truth_materialize",
		},
		createAuthenticatedNoticeSourceTruthMaterializeHandler(input),
	);
	return registry;
}

export function createAuthenticatedNoticeSourceTruthMaterializeHandler(input: {
	objectStore: IngestionObjectStore;
}): TsTaskHandler {
	return async (task): Promise<TsTaskHandlerResult> => {
		const sourceInput = parseS3Uri(task.input_ref);
		const captureRelease = asRecord(
			JSON.parse(textFromBytes(await input.objectStore.getObject(sourceInput))),
			"capture release",
		);
		validateCaptureRelease(captureRelease);
		const bundleRef = requiredSourceObjectRef(captureRelease.bundle_ref, "bundle_ref");
		const manifestRef = requiredSourceObjectRef(
			captureRelease.export_manifest_ref,
			"export_manifest_ref",
		);
		if (bundleRef.bucket !== sourceInput.bucket || manifestRef.bucket !== sourceInput.bucket) {
			throw new Error("capture release object refs must use the source bucket");
		}
		const bundleBytes = await input.objectStore.getObject({
			bucket: bundleRef.bucket,
			key: bundleRef.key,
		});
		const manifestBytes = await input.objectStore.getObject({
			bucket: manifestRef.bucket,
			key: manifestRef.key,
		});
		verifyObjectRefBytes(bundleRef, bundleBytes, "bundle_ref");
		verifyObjectRefBytes(manifestRef, manifestBytes, "export_manifest_ref");
		const bundleRecords = asArray(JSON.parse(textFromBytes(bundleBytes)), "notices bundle").map(
			(item) => asRecord(item, "notices bundle record"),
		);
		const exportManifest = asRecord(JSON.parse(textFromBytes(manifestBytes)), "export manifest");
		const refs: IngestionArtifactRef[] = [];
		for (const bundleRecord of bundleRecords) {
			refs.push(
				...(await materializeNoticeSourceTruth({
					bundleRecord,
					captureRelease,
					exportManifest,
					objectStore: input.objectStore,
					sourceBucket: sourceInput.bucket,
					task,
				})),
			);
		}
		return { artifactRefs: refs };
	};
}

async function materializeNoticeSourceTruth(input: {
	bundleRecord: Record<string, unknown>;
	captureRelease: Record<string, unknown>;
	exportManifest: Record<string, unknown>;
	objectStore: IngestionObjectStore;
	sourceBucket: string;
	task: IngestionTaskRecord;
}): Promise<IngestionArtifactRef[]> {
	const notice = asRecord(input.bundleRecord.notice, "bundle notice");
	const siteId = requiredText(input.captureRelease.site_id, "site_id");
	const noticeId = requiredText(notice.notice_id ?? input.bundleRecord.notice_id, "notice_id");
	const title = requiredText(notice.notice_title, "notice_title");
	const rawAssetId = `asset:authenticated-notice:${siteId}:${noticeId}`;
	const rawVersionId = `sha256:${sha256(
		jsonStableBytes({
			attachments: attachmentIdentity(input.bundleRecord),
			categories: categoryPairs(notice),
			html: String(notice.notice_content ?? ""),
			title,
		}),
	)}`;
	const year = inferYear(
		notice.notice_release_time ?? notice.notice_create_time ?? input.captureRelease.exported_at,
	);
	const prefix = sourceTruthPrefix({
		rawAssetId,
		rawVersionId,
		year,
	});
	const contentBlocks = buildContentBlocks({
		rawAssetId,
		rawVersionId,
		title,
		html: String(notice.notice_content ?? ""),
	});
	const attachmentRefs = buildAttachmentRefs({
		bundleRecord: input.bundleRecord,
		noticeId,
		rawAssetId,
		rawVersionId,
	});
	const manifest = {
		schema_version: MANIFEST_SCHEMA,
		source_channel: SOURCE_CHANNEL,
		site_id: siteId,
		notice_id: noticeId,
		raw_asset_id: rawAssetId,
		raw_version_id: rawVersionId,
		captured_at: requiredText(input.captureRelease.exported_at, "exported_at"),
		list_observed_at:
			optionalText(notice.last_seen_at) ??
			requiredText(input.captureRelease.exported_at, "exported_at"),
		detail_observed_at:
			optionalText(notice.enrich_attempted_at) ??
			requiredText(input.captureRelease.exported_at, "exported_at"),
		fetcher_name: "authenticated_notice_capture_release_materializer",
		fetcher_version: String(input.exportManifest.schema_version ?? "unknown"),
		collector_version: collectorVersion(input.exportManifest),
		credentials_mode: "authenticated",
		notice_title_raw: title,
		notice_title_normalized: title,
		organization_name: optionalText(notice.organization_name),
		organization_id: optionalText(notice.organization_id),
		notice_release_time: optionalText(notice.notice_release_time),
		notice_create_time: optionalText(notice.notice_create_time),
		notice_first_time: optionalText(notice.notice_first_time),
		notice_source: notice.notice_source ?? null,
		notice_link_state: notice.notice_link_state ?? null,
		notice_state: notice.notice_state ?? null,
		notice_stick: notice.notice_stick ?? null,
		notice_type_ids: categoryPairs(notice).map(([id]) => id),
		notice_type_names: categoryPairs(notice).map(([, name]) => name),
		source_notice_link:
			optionalText(notice.notice_link) ?? `campusnotice://${siteId}/notice/${noticeId}`,
		source_home_url: optionalText(input.exportManifest.source_home_url) ?? "",
		portal_print_url: optionalText(notice.portal_print_url),
		notice_browser_url: optionalText(notice.notice_browser_url),
		notice_browser_url_source: optionalText(notice.notice_browser_url_source),
		body_html_hash: sha256(Buffer.from(String(notice.notice_content ?? ""), "utf8")),
		block_count: contentBlocks.length,
		link_count: contentBlocks.filter((block) => block.block_role === "link").length,
		attachment_ref_count: attachmentRefs.length,
		materialized_by_task_id: input.task.task_id,
	};
	return Promise.all([
		writeJsonArtifact({
			bucket: input.sourceBucket,
			key: `${prefix}/notice-manifest.json`,
			objectStore: input.objectStore,
			value: manifest,
		}),
		writeJsonlArtifact({
			bucket: input.sourceBucket,
			key: `${prefix}/content-blocks.jsonl`,
			objectStore: input.objectStore,
			rows: contentBlocks,
		}),
		writeJsonlArtifact({
			bucket: input.sourceBucket,
			key: `${prefix}/attachment-refs.jsonl`,
			objectStore: input.objectStore,
			rows: attachmentRefs,
		}),
	]);
}

function buildContentBlocks(input: {
	rawAssetId: string;
	rawVersionId: string;
	title: string;
	html: string;
}): Record<string, unknown>[] {
	const rows: Record<string, unknown>[] = [];
	const append = (role: string, text: string, headingLevel: number | null = null): void => {
		const normalized = normalizeText(text);
		if (!normalized) {
			return;
		}
		rows.push({
			schema_version: BLOCK_SCHEMA,
			raw_asset_id: input.rawAssetId,
			raw_version_id: input.rawVersionId,
			row_id: `block-${String(rows.length + 1).padStart(4, "0")}`,
			row_index: rows.length,
			block_order: rows.length + 1,
			block_role: role,
			heading_level: headingLevel,
			parent_heading_path: [],
			list_level: null,
			table_id: null,
			table_row_index: null,
			table_col_index: null,
			text_raw: text.trim(),
			text_normalized: normalized,
			html_fragment: null,
			link_target: null,
			link_text: null,
			table_html: null,
			table_cells: null,
		});
	};
	append("title", input.title, 1);
	for (const block of htmlTextBlocks(input.html)) {
		if (normalizeText(block.text) === normalizeText(input.title)) {
			continue;
		}
		append(block.role, block.text, block.headingLevel);
	}
	return rows;
}

function buildAttachmentRefs(input: {
	bundleRecord: Record<string, unknown>;
	noticeId: string;
	rawAssetId: string;
	rawVersionId: string;
}): Record<string, unknown>[] {
	const attachments = asArrayOrEmpty(input.bundleRecord.attachments).filter(isRecord);
	const relations = asArrayOrEmpty(input.bundleRecord.notice_attachments).filter(isRecord);
	const attachmentsById = new Map<unknown, Record<string, unknown>>();
	for (const attachment of attachments) {
		attachmentsById.set(attachment.attachment_id, attachment);
	}
	return relations.flatMap((relation, index) => {
		const attachment = attachmentsById.get(relation.attachment_id);
		if (!attachment) {
			return [];
		}
		return [
			{
				schema_version: ATTACHMENT_REF_SCHEMA,
				raw_asset_id: input.rawAssetId,
				raw_version_id: input.rawVersionId,
				attachment_ref_id: `attachment-${String(index + 1).padStart(4, "0")}`,
				ref_order: index + 1,
				notice_id: input.noticeId,
				relation_source: relation.relation_source ?? null,
				resource_role: relation.resource_role ?? null,
				content_kind: null,
				anchor_text: optionalText(relation.anchor_text),
				original_filename: optionalText(attachment.original_filename),
				source_url: optionalText(attachment.source_url),
				normalized_source_url: optionalText(attachment.normalized_source_url),
				final_url: optionalText(attachment.final_url),
				origin_scope: optionalText(attachment.origin_scope),
				object_key: optionalText(attachment.object_key),
				content_sha256: optionalText(attachment.sha256),
				mime_type: optionalText(attachment.mime_type),
				byte_size: attachment.byte_size ?? null,
				storage_provider: optionalText(attachment.storage_provider),
				ingest_status: optionalText(attachment.ingest_status),
				last_http_status: attachment.last_http_status ?? null,
				terminal_reason: attachment.terminal_reason ?? null,
				last_error_class: attachment.last_error_class ?? null,
			},
		];
	});
}

async function writeJsonArtifact(input: {
	bucket: string;
	key: string;
	objectStore: IngestionObjectStore;
	value: unknown;
}): Promise<IngestionArtifactRef> {
	return writeArtifact({
		...input,
		body: jsonBytes(input.value),
	});
}

async function writeJsonlArtifact(input: {
	bucket: string;
	key: string;
	objectStore: IngestionObjectStore;
	rows: Record<string, unknown>[];
}): Promise<IngestionArtifactRef> {
	return writeArtifact({
		...input,
		body: Buffer.from(
			input.rows.map((row) => JSON.stringify(row)).join("\n") + (input.rows.length > 0 ? "\n" : ""),
			"utf8",
		),
	});
}

async function writeArtifact(input: {
	bucket: string;
	key: string;
	objectStore: IngestionObjectStore;
	body: Uint8Array;
}): Promise<IngestionArtifactRef> {
	const result = await input.objectStore.putObject({
		bucket: input.bucket,
		key: input.key,
		body: input.body,
		contentType: input.key.endsWith(".jsonl") ? "application/jsonl" : "application/json",
	});
	return {
		kind: "object_store",
		uri: `s3://${input.bucket}/${input.key}`,
		digest: `sha256:${result.contentSha256}`,
	};
}

function parseS3Uri(ref: IngestionArtifactRef): { bucket: string; key: string } {
	if (ref.kind !== "object_store") {
		throw new Error(`input_ref must be object_store, got ${ref.kind}`);
	}
	if (!ref.uri.startsWith("s3://")) {
		throw new Error(`input_ref object_store uri must use s3://, got ${ref.uri}`);
	}
	const rest = ref.uri.slice("s3://".length);
	const slash = rest.indexOf("/");
	if (slash <= 0 || slash === rest.length - 1) {
		throw new Error(`invalid s3 uri: ${ref.uri}`);
	}
	return {
		bucket: rest.slice(0, slash),
		key: rest.slice(slash + 1),
	};
}

function validateCaptureRelease(value: Record<string, unknown>): void {
	if (value.schema_version !== "authenticated_notice_capture_release.v1") {
		throw new Error(
			"capture release schema_version must be authenticated_notice_capture_release.v1",
		);
	}
	if (value.source_channel !== SOURCE_CHANNEL) {
		throw new Error("capture release source_channel must be authenticated_notice_portal");
	}
	if (value.source_surface !== SOURCE_SURFACE) {
		throw new Error("capture release source_surface must be notice");
	}
}

function requiredSourceObjectRef(
	value: unknown,
	label: string,
): {
	bucket: string;
	key: string;
	contentSha256: string | null;
	byteSize: number | null;
} {
	const ref = asRecord(value, label);
	return {
		bucket: requiredText(ref.bucket, `${label}.bucket`),
		key: requiredText(ref.key, `${label}.key`),
		contentSha256: optionalText(ref.content_sha256),
		byteSize: optionalNumber(ref.byte_size),
	};
}

function verifyObjectRefBytes(
	ref: { contentSha256: string | null; byteSize: number | null },
	bytes: Uint8Array,
	label: string,
): void {
	if (ref.byteSize !== null && ref.byteSize !== bytes.byteLength) {
		throw new Error(`${label} byte_size mismatch`);
	}
	if (ref.contentSha256 !== null && ref.contentSha256 !== sha256(bytes)) {
		throw new Error(`${label} content_sha256 mismatch`);
	}
}

function sourceTruthPrefix(input: {
	rawAssetId: string;
	rawVersionId: string;
	year: string | null;
}): string {
	return [
		SOURCE_CHANNEL,
		sourceAssetSlug(input.rawAssetId),
		input.year ?? "undated",
		...identitySegments(input.rawVersionId),
		"source-truth",
	].join("/");
}

function sourceAssetSlug(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9._:-]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function identitySegments(rawVersionId: string): string[] {
	const value = rawVersionId.startsWith("sha256:")
		? rawVersionId.slice("sha256:".length)
		: rawVersionId;
	return [value.slice(0, 2), value];
}

function htmlTextBlocks(html: string): Array<{
	role: string;
	text: string;
	headingLevel: number | null;
}> {
	const rows: Array<{ role: string; text: string; headingLevel: number | null }> = [];
	const $ = load(html);
	$("h1,h2,h3,h4,h5,h6,p,li").each((_index, element) => {
		const tag = element.tagName.toLowerCase();
		const text = normalizeText($(element).text());
		if (!text) {
			return;
		}
		rows.push({
			role: tag.startsWith("h") ? "heading" : tag === "li" ? "list_item" : "paragraph",
			text,
			headingLevel: tag.startsWith("h") ? Number.parseInt(tag.slice(1), 10) : null,
		});
	});
	if (rows.length === 0) {
		const text = normalizeText($.root().text());
		if (text) {
			rows.push({ role: "paragraph", text, headingLevel: null });
		}
	}
	return rows;
}

function normalizeText(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function attachmentIdentity(bundleRecord: Record<string, unknown>): unknown[] {
	return asArrayOrEmpty(bundleRecord.attachments)
		.filter(isRecord)
		.map((attachment) => [
			optionalText(attachment.normalized_source_url) ?? optionalText(attachment.source_url) ?? "",
			optionalText(attachment.storage_provider) ?? "",
			optionalText(attachment.sha256) ?? "",
		])
		.sort();
}

function categoryPairs(notice: Record<string, unknown>): [string, string][] {
	return asArrayOrEmpty(notice.categories)
		.filter(isRecord)
		.flatMap((category) => {
			const id = String(category.notice_type ?? "").trim();
			const name = String(category.notice_type_name ?? "").trim();
			return id || name ? [[id, name] as [string, string]] : [];
		});
}

function collectorVersion(manifest: Record<string, unknown>): string {
	const collector = manifest.collector;
	if (isRecord(collector)) {
		return (
			optionalText(collector.export_contract_version) ??
			optionalText(collector.runtime_shell) ??
			String(manifest.schema_version ?? "unknown")
		);
	}
	return String(manifest.schema_version ?? "unknown");
}

function inferYear(value: unknown): string | null {
	const match = String(value ?? "").match(/(?<!\d)((?:19|20)\d{2})(?!\d)/);
	return match?.[1] ?? null;
}

function jsonStableBytes(value: unknown): Uint8Array {
	return Buffer.from(JSON.stringify(value, objectKeySorter), "utf8");
}

function objectKeySorter(_key: string, value: unknown): unknown {
	if (!isRecord(value)) {
		return value;
	}
	return Object.fromEntries(
		Object.keys(value)
			.sort()
			.map((key) => [key, value[key]]),
	);
}

function jsonBytes(value: unknown): Uint8Array {
	return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function textFromBytes(value: Uint8Array): string {
	return Buffer.from(value).toString("utf8");
}

function sha256(value: Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}

function asArray(value: unknown, label: string): unknown[] {
	if (!Array.isArray(value)) {
		throw new Error(`${label} must be an array`);
	}
	return value;
}

function asArrayOrEmpty(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
	if (!isRecord(value)) {
		throw new Error(`${label} must be an object`);
	}
	return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredText(value: unknown, label: string): string {
	const normalized = String(value ?? "").trim();
	if (!normalized) {
		throw new Error(`${label} is required`);
	}
	return normalized;
}

function optionalText(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalNumber(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		return null;
	}
	return value;
}
