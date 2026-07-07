import { z } from "zod";

import { formatZodIssues, parseOptionalText } from "./core.ts";

export const NOTICE_RISK_LABEL_BODY_ONLY = "body_only";
export const NOTICE_RISK_LABEL_REFERENCE_ONLY = "body_with_reference_only_attachments";
export const NOTICE_RISK_LABEL_TEXT_ATTACHMENTS = "body_with_text_attachments";
export const NOTICE_RISK_LABEL_SPATIAL_ATTACHMENTS = "body_with_spatial_attachments";
export const NOTICE_RISK_LABEL_UNSUPPORTED_BINARY = "body_with_unsupported_binary_attachments";
export const NOTICE_RISK_LABEL_MIXED_HIGH_RISK = "mixed_high_risk";

const BASE_WEIGHT = 1;
const TEXT_ATTACHMENT_WEIGHT = 1;
const OCR_ATTACHMENT_WEIGHT = 3;

export interface AuthenticatedNoticeRawAssetRef {
	raw_asset_id: string;
	raw_version_id: string;
	page_start?: number | null;
	page_end?: number | null;
}

export interface AuthenticatedNoticeDocumentRegistryRecord {
	canonical_markdown_object_key?: string | null;
	cleaning_policy_version?: string | null;
	collection: string;
	content_hash: string;
	corpus: string;
	document_id: string;
	document_units_object_key?: string | null;
	effective_date?: string | null;
	embedding_model?: string | null;
	entitlement_groups?: readonly string[] | null;
	import_source?: string | null;
	ingestion_timestamp: string;
	is_current?: boolean | null;
	layout_elements_object_key?: string | null;
	parser_version?: string | null;
	policy_projection_version?: string | null;
	processed_object_keys?: readonly string[] | null;
	provenance_status?: string | null;
	provider_response_object_key?: string | null;
	published_date?: string | null;
	raw_asset?: AuthenticatedNoticeRawAssetRef | null;
	revision_track: string;
	source_channel: string;
	source_observations?: readonly unknown[] | null;
	source_uri: string;
	status?: string | null;
	supersedes_version_id?: string | null;
	version_id: string;
	visibility_level?: string | null;
	visibility_scope?: string | null;
}

export interface AuthenticatedNoticeRawAssetRecord {
	collection: string;
	content_hash: string;
	corpus: string;
	import_source?: string | null;
	ingestion_timestamp: string;
	object_key: string;
	raw_asset_id: string;
	raw_source_uri: string;
	raw_version_id: string;
	source_filename: string;
}

export interface AuthenticatedNoticeSourceTruthParentSnapshot {
	attachment_document_count: number;
	attachment_mix_score: number;
	attachment_projection_plans: Record<string, unknown>[];
	attachment_ref_count: number;
	attachment_refs_key: string;
	content_blocks_key: string;
	document_id: string;
	embedding_model: string;
	expected_attachment_documents: Record<string, unknown>[];
	has_reference_only_attachment: boolean;
	has_spatial_attachment: boolean;
	has_text_table_attachment: boolean;
	has_unsupported_binary_attachment: boolean;
	multimodal_processing_required_count: number;
	notice_browser_url: string | null;
	notice_browser_url_source: string | null;
	notice_id: string;
	notice_manifest_key: string;
	notice_release_time: string | null;
	notice_risk_label: string;
	notice_title: string;
	notice_type_names: string[];
	ocr_required_count: number;
	owner_expectation_count: number;
	owner_expectations: Record<string, unknown>[];
	planning_weight: number;
	portal_print_url: string | null;
	raw_record: AuthenticatedNoticeRawAssetRecord;
	record: Record<string, unknown>;
	reference_only_count: number;
	site_id: string;
	source_artifact_keys: string[];
	source_home_url: string;
	terminal_attachment_outcomes: Record<string, unknown>[];
	text_extractable_count: number;
	unsupported_binary_count: number;
}

