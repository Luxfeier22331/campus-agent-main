import type {
	AuthenticatedNoticeNoticeFamilyConfig,
	AuthenticatedNoticeRoutingSample,
} from "./authenticated-notice-routing.ts";
import { resolveAuthenticatedNoticeRoutingSampleFromBundleRecord } from "./authenticated-notice-routing.ts";
import type { AuthenticatedNoticeSourceTruthInventoryEntry } from "./authenticated-notice-source-truth-inventory.ts";
import { parseOptionalText, parseRecord } from "./core.ts";
import {
	CONSUMER_ADMISSION_BODY_QUALITY_EMPTY,
	CONSUMER_ADMISSION_BODY_QUALITY_PRESENT,
	CONSUMER_ADMISSION_BODY_QUALITY_TITLE_ONLY,
	CONSUMER_ADMISSION_DECISION_ADMIT,
	CONSUMER_ADMISSION_DECISION_NO_ADOPTION,
	CONSUMER_ADMISSION_GATE_OPERATION_MULTIMODAL_DRAIN,
	CONSUMER_ADMISSION_GATE_OPERATION_READ_MODEL_REBUILD,
	CONSUMER_ADMISSION_GATE_OPERATION_TYPED_MATERIALIZATION,
	CONSUMER_ADMISSION_GATE_REASON_ID_MISMATCH,
	CONSUMER_ADMISSION_GATE_REASON_INVALID_MANIFEST,
	CONSUMER_ADMISSION_GATE_REASON_MISSING_MANIFEST,
	CONSUMER_ADMISSION_GATE_REASON_REPLACE_SCOPE_NOT_AUTHORIZED,
	CONSUMER_ADMISSION_GATE_REASON_SCOPE_MISMATCH,
	CONSUMER_ADMISSION_GATE_REASON_TARGET_SURFACE_VIOLATION,
	CONSUMER_ADMISSION_GATE_REASON_THRESHOLD_BREACH,
	CONSUMER_ADMISSION_GATE_VERDICT_ALLOW,
	CONSUMER_ADMISSION_GATE_VERDICT_BLOCK,
	CONSUMER_ADMISSION_MANIFEST_SCHEMA_VERSION,
	CONSUMER_ADMISSION_POLICY_VERSION,
	CONSUMER_ADMISSION_SCOPE_WRITE_MODE_REPLACE_SCOPE,
	CONSUMER_ADMISSION_SCOPE_WRITE_MODE_UPSERT_SELECTED,
	CONSUMER_ADMISSION_STATUS_CANDIDATE_FOR_TYPED_MATERIALIZATION,
	type ConsumerAdmissionDecisionRecord,
	type ConsumerAdmissionGateReport,
	type ConsumerAdmissionGateRequest,
	computeConsumerAdmissionSelectionSha256,
	countBy,
	decisionCounts,
	type InternalNoticeConsumerAdmissionManifest,
	NOTICE_CONSUMPTION_STATUS_NO_ADOPTION,
	NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
	NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
	NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE,
	NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
	NOTICE_TARGET_SURFACE_PROCUREMENT_NOTICE_HISTORY,
	NOTICE_TARGET_SURFACE_REGULATION_CANDIDATE,
	NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
	NOTICE_TARGET_SURFACE_SPECIAL_SERVICE_CANDIDATE,
	NOTICE_TARGET_SURFACE_STABLE_CONTACT_CANDIDATE,
	NOTICE_TARGET_SURFACE_UNSUPPORTED,
	normalizeNoticeIds,
	normalizeTextValues,
	parseInternalNoticeConsumerAdmissionManifestPayload,
	sum,
	trimText,
	validateInternalNoticeConsumerAdmissionManifest,
} from "./internal-notice-consumer-admission-support.ts";