export interface AuthenticatedNoticeSourceTruthInventoryEntry {
	attachment_document_count: number;
	attachment_mix_score: number;
	attachment_ref_count: number;
	attachment_refs_key: string;
	collection: string;
	content_blocks_key: string;
	corpus: string;
	document_id: string;
	embedding_model: string;
	has_reference_only_attachment: boolean;
	has_spatial_attachment: boolean;
	has_text_table_attachment: boolean;
	has_unsupported_binary_attachment: boolean;
	multimodal_processing_required_count: number;
	notice_id: string;
	notice_manifest_key: string;
	notice_risk_label: string;
	ocr_required_count: number;
	parent_snapshot: Record<string, unknown>;
	planning_weight: number;
	raw_asset_id: string;
	raw_version_id: string;
	reference_only_count: number;
	revision_track: string;
	site_id: string;
	source_home_url: string;
	text_extractable_count: number;
	unsupported_binary_count: number;
	updated_at?: string | null;
	version_id: string;
}

const InventoryEntrySchema = z.object({
	attachment_document_count: z.coerce.number().int().nonnegative(),
	attachment_mix_score: z.coerce.number().int().nonnegative(),
	attachment_ref_count: z.coerce.number().int().nonnegative(),
	attachment_refs_key: z.string(),
	collection: z.string(),
	content_blocks_key: z.string(),
	corpus: z.string(),
	document_id: z.string(),
	embedding_model: z.string(),
	has_reference_only_attachment: z.boolean(),
	has_spatial_attachment: z.boolean(),
	has_text_table_attachment: z.boolean(),
	has_unsupported_binary_attachment: z.boolean().default(false),
	multimodal_processing_required_count: z.coerce.number().int().nonnegative(),
	notice_id: z.string(),
	notice_manifest_key: z.string(),
	notice_risk_label: z.string(),
	ocr_required_count: z.coerce.number().int().nonnegative(),
	parent_snapshot: z.record(z.string(), z.unknown()).default({}),
	planning_weight: z.coerce.number().int().nonnegative(),
	raw_asset_id: z.string(),
	raw_version_id: z.string(),
	reference_only_count: z.coerce.number().int().nonnegative(),
	revision_track: z.string(),
	site_id: z.string(),
	source_home_url: z.string(),
	text_extractable_count: z.coerce.number().int().nonnegative(),
	unsupported_binary_count: z.coerce.number().int().nonnegative().default(0),
	updated_at: z.string().nullable().optional(),
	version_id: z.string(),
});

export function parseAuthenticatedNoticeSourceTruthInventoryEntry(
	value: unknown,
): AuthenticatedNoticeSourceTruthInventoryEntry {
	const parsed = InventoryEntrySchema.safeParse(value);
	if (!parsed.success) {
		throw new Error(
			`authenticated notice source-truth inventory entry is invalid: ${formatZodIssues(parsed.error.issues, "entry").join("; ")}`,
		);
	}
	return parsed.data;
}

export function deriveAuthenticatedNoticeRiskLabel(input: {
	attachmentRefCount: number;
	hasReferenceOnlyAttachment: boolean;
	hasSpatialAttachment: boolean;
	hasTextTableAttachment: boolean;
	hasUnsupportedBinaryAttachment?: boolean;
}): string {
	if (input.attachmentRefCount <= 0) {
		return NOTICE_RISK_LABEL_BODY_ONLY;
	}
	if (
		input.hasSpatialAttachment &&
		(input.hasTextTableAttachment ||
			input.hasReferenceOnlyAttachment ||
			Boolean(input.hasUnsupportedBinaryAttachment))
	) {
		return NOTICE_RISK_LABEL_MIXED_HIGH_RISK;
	}
	if (input.hasSpatialAttachment) {
		return NOTICE_RISK_LABEL_SPATIAL_ATTACHMENTS;
	}
	if (input.hasTextTableAttachment) {
		return NOTICE_RISK_LABEL_TEXT_ATTACHMENTS;
	}
	if (input.hasReferenceOnlyAttachment) {
		return NOTICE_RISK_LABEL_REFERENCE_ONLY;
	}
	if (input.hasUnsupportedBinaryAttachment) {
		return NOTICE_RISK_LABEL_UNSUPPORTED_BINARY;
	}
	return NOTICE_RISK_LABEL_BODY_ONLY;
}

export function selectLatestAuthenticatedNoticeParentRecords(input: {
	rawRecords: readonly AuthenticatedNoticeRawAssetRecord[];
	records: readonly AuthenticatedNoticeDocumentRegistryRecord[];
}): AuthenticatedNoticeDocumentRegistryRecord[] {
	const rawByKey = new Map(
		input.rawRecords.map((record) => [
			rawRecordKey(record.raw_asset_id, record.raw_version_id),
			record,
		]),
	);
	const selectedByNoticeId = new Map<string, AuthenticatedNoticeDocumentRegistryRecord>();
	for (const record of input.records) {
		const noticeId = extractNoticeIdFromDocumentId(record.document_id);
		const existing = selectedByNoticeId.get(noticeId);
		if (
			!existing ||
			compareInventoryParentSortKeys(
				inventoryParentSortKey(record, rawByKey),
				inventoryParentSortKey(existing, rawByKey),
			) > 0
		) {
			selectedByNoticeId.set(noticeId, record);
		}
	}
	return [...selectedByNoticeId.values()].sort((left, right) =>
		extractNoticeIdFromDocumentId(left.document_id).localeCompare(
			extractNoticeIdFromDocumentId(right.document_id),
		),
	);
}

export function buildAuthenticatedNoticeSourceTruthParentSnapshotFromPayloads(input: {
	attachmentRefs: readonly Record<string, unknown>[];
	attachmentRefsKey: string;
	contentBlocksKey: string;
	noticeManifest: Record<string, unknown>;
	noticeManifestKey: string;
	rawRecord: AuthenticatedNoticeRawAssetRecord;
	record: AuthenticatedNoticeDocumentRegistryRecord;
	sourceArtifactKeys?: readonly string[];
}): AuthenticatedNoticeSourceTruthParentSnapshot {
	const { noticeId, siteId } = parseNoticeDocumentIdentity(input.record.document_id);
	const ownerExpectations = normalizeRecordArray(input.noticeManifest.owner_expectations);
	const attachmentRoutingRecords = input.attachmentRefs.map(classifyAttachmentRef);
	const attachmentProjectionPlans = attachmentRoutingRecords.filter(
		(item) => typeof item.materialization_policy === "string",
	);
	const terminalAttachmentOutcomes = attachmentRoutingRecords.filter(
		(item) => typeof item.terminal_outcome === "string",
	);
	const textExtractableCount = attachmentProjectionPlans.filter(
		(item) => item.classification === "text_extractable",
	).length;
	const ocrRequiredCount = attachmentProjectionPlans.filter(
		(item) => item.classification === "ocr_required",
	).length;
	const multimodalProcessingRequiredCount = attachmentProjectionPlans.filter(
		(item) => item.classification === "multimodal_processing_required",
	).length;
	const referenceOnlyCount = terminalAttachmentOutcomes.filter(
		(item) => item.classification === "reference_only",
	).length;
	const unsupportedBinaryCount = terminalAttachmentOutcomes.filter(
		(item) => item.classification === "unsupported_binary",
	).length;
	const expectedAttachmentDocuments = attachmentProjectionPlans.filter(
		(item) => item.materialization_policy === "required_document",
	);
	const hasTextTableAttachment = textExtractableCount > 0 || ocrRequiredCount > 0;
	const hasSpatialAttachment = multimodalProcessingRequiredCount > 0;
	const hasReferenceOnlyAttachment = referenceOnlyCount > 0;
	const hasUnsupportedBinaryAttachment = unsupportedBinaryCount > 0;
	const attachmentLaneCount = [
		textExtractableCount,
		ocrRequiredCount,
		multimodalProcessingRequiredCount,
		referenceOnlyCount,
		unsupportedBinaryCount,
	].filter((count) => count > 0).length;
	const attachmentRefCount = input.attachmentRefs.length;
	const attachmentMixScore = attachmentRefCount + Math.max(0, attachmentLaneCount - 1);
	const noticeRiskLabel = deriveAuthenticatedNoticeRiskLabel({
		attachmentRefCount,
		hasReferenceOnlyAttachment,
		hasSpatialAttachment,
		hasTextTableAttachment,
		hasUnsupportedBinaryAttachment,
	});
	const planningWeight =
		BASE_WEIGHT +
		textExtractableCount * TEXT_ATTACHMENT_WEIGHT +
		ocrRequiredCount * OCR_ATTACHMENT_WEIGHT;

	return {
		attachment_document_count: expectedAttachmentDocuments.length,
		attachment_mix_score: attachmentMixScore,
		attachment_projection_plans: attachmentProjectionPlans,
		attachment_ref_count: attachmentRefCount,
		attachment_refs_key: input.attachmentRefsKey,
		content_blocks_key: input.contentBlocksKey,
		document_id: input.record.document_id,
		embedding_model: parseOptionalText(input.record.embedding_model) ?? "",
		expected_attachment_documents: expectedAttachmentDocuments,
		has_reference_only_attachment: hasReferenceOnlyAttachment,
		has_spatial_attachment: hasSpatialAttachment,
		has_text_table_attachment: hasTextTableAttachment,
		has_unsupported_binary_attachment: hasUnsupportedBinaryAttachment,
		multimodal_processing_required_count: multimodalProcessingRequiredCount,
		notice_browser_url: parseOptionalText(input.noticeManifest.notice_browser_url),
		notice_browser_url_source: parseOptionalText(input.noticeManifest.notice_browser_url_source),
		notice_id: noticeId,
		notice_manifest_key: input.noticeManifestKey,
		notice_release_time: parseOptionalText(input.noticeManifest.notice_release_time),
		notice_risk_label: noticeRiskLabel,
		notice_title:
			parseOptionalText(input.noticeManifest.notice_title_normalized) ??
			parseOptionalText(input.noticeManifest.notice_title_raw) ??
			input.record.document_id,
		notice_type_names: normalizeTextArray(input.noticeManifest.notice_type_names),
		ocr_required_count: ocrRequiredCount,
		owner_expectation_count: numberOrDefault(
			input.noticeManifest.owner_expectation_count,
			ownerExpectations.length,
		),
		owner_expectations: ownerExpectations,
		planning_weight: planningWeight,
		portal_print_url: parseOptionalText(input.noticeManifest.portal_print_url),
		raw_record: input.rawRecord,
		record: serializeDocumentRecord(input.record),
		reference_only_count: referenceOnlyCount,
		site_id: siteId,
		source_artifact_keys: normalizeTextArray(input.sourceArtifactKeys ?? []),
		source_home_url:
			parseOptionalText(input.noticeManifest.source_home_url) ??
			deriveSourceHomeUrl(input.record.source_uri),
		terminal_attachment_outcomes: terminalAttachmentOutcomes,
		text_extractable_count: textExtractableCount,
		unsupported_binary_count: unsupportedBinaryCount,
	};
}