export {
	CONSUMER_ADMISSION_BODY_QUALITY_EMPTY,
	CONSUMER_ADMISSION_BODY_QUALITY_PRESENT,
	CONSUMER_ADMISSION_BODY_QUALITY_TITLE_ONLY,
	CONSUMER_ADMISSION_DECISION_ADMIT,
	CONSUMER_ADMISSION_DECISION_BLOCK,
	CONSUMER_ADMISSION_DECISION_NO_ADOPTION,
	CONSUMER_ADMISSION_GATE_OPERATION_IMPORT_MATERIALIZATION,
	CONSUMER_ADMISSION_GATE_OPERATION_MULTIMODAL_DRAIN,
	CONSUMER_ADMISSION_GATE_OPERATION_PROJECTION_REBUILD,
	CONSUMER_ADMISSION_GATE_OPERATION_READ_MODEL_REBUILD,
	CONSUMER_ADMISSION_GATE_OPERATION_TYPED_MATERIALIZATION,
	CONSUMER_ADMISSION_GATE_REASON_ID_MISMATCH,
	CONSUMER_ADMISSION_GATE_REASON_INVALID_MANIFEST,
	CONSUMER_ADMISSION_GATE_REASON_MISSING_MANIFEST,
	CONSUMER_ADMISSION_GATE_REASON_REPLACE_SCOPE_NOT_AUTHORIZED,
	CONSUMER_ADMISSION_GATE_REASON_SCOPE_MISMATCH,
	CONSUMER_ADMISSION_GATE_REASON_TARGET_SURFACE_VIOLATION,
	CONSUMER_ADMISSION_GATE_REASON_THRESHOLD_BREACH,
	CONSUMER_ADMISSION_GATE_VERDICT_ALLOW,
	CONSUMER_ADMISSION_GATE_VERDICT_BLOCK,
	CONSUMER_ADMISSION_MANIFEST_SCHEMA_VERSION,
	CONSUMER_ADMISSION_POLICY_VERSION,
	CONSUMER_ADMISSION_SCOPE_WRITE_MODE_REPLACE_SCOPE,
	CONSUMER_ADMISSION_SCOPE_WRITE_MODE_UPSERT_SELECTED,
	CONSUMER_ADMISSION_STATUS_CANDIDATE_FOR_TYPED_MATERIALIZATION,
	type ConsumerAdmissionDecisionRecord,
	type ConsumerAdmissionGateReport,
	type ConsumerAdmissionGateRequest,
	computeConsumerAdmissionSelectionSha256,
	type InternalNoticeConsumerAdmissionManifest,
	parseInternalNoticeConsumerAdmissionManifestPayload,
	serializeInternalNoticeConsumerAdmissionManifest,
	validateInternalNoticeConsumerAdmissionManifest,
} from "./internal-notice-consumer-admission-support.ts";

export function buildInternalNoticeConsumerAdmissionManifestFromBundleRecords(input: {
	admissionRunId: string;
	bundleRecords: readonly Record<string, unknown>[];
	config: AuthenticatedNoticeNoticeFamilyConfig;
	createdAt?: string | null;
	scopeWriteMode?: string;
	selectionPath: string;
	selectionSource: string;
	siteId?: string;
}): InternalNoticeConsumerAdmissionManifest {
	const bundleByNoticeId = new Map(
		input.bundleRecords.map((record) => [noticeIdFromBundleRecord(record), record]),
	);
	const decisions = input.bundleRecords.map((record) => {
		const sample = resolveAuthenticatedNoticeRoutingSampleFromBundleRecord({
			bundleRecord: record,
			config: input.config,
		});
		const bundleRecord = bundleByNoticeId.get(sample.noticeId) ?? {};
		return decisionFromSample(sample, {
			bodyQuality: bodyQualityFromBundleRecord(bundleRecord),
			rawAssetId: rawAssetIdFromBundleRecord(bundleRecord, {
				noticeId: sample.noticeId,
				siteId: input.siteId ?? "",
			}),
			rawVersionId: rawVersionIdFromBundleRecord(bundleRecord, sample.noticeId),
			siteId: input.siteId ?? "",
		});
	});
	return buildManifest({
		admissionRunId: input.admissionRunId,
		config: input.config,
		createdAt: input.createdAt ?? null,
		decisions,
		scopeWriteMode: input.scopeWriteMode ?? CONSUMER_ADMISSION_SCOPE_WRITE_MODE_UPSERT_SELECTED,
		selectionPath: input.selectionPath,
		selectionSource: input.selectionSource,
	});
}