export function inventoryEntryFromAuthenticatedNoticeParentSnapshot(
	parentSnapshot: AuthenticatedNoticeSourceTruthParentSnapshot,
): AuthenticatedNoticeSourceTruthInventoryEntry {
	const record = documentRecordFromAuthenticatedNoticeParentSnapshot(parentSnapshot);
	return {
		attachment_document_count: parentSnapshot.attachment_document_count,
		attachment_mix_score: parentSnapshot.attachment_mix_score,
		attachment_ref_count: parentSnapshot.attachment_ref_count,
		attachment_refs_key: parentSnapshot.attachment_refs_key,
		collection: record.collection,
		content_blocks_key: parentSnapshot.content_blocks_key,
		corpus: record.corpus,
		document_id: parentSnapshot.document_id,
		embedding_model: parentSnapshot.embedding_model,
		has_reference_only_attachment: parentSnapshot.has_reference_only_attachment,
		has_spatial_attachment: parentSnapshot.has_spatial_attachment,
		has_text_table_attachment: parentSnapshot.has_text_table_attachment,
		has_unsupported_binary_attachment: parentSnapshot.has_unsupported_binary_attachment,
		multimodal_processing_required_count: parentSnapshot.multimodal_processing_required_count,
		notice_id: parentSnapshot.notice_id,
		notice_manifest_key: parentSnapshot.notice_manifest_key,
		notice_risk_label: parentSnapshot.notice_risk_label,
		ocr_required_count: parentSnapshot.ocr_required_count,
		parent_snapshot: { ...parentSnapshot },
		planning_weight: parentSnapshot.planning_weight,
		raw_asset_id: parentSnapshot.raw_record.raw_asset_id,
		raw_version_id: parentSnapshot.raw_record.raw_version_id,
		reference_only_count: parentSnapshot.reference_only_count,
		revision_track: record.revision_track,
		site_id: parentSnapshot.site_id,
		source_home_url: parentSnapshot.source_home_url,
		text_extractable_count: parentSnapshot.text_extractable_count,
		unsupported_binary_count: parentSnapshot.unsupported_binary_count,
		version_id: record.version_id,
	};
}