export function buildInternalNoticeConsumerAdmissionManifestFromInventoryEntries(input: {
	admissionRunId: string;
	config: AuthenticatedNoticeNoticeFamilyConfig;
	createdAt?: string | null;
	inventoryEntries: readonly AuthenticatedNoticeSourceTruthInventoryEntry[];
	scopeWriteMode?: string;
	selectionPath: string;
	selectionSource: string;
}): InternalNoticeConsumerAdmissionManifest {
	const decisions = input.inventoryEntries.map((entry) =>
		decisionFromSample(sampleFromInventoryEntry(entry, input.config), {
			bodyQuality: bodyQualityFromInventoryEntry(entry),
			ownerExpectationCount: ownerExpectationCountFromInventoryEntry(entry),
			rawAssetId: entry.raw_asset_id,
			rawVersionId: entry.raw_version_id,
			siteId: entry.site_id,
			unsupportedBinaryCount: entry.unsupported_binary_count,
		}),
	);
	return buildManifest({
		admissionRunId: input.admissionRunId,
		config: input.config,
		createdAt: input.createdAt ?? null,
		decisions,
		scopeWriteMode: input.scopeWriteMode ?? CONSUMER_ADMISSION_SCOPE_WRITE_MODE_UPSERT_SELECTED,
		selectionPath: input.selectionPath,
		selectionSource: input.selectionSource,
	});
}

export function checkInternalNoticeConsumerAdmissionGate(input: {
	manifest: InternalNoticeConsumerAdmissionManifest | null;
	request: ConsumerAdmissionGateRequest;
}): ConsumerAdmissionGateReport {
	if (!input.manifest) {
		return gateReport(input.request, null, [CONSUMER_ADMISSION_GATE_REASON_MISSING_MANIFEST]);
	}
	let manifest: InternalNoticeConsumerAdmissionManifest;
	try {
		manifest = parseInternalNoticeConsumerAdmissionManifestPayload(input.manifest);
	} catch {
		return gateReport(input.request, input.manifest, [
			CONSUMER_ADMISSION_GATE_REASON_INVALID_MANIFEST,
		]);
	}
	const reasons: string[] = [];
	if (
		manifest.corpus !== input.request.sourceCorpus ||
		manifest.collection !== input.request.sourceCollection
	) {
		reasons.push(CONSUMER_ADMISSION_GATE_REASON_SCOPE_MISMATCH);
	}
	if (
		input.request.scopeWriteMode === CONSUMER_ADMISSION_SCOPE_WRITE_MODE_REPLACE_SCOPE &&
		manifest.scope_write_mode !== CONSUMER_ADMISSION_SCOPE_WRITE_MODE_REPLACE_SCOPE
	) {
		reasons.push(CONSUMER_ADMISSION_GATE_REASON_REPLACE_SCOPE_NOT_AUTHORIZED);
	}
	const requestSelectedNoticeIds = input.request.selectedNoticeIds ?? [];
	const requestedNoticeIds = normalizeNoticeIds(
		requestSelectedNoticeIds.length > 0 ? requestSelectedNoticeIds : manifest.selected_notice_ids,
	);
	const manifestNoticeIds = new Set(manifest.selected_notice_ids);
	if (requestedNoticeIds.some((noticeId) => !manifestNoticeIds.has(noticeId))) {
		reasons.push(CONSUMER_ADMISSION_GATE_REASON_ID_MISMATCH);
	}
	const selectedRecords = selectedDecisionRecords(manifest, requestedNoticeIds);
	if (!operationTargetSurfacesAreAllowed(input.request, selectedRecords)) {
		reasons.push(CONSUMER_ADMISSION_GATE_REASON_TARGET_SURFACE_VIOLATION);
	}
	if (thresholdsBreached(input.request, selectedRecords)) {
		reasons.push(CONSUMER_ADMISSION_GATE_REASON_THRESHOLD_BREACH);
	}
	return gateReport(input.request, manifest, reasons);
}

export function admittedNoticeIdsForTargetSurface(
	manifest: InternalNoticeConsumerAdmissionManifest,
	input: { consumptionStatus?: string | null; targetSurface: string },
): string[] {
	const parsed = parseInternalNoticeConsumerAdmissionManifestPayload(manifest);
	return parsed.decision_records
		.filter(
			(record) =>
				record.admission_decision === CONSUMER_ADMISSION_DECISION_ADMIT &&
				record.target_surface === input.targetSurface &&
				(!input.consumptionStatus || record.consumption_status === input.consumptionStatus),
		)
		.map((record) => record.notice_id)
		.sort();
}

function buildManifest(input: {
	admissionRunId: string;
	config: AuthenticatedNoticeNoticeFamilyConfig;
	createdAt: string | null;
	decisions: readonly ConsumerAdmissionDecisionRecord[];
	scopeWriteMode: string;
	selectionPath: string;
	selectionSource: string;
}): InternalNoticeConsumerAdmissionManifest {
	const decisions = [...input.decisions].sort((left, right) =>
		left.notice_id.localeCompare(right.notice_id),
	);
	const selectedNoticeIds = normalizeNoticeIds(decisions.map((record) => record.notice_id));
	const manifest = {
		admission_run_id: input.admissionRunId,
		collection: input.config.collection,
		corpus: input.config.corpus,
		created_at: input.createdAt ?? new Date().toISOString(),
		decision_counts: decisionCounts(decisions),
		decision_records: decisions,
		policy_version: CONSUMER_ADMISSION_POLICY_VERSION,
		schema_version: CONSUMER_ADMISSION_MANIFEST_SCHEMA_VERSION,
		scope_write_mode: input.scopeWriteMode,
		selected_notice_ids: selectedNoticeIds,
		selection_path: input.selectionPath,
		selection_sha256: computeConsumerAdmissionSelectionSha256(selectedNoticeIds),
		selection_source: input.selectionSource,
		source_channel: input.config.sourceChannel,
	} satisfies InternalNoticeConsumerAdmissionManifest;
	validateInternalNoticeConsumerAdmissionManifest(manifest);
	return manifest;
}

function decisionFromSample(
	sample: AuthenticatedNoticeRoutingSample,
	input: {
		bodyQuality: string;
		ownerExpectationCount?: number;
		rawAssetId: string;
		rawVersionId: string;
		siteId: string;
		unsupportedBinaryCount?: number;
	},
): ConsumerAdmissionDecisionRecord {
	const mapped = mapSampleToDecision(sample);
	return {
		admission_decision: mapped.admissionDecision,
		admission_reason_codes: mapped.reasonCodes,
		attachment_document_count: sample.attachmentDocumentCount,
		attachment_ref_count: sample.attachmentRefCount,
		body_quality: input.bodyQuality,
		consumption_status: mapped.consumptionStatus,
		notice_family: sample.noticeFamily,
		notice_id: sample.noticeId,
		owner_expectation_count: input.ownerExpectationCount ?? 0,
		pending_multimodal_attachment_count:
			mapped.targetSurface === NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE
				? sample.multimodalProcessingRequiredCount
				: 0,
		raw_asset_id: input.rawAssetId,
		raw_version_id: input.rawVersionId,
		reference_only_attachment_ref_count: sample.referenceOnlyCount,
		site_id: input.siteId,
		source_notice_id: sample.noticeId,
		suggested_consumption_route: sample.suggestedConsumptionRoute,
		target_surface: mapped.targetSurface,
		unsupported_binary_count: input.unsupportedBinaryCount ?? 0,
	};
}

function mapSampleToDecision(sample: AuthenticatedNoticeRoutingSample): {
	admissionDecision: string;
	consumptionStatus: string;
	reasonCodes: string[];
	targetSurface: string;
} {
	const route = sample.suggestedConsumptionRoute.trim();
	if (hasHighValueMultimodalGap(sample) && !["defer", "no_adoption"].includes(route)) {
		return {
			admissionDecision: CONSUMER_ADMISSION_DECISION_ADMIT,
			consumptionStatus: NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
			reasonCodes: ["pending_multimodal_processing", route || "unspecified_route"],
			targetSurface: NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE,
		};
	}
	const typedCandidateRoutes: Record<string, string> = {
		regulation_candidate: NOTICE_TARGET_SURFACE_REGULATION_CANDIDATE,
		service_status_candidate: NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
		special_service_candidate: NOTICE_TARGET_SURFACE_SPECIAL_SERVICE_CANDIDATE,
		stable_contact_candidate: NOTICE_TARGET_SURFACE_STABLE_CONTACT_CANDIDATE,
	};
	if (route === "notice_level_query" || route === "procurement_notice_history") {
		return {
			admissionDecision: CONSUMER_ADMISSION_DECISION_ADMIT,
			consumptionStatus: NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
			reasonCodes: [route],
			targetSurface:
				route === "notice_level_query"
					? NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY
					: NOTICE_TARGET_SURFACE_PROCUREMENT_NOTICE_HISTORY,
		};
	}
	if (typedCandidateRoutes[route]) {
		return {
			admissionDecision: CONSUMER_ADMISSION_DECISION_ADMIT,
			consumptionStatus: CONSUMER_ADMISSION_STATUS_CANDIDATE_FOR_TYPED_MATERIALIZATION,
			reasonCodes: [route],
			targetSurface: typedCandidateRoutes[route],
		};
	}
	return {
		admissionDecision: CONSUMER_ADMISSION_DECISION_NO_ADOPTION,
		consumptionStatus: NOTICE_CONSUMPTION_STATUS_NO_ADOPTION,
		reasonCodes: [route || "unsupported_route"],
		targetSurface: NOTICE_TARGET_SURFACE_UNSUPPORTED,
	};
}