export function documentRecordFromAuthenticatedNoticeParentSnapshot(
	parentSnapshot: AuthenticatedNoticeSourceTruthParentSnapshot,
): AuthenticatedNoticeDocumentRegistryRecord {
	const payload = parentSnapshot.record;
	const processedObjectKeys =
		normalizeTextArray(payload.processed_object_keys).length > 0
			? normalizeTextArray(payload.processed_object_keys)
			: parentSnapshot.source_artifact_keys;
	return {
		canonical_markdown_object_key: parseOptionalText(payload.canonical_markdown_object_key),
		cleaning_policy_version: parseOptionalText(payload.cleaning_policy_version) ?? "",
		collection: requiredString(payload.collection, "record.collection"),
		content_hash: requiredString(payload.content_hash, "record.content_hash"),
		corpus: requiredString(payload.corpus, "record.corpus"),
		document_id: requiredString(payload.document_id, "record.document_id"),
		document_units_object_key: parseOptionalText(payload.document_units_object_key),
		effective_date: parseOptionalText(payload.effective_date),
		embedding_model: parseOptionalText(payload.embedding_model) ?? "",
		entitlement_groups: normalizeTextArray(payload.entitlement_groups),
		import_source: parseOptionalText(payload.import_source) ?? "",
		ingestion_timestamp: parseOptionalText(payload.ingestion_timestamp) ?? "",
		is_current: Boolean(payload.is_current),
		layout_elements_object_key: parseOptionalText(payload.layout_elements_object_key),
		parser_version: parseOptionalText(payload.parser_version) ?? "",
		policy_projection_version: parseOptionalText(payload.policy_projection_version) ?? "",
		processed_object_keys: processedObjectKeys,
		provenance_status: parseOptionalText(payload.provenance_status) ?? "",
		provider_response_object_key: parseOptionalText(payload.provider_response_object_key),
		published_date: parseOptionalText(payload.published_date),
		raw_asset: null,
		revision_track: requiredString(payload.revision_track, "record.revision_track"),
		source_channel: parseOptionalText(payload.source_channel) ?? "",
		source_observations: [],
		source_uri: requiredString(payload.source_uri, "record.source_uri"),
		status: parseOptionalText(payload.status) ?? "active",
		supersedes_version_id: parseOptionalText(payload.supersedes_version_id),
		version_id: requiredString(payload.version_id, "record.version_id"),
		visibility_level: parseOptionalText(payload.visibility_level) ?? "",
		visibility_scope: parseOptionalText(payload.visibility_scope),
	};
}