function hasHighValueMultimodalGap(sample: AuthenticatedNoticeRoutingSample): boolean {
	return (
		["process", "process_multimodal"].includes(sample.machineProcessingPolicy.trim()) &&
		sample.multimodalProcessingRequiredCount > 0
	);
}

function sampleFromInventoryEntry(
	entry: AuthenticatedNoticeSourceTruthInventoryEntry,
	config: AuthenticatedNoticeNoticeFamilyConfig,
): AuthenticatedNoticeRoutingSample {
	const parentSnapshot = parseRecord(entry.parent_snapshot, "inventory parent_snapshot");
	const sample = resolveAuthenticatedNoticeRoutingSampleFromBundleRecord({
		bundleRecord: {
			notice: {
				categories: normalizeTextValues(
					Array.isArray(parentSnapshot.notice_type_names) ? parentSnapshot.notice_type_names : [],
				).map((name) => ({ notice_type_name: name })),
				notice_content: parseOptionalText(parentSnapshot.notice_content) ?? "",
				notice_id: entry.notice_id,
				notice_title:
					parseOptionalText(parentSnapshot.notice_title) ??
					parseOptionalText(parentSnapshot.notice_title_normalized) ??
					entry.notice_id,
			},
			notice_id: entry.notice_id,
		},
		config,
	});
	return {
		...sample,
		attachmentDocumentCount: entry.attachment_document_count,
		attachmentRefCount: entry.attachment_ref_count,
		multimodalProcessingRequiredCount: entry.multimodal_processing_required_count,
		ocrRequiredCount: entry.ocr_required_count,
		referenceOnlyCount: entry.reference_only_count,
		textExtractableCount: entry.text_extractable_count,
	};
}

function operationTargetSurfacesAreAllowed(
	request: ConsumerAdmissionGateRequest,
	records: readonly ConsumerAdmissionDecisionRecord[],
): boolean {
	if (request.operation === CONSUMER_ADMISSION_GATE_OPERATION_READ_MODEL_REBUILD) {
		return records.every(
			(record) =>
				record.target_surface === NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY &&
				record.consumption_status === NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
		);
	}
	if (request.operation === CONSUMER_ADMISSION_GATE_OPERATION_TYPED_MATERIALIZATION) {
		if (!request.targetSurface) {
			return false;
		}
		return records.every((record) => record.target_surface === request.targetSurface);
	}
	if (request.operation === CONSUMER_ADMISSION_GATE_OPERATION_MULTIMODAL_DRAIN) {
		return records.every(
			(record) =>
				record.target_surface === NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE &&
				record.consumption_status === NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
		);
	}
	return true;
}

function thresholdsBreached(
	request: ConsumerAdmissionGateRequest,
	records: readonly ConsumerAdmissionDecisionRecord[],
): boolean {
	return thresholdPairs(request, records).some(
		([limit, observed]) => limit !== null && limit !== undefined && observed > limit,
	);
}

function thresholdPairs(
	request: ConsumerAdmissionGateRequest,
	records: readonly ConsumerAdmissionDecisionRecord[],
): [number | null | undefined, number][] {
	return [
		[
			request.maxEmptyBodyCount,
			records.filter((record) => record.body_quality === "empty_body").length,
		],
		[
			request.maxOwnerExpectationCount,
			sum(records.map((record) => record.owner_expectation_count)),
		],
		[
			request.maxReferenceOnlyAttachmentCount,
			sum(records.map((record) => record.reference_only_attachment_ref_count)),
		],
		[
			request.maxUnsupportedBinaryCount,
			sum(records.map((record) => record.unsupported_binary_count)),
		],
		[
			request.maxPendingMultimodalAttachmentCount,
			sum(records.map((record) => record.pending_multimodal_attachment_count)),
		],
	];
}