function classifyAttachmentRef(attachmentRef: Record<string, unknown>): Record<string, unknown> {
	const attachmentRefId = parseOptionalText(attachmentRef.attachment_ref_id) ?? "";
	const classification = attachmentClassification(attachmentRef);
	const record: Record<string, unknown> = {
		attachment_ref_id: attachmentRefId,
		classification,
		content_kind: parseOptionalText(attachmentRef.content_kind),
		mime_type: parseOptionalText(attachmentRef.mime_type),
		object_key: parseOptionalText(attachmentRef.object_key),
		resource_role: parseOptionalText(attachmentRef.resource_role),
	};
	if (
		classification === "reference_only" ||
		classification === "unsupported_binary" ||
		classification === "terminal_unavailable"
	) {
		record.terminal_outcome = classification;
		return record;
	}
	record.materialization_policy = materializationPolicyForClassification(classification);
	return record;
}

function attachmentClassification(attachmentRef: Record<string, unknown>): string {
	if (parseOptionalText(attachmentRef.last_error_class) === "terminal_unavailable") {
		return "terminal_unavailable";
	}
	if (
		!(
			parseOptionalText(attachmentRef.object_key) && parseOptionalText(attachmentRef.content_sha256)
		) ||
		attachmentRef.byte_size === null ||
		attachmentRef.byte_size === undefined
	) {
		return "reference_only";
	}
	const storageProvider = parseOptionalText(attachmentRef.storage_provider)?.toLowerCase();
	const ingestStatus = parseOptionalText(attachmentRef.ingest_status)?.toLowerCase();
	if (storageProvider === "reference_only" || ingestStatus === "reference_only") {
		return "reference_only";
	}
	const resourceRole = parseOptionalText(attachmentRef.resource_role);
	if (resourceRole === "inline_image") {
		return "multimodal_processing_required";
	}
	const mimeType = parseOptionalText(attachmentRef.mime_type)?.toLowerCase() ?? "";
	const filename = parseOptionalText(attachmentRef.original_filename) ?? "";
	const extension = filenameExtension(filename);
	if (isTextExtractable(extension, mimeType)) {
		return "text_extractable";
	}
	if (isOcrRequired(extension, mimeType)) {
		return "ocr_required";
	}
	return "unsupported_binary";
}

function materializationPolicyForClassification(classification: string): string {
	if (classification === "text_extractable") {
		return "required_document";
	}
	if (classification === "ocr_required") {
		return "conditional_on_extracted_text";
	}
	if (classification === "multimodal_processing_required") {
		return "multimodal_processing";
	}
	throw new Error(`unsupported materialization policy classification: ${classification}`);
}

function isTextExtractable(extension: string | null, mimeType: string): boolean {
	return (
		[".doc", ".docx", ".pdf", ".ppt", ".pptx", ".txt", ".xls", ".xlsx"].includes(extension ?? "") ||
		[
			"application/msword",
			"application/pdf",
			"application/vnd.ms-excel",
			"application/vnd.ms-powerpoint",
			"application/vnd.openxmlformats-officedocument.presentationml.presentation",
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			"text/plain",
		].includes(mimeType)
	);
}

function isOcrRequired(extension: string | null, mimeType: string): boolean {
	return (
		[".gif", ".jpeg", ".jpg", ".png", ".webp"].includes(extension ?? "") ||
		mimeType.startsWith("image/")
	);
}

function filenameExtension(filename: string): string | null {
	const trimmed = filename.trim().toLowerCase();
	const dot = trimmed.lastIndexOf(".");
	if (dot < 0 || dot === trimmed.length - 1) {
		return null;
	}
	return trimmed.slice(dot);
}

function serializeDocumentRecord(
	record: AuthenticatedNoticeDocumentRegistryRecord,
): Record<string, unknown> {
	return {
		canonical_markdown_object_key: record.canonical_markdown_object_key ?? null,
		cleaning_policy_version: record.cleaning_policy_version ?? "",
		collection: record.collection,
		content_hash: record.content_hash,
		corpus: record.corpus,
		document_id: record.document_id,
		document_units_object_key: record.document_units_object_key ?? null,
		effective_date: record.effective_date ?? null,
		embedding_model: record.embedding_model ?? "",
		entitlement_groups: [...(record.entitlement_groups ?? [])],
		import_source: record.import_source ?? "",
		ingestion_timestamp: record.ingestion_timestamp,
		is_current: Boolean(record.is_current),
		layout_elements_object_key: record.layout_elements_object_key ?? null,
		parser_version: record.parser_version ?? "",
		policy_projection_version: record.policy_projection_version ?? "",
		processed_object_keys: normalizeTextArray(record.processed_object_keys ?? []),
		provenance_status: record.provenance_status ?? "",
		provider_response_object_key: record.provider_response_object_key ?? null,
		published_date: record.published_date ?? null,
		revision_track: record.revision_track,
		source_channel: record.source_channel,
		source_uri: record.source_uri,
		status: record.status ?? "active",
		supersedes_version_id: record.supersedes_version_id ?? null,
		version_id: record.version_id,
		visibility_level: record.visibility_level ?? "",
		visibility_scope: record.visibility_scope ?? null,
	};
}

function inventoryParentSortKey(
	record: AuthenticatedNoticeDocumentRegistryRecord,
	rawByKey: ReadonlyMap<string, AuthenticatedNoticeRawAssetRecord>,
): [number, number, number, string] {
	const rawTimestamp = record.raw_asset
		? parseTimestampMillis(
				rawByKey.get(rawRecordKey(record.raw_asset.raw_asset_id, record.raw_asset.raw_version_id))
					?.ingestion_timestamp ?? "",
			)
		: Number.NEGATIVE_INFINITY;
	return [
		record.is_current ? 1 : 0,
		rawTimestamp,
		parseTimestampMillis(record.ingestion_timestamp),
		record.version_id,
	];
}

function compareInventoryParentSortKeys(
	left: [number, number, number, string],
	right: [number, number, number, string],
): number {
	for (let index = 0; index < left.length; index += 1) {
		const leftValue = left[index];
		const rightValue = right[index];
		if (typeof leftValue === "string" && typeof rightValue === "string") {
			const compared = leftValue.localeCompare(rightValue);
			if (compared !== 0) {
				return compared;
			}
			continue;
		}
		if (Number(leftValue) !== Number(rightValue)) {
			return Number(leftValue) - Number(rightValue);
		}
	}
	return 0;
}

function parseTimestampMillis(value: string): number {
	const normalized = value.trim();
	if (!normalized) {
		return Number.NEGATIVE_INFINITY;
	}
	const timestamp = Date.parse(normalized);
	return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function parseNoticeDocumentIdentity(documentId: string): { noticeId: string; siteId: string } {
	const parts = documentId.split(":").map((part) => part.trim());
	if (parts.length < 3 || parts[0] !== "notice" || !parts[1] || !parts[2]) {
		throw new Error(
			`authenticated notice source inventory requires notice document ids: ${documentId}`,
		);
	}
	return { noticeId: parts[2], siteId: parts[1] };
}

function extractNoticeIdFromDocumentId(documentId: string): string {
	return parseNoticeDocumentIdentity(documentId).noticeId;
}

function deriveSourceHomeUrl(sourceUri: string): string {
	try {
		const parsed = new URL(sourceUri);
		return `${parsed.protocol}//${parsed.host}`;
	} catch {
		return sourceUri.trim();
	}
}

function rawRecordKey(rawAssetId: string, rawVersionId: string): string {
	return `${rawAssetId}\n${rawVersionId}`;
}

function normalizeRecordArray(value: unknown): Record<string, unknown>[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter(isRecord).map((item) => ({ ...item }));
}

function normalizeTextArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.map((item) => String(item).trim()).filter(Boolean);
}

function numberOrDefault(value: unknown, defaultValue: number): number {
	if (typeof value === "number" && Number.isFinite(value)) {
		return Math.trunc(value);
	}
	if (typeof value === "string" && value.trim()) {
		const parsed = Number.parseInt(value.trim(), 10);
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}
	return defaultValue;
}

function requiredString(value: unknown, label: string): string {
	const text = parseOptionalText(value);
	if (!text) {
		throw new Error(`${label} is required`);
	}
	return text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