function gateReport(
	request: ConsumerAdmissionGateRequest,
	manifest: InternalNoticeConsumerAdmissionManifest | null,
	reasons: readonly string[],
): ConsumerAdmissionGateReport {
	const requestNoticeIds = normalizeNoticeIds(request.selectedNoticeIds ?? []);
	const records = manifest?.decision_records ?? [];
	const selectedRecords = manifest ? selectedDecisionRecords(manifest, requestNoticeIds) : [];
	const reasonCodes = normalizeTextValues(reasons);
	const thresholdCounts = thresholdCountsFor(selectedRecords);
	return {
		admissionDecisionCounts: countBy(records.map((record) => record.admission_decision)),
		allowed: reasonCodes.length === 0,
		consumptionStatusCounts: countBy(records.map((record) => record.consumption_status)),
		manifestSelectedNoticeIds: manifest?.selected_notice_ids ?? [],
		operation: request.operation,
		reasonCodes,
		selectedNoticeIds: requestNoticeIds,
		sourceCollection: request.sourceCollection,
		sourceCorpus: request.sourceCorpus,
		targetSurfaceCounts: countBy(records.map((record) => record.target_surface)),
		thresholdCounts,
		verdict:
			reasonCodes.length > 0
				? CONSUMER_ADMISSION_GATE_VERDICT_BLOCK
				: CONSUMER_ADMISSION_GATE_VERDICT_ALLOW,
	};
}

function selectedDecisionRecords(
	manifest: InternalNoticeConsumerAdmissionManifest,
	selectedNoticeIds: readonly string[],
): ConsumerAdmissionDecisionRecord[] {
	const selected = new Set(normalizeNoticeIds(selectedNoticeIds));
	return manifest.decision_records.filter(
		(record) => selected.size === 0 || selected.has(record.notice_id),
	);
}

function thresholdCountsFor(records: readonly ConsumerAdmissionDecisionRecord[]) {
	return {
		empty_body_count: records.filter((record) => record.body_quality === "empty_body").length,
		owner_expectation_count: sum(records.map((record) => record.owner_expectation_count)),
		pending_multimodal_attachment_count: sum(
			records.map((record) => record.pending_multimodal_attachment_count),
		),
		reference_only_attachment_ref_count: sum(
			records.map((record) => record.reference_only_attachment_ref_count),
		),
		unsupported_binary_count: sum(records.map((record) => record.unsupported_binary_count)),
	};
}

function bodyQualityFromBundleRecord(record: Record<string, unknown>): string {
	const notice = parseRecord(record.notice ?? {}, "bundle notice");
	if (parseOptionalText(notice.notice_content)) {
		return CONSUMER_ADMISSION_BODY_QUALITY_PRESENT;
	}
	if (parseOptionalText(notice.notice_title)) {
		return CONSUMER_ADMISSION_BODY_QUALITY_TITLE_ONLY;
	}
	return CONSUMER_ADMISSION_BODY_QUALITY_EMPTY;
}

function bodyQualityFromInventoryEntry(
	entry: AuthenticatedNoticeSourceTruthInventoryEntry,
): string {
	const parentSnapshot = parseRecord(entry.parent_snapshot, "inventory parent_snapshot");
	if (parseOptionalText(parentSnapshot.notice_content)) {
		return CONSUMER_ADMISSION_BODY_QUALITY_PRESENT;
	}
	if (parseOptionalText(parentSnapshot.notice_title)) {
		return CONSUMER_ADMISSION_BODY_QUALITY_TITLE_ONLY;
	}
	return CONSUMER_ADMISSION_BODY_QUALITY_EMPTY;
}

function ownerExpectationCountFromInventoryEntry(
	entry: AuthenticatedNoticeSourceTruthInventoryEntry,
): number {
	const parentSnapshot = parseRecord(entry.parent_snapshot, "inventory parent_snapshot");
	return Array.isArray(parentSnapshot.owner_expectations)
		? parentSnapshot.owner_expectations.length
		: 0;
}

function noticeIdFromBundleRecord(record: Record<string, unknown>): string {
	const notice = parseRecord(record.notice ?? {}, "bundle notice");
	return trimText(record.notice_id ?? notice.notice_id);
}

function rawAssetIdFromBundleRecord(
	record: Record<string, unknown>,
	input: { noticeId: string; siteId: string },
): string {
	return (
		parseOptionalText(record.raw_asset_id) ??
		`asset:authenticated-notice:${input.siteId || "unknown"}:${input.noticeId}`
	);
}

function rawVersionIdFromBundleRecord(record: Record<string, unknown>, noticeId: string): string {
	return parseOptionalText(record.raw_version_id) ?? `sha256:bundle:${noticeId}`;
}
