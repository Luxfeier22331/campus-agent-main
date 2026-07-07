import { parseOptionalText } from "./core.ts";

export interface AuthenticatedNoticeAttachmentSourceRetentionDecision {
	attachmentCapturePolicy: string;
	attachmentCaptureState: string;
	attachmentRefId: string;
	byteFetchRequired: boolean;
	reasonCodes: string[];
	requiredSourceObject: boolean;
	retentionClass: string;
}

export interface AuthenticatedNoticeSourceRetentionDecision {
	attachmentCapturePolicyCounts: Record<string, number>;
	attachmentDecisions: AuthenticatedNoticeAttachmentSourceRetentionDecision[];
	metadataOnlyAttachmentRefCount: number;
	noticeCaptureRoute: string;
	quarantineAttachmentRefCount: number;
	requiredSourceObjectCount: number;
}

export interface AuthenticatedNoticeRetentionManifestFields {
	admitted_source_byte_ref_count: number;
	attachment_capture_policy_counts: Record<string, number>;
	attachment_capture_state_counts: Record<string, number>;
	metadata_only_attachment_ref_count: number;
	notice_capture_route: string;
	quarantine_attachment_ref_count: number;
	required_source_object_count: number;
	retention_class_counts: Record<string, number>;
}

export function resolveAuthenticatedNoticeCaptureRoute(input: {
	suggestedConsumptionRoute: string;
}): string {
	if (input.suggestedConsumptionRoute === "notice_level_query") {
		return "notice_level_query_only";
	}
	if (input.suggestedConsumptionRoute === "service_status_candidate") {
		return "candidate_service_fact";
	}
	if (input.suggestedConsumptionRoute === "regulation_candidate") {
		return "candidate_document_owner";
	}
	if (["defer", "no_adoption"].includes(input.suggestedConsumptionRoute)) {
		return "capture_only_no_adoption";
	}
	return "candidate_requires_attachment_routing";
}

export function buildAuthenticatedNoticeSourceRetentionDecision(input: {
	attachmentRefs: readonly Record<string, unknown>[];
	missingFactAttachmentRefIds?: readonly string[];
	noticeCaptureRoute: string;
	sourceTruthRequiredAttachmentRefIds?: readonly string[];
}): AuthenticatedNoticeSourceRetentionDecision {
	const missingFactAttachmentRefIds = new Set(input.missingFactAttachmentRefIds ?? []);
	const sourceTruthRequiredAttachmentRefIds = new Set(
		input.sourceTruthRequiredAttachmentRefIds ?? [],
	);
	const attachmentDecisions = input.attachmentRefs.map((attachmentRef) =>
		buildAttachmentDecision({
			attachmentRef,
			attachmentRefId: requireAttachmentRefId(attachmentRef),
			missingFactAttachmentRefIds,
			noticeCaptureRoute: input.noticeCaptureRoute,
			sourceTruthRequiredAttachmentRefIds,
		}),
	);
	const policyCounts = countBy(
		attachmentDecisions.map((decision) => decision.attachmentCapturePolicy),
	);
	return {
		attachmentCapturePolicyCounts: policyCounts,
		attachmentDecisions,
		metadataOnlyAttachmentRefCount: policyCounts.metadata_only ?? 0,
		noticeCaptureRoute: input.noticeCaptureRoute,
		quarantineAttachmentRefCount: policyCounts.fetch_to_quarantine ?? 0,
		requiredSourceObjectCount: attachmentDecisions.filter(
			(decision) => decision.requiredSourceObject,
		).length,
	};
}

export function applyAuthenticatedNoticeSourceRetention(input: {
	attachmentRefs: readonly Record<string, unknown>[];
	capturedAt: string;
	sourceRetentionDecision: AuthenticatedNoticeSourceRetentionDecision;
}): Record<string, unknown>[] {
	const decisionsByRefId = new Map(
		input.sourceRetentionDecision.attachmentDecisions.map((decision) => [
			decision.attachmentRefId,
			decision,
		]),
	);
	return input.attachmentRefs.map((attachmentRef) => {
		const attachmentRefId = requireAttachmentRefId(attachmentRef);
		const decision = decisionsByRefId.get(attachmentRefId);
		if (!decision) {
			return { ...attachmentRef };
		}
		const terminalReason = parseOptionalText(attachmentRef.terminal_reason);
		const lastErrorClass = parseOptionalText(attachmentRef.last_error_class);
		if (terminalReason && lastErrorClass === "terminal_unavailable") {
			return {
				...attachmentRef,
				attachment_capture_policy: "terminal_unavailable",
				attachment_capture_state: "terminal_missing",
				attachment_promotion_state: "not_applicable",
				byte_fetch_required: false,
				byte_fetch_required_reason: terminalReason,
				last_error_class: lastErrorClass,
				notice_capture_route: input.sourceRetentionDecision.noticeCaptureRoute,
				promotion_decision_id: null,
				promotion_owner: null,
				promotion_reason_codes: [],
				required_source_object: false,
				retention_class: "metadata_only",
				retention_expires_at: null,
				skip_reason: null,
				source_object_role: null,
				terminal_reason: terminalReason,
			};
		}
		return {
			...attachmentRef,
			attachment_capture_policy: decision.attachmentCapturePolicy,
			attachment_capture_state: decision.attachmentCaptureState,
			attachment_promotion_state:
				decision.retentionClass === "quarantine_candidate" ? "candidate" : "not_applicable",
			byte_fetch_required: decision.byteFetchRequired,
			byte_fetch_required_reason: decision.reasonCodes.join(",") || null,
			notice_capture_route: input.sourceRetentionDecision.noticeCaptureRoute,
			promotion_decision_id: null,
			promotion_owner: null,
			promotion_reason_codes: [],
			required_source_object: decision.requiredSourceObject,
			retention_class: decision.retentionClass,
			retention_expires_at: retentionExpiresAt({
				capturedAt: input.capturedAt,
				retentionClass: decision.retentionClass,
			}),
			skip_reason: null,
			source_object_role: decision.requiredSourceObject ? "notice_attachment_source_bytes" : null,
		};
	});
}

export function buildAuthenticatedNoticeRetentionManifestFields(input: {
	attachmentRefs: readonly Record<string, unknown>[];
	noticeCaptureRoute: string;
}): AuthenticatedNoticeRetentionManifestFields {
	const attachmentCapturePolicyCounts = countBy(
		input.attachmentRefs
			.map((ref) => parseOptionalText(ref.attachment_capture_policy))
			.filter(isText),
	);
	const attachmentCaptureStateCounts = countBy(
		input.attachmentRefs
			.map((ref) => parseOptionalText(ref.attachment_capture_state))
			.filter(isText),
	);
	const retentionClassCounts = countBy(
		input.attachmentRefs.map((ref) => parseOptionalText(ref.retention_class)).filter(isText),
	);
	return {
		admitted_source_byte_ref_count: retentionClassCounts.admitted_source_bytes ?? 0,
		attachment_capture_policy_counts: attachmentCapturePolicyCounts,
		attachment_capture_state_counts: attachmentCaptureStateCounts,
		metadata_only_attachment_ref_count: attachmentCapturePolicyCounts.metadata_only ?? 0,
		notice_capture_route: input.noticeCaptureRoute,
		quarantine_attachment_ref_count: attachmentCapturePolicyCounts.fetch_to_quarantine ?? 0,
		required_source_object_count: input.attachmentRefs.filter((ref) =>
			Boolean(ref.required_source_object),
		).length,
		retention_class_counts: retentionClassCounts,
	};
}

function buildAttachmentDecision(input: {
	attachmentRef: Record<string, unknown>;
	attachmentRefId: string;
	missingFactAttachmentRefIds: ReadonlySet<string>;
	noticeCaptureRoute: string;
	sourceTruthRequiredAttachmentRefIds: ReadonlySet<string>;
}): AuthenticatedNoticeAttachmentSourceRetentionDecision {
	if (["notice_level_query_only", "capture_only_no_adoption"].includes(input.noticeCaptureRoute)) {
		return metadataOnlyAttachmentDecision(input.attachmentRefId, [input.noticeCaptureRoute]);
	}
	if (input.noticeCaptureRoute === "candidate_service_fact") {
		if (input.missingFactAttachmentRefIds.has(input.attachmentRefId)) {
			return requiredFetchDecision({
				attachmentRef: input.attachmentRef,
				attachmentRefId: input.attachmentRefId,
				baseReasonCodes: ["service_fact_missing_required_fact"],
				retentionClass: "quarantine_candidate",
				requiredSourceObject: false,
				uploadedState: "uploaded_quarantine",
				policy: "fetch_to_quarantine",
			});
		}
		return metadataOnlyAttachmentDecision(input.attachmentRefId, ["service_fact_text_complete"]);
	}
	if (input.noticeCaptureRoute === "candidate_document_owner") {
		if (input.sourceTruthRequiredAttachmentRefIds.has(input.attachmentRefId)) {
			return requiredFetchDecision({
				attachmentRef: input.attachmentRef,
				attachmentRefId: input.attachmentRefId,
				baseReasonCodes: ["source_truth_required_attachment"],
				retentionClass: "permanent_source_truth",
				requiredSourceObject: true,
				uploadedState: "uploaded_required",
				policy: "fetch_required_for_source_truth",
			});
		}
		return metadataOnlyAttachmentDecision(input.attachmentRefId, ["owner_not_admitted"]);
	}
	if (input.noticeCaptureRoute === "candidate_requires_attachment_routing") {
		if (input.missingFactAttachmentRefIds.has(input.attachmentRefId)) {
			return requiredFetchDecision({
				attachmentRef: input.attachmentRef,
				attachmentRefId: input.attachmentRefId,
				baseReasonCodes: ["attachment_routing_required"],
				retentionClass: "quarantine_candidate",
				requiredSourceObject: false,
				uploadedState: "uploaded_quarantine",
				policy: "fetch_to_quarantine",
			});
		}
		return metadataOnlyAttachmentDecision(input.attachmentRefId, [
			"attachment_routing_not_admitted",
		]);
	}
	throw new Error(`Unsupported notice_capture_route: ${input.noticeCaptureRoute}`);
}

function requiredFetchDecision(input: {
	attachmentRef: Record<string, unknown>;
	attachmentRefId: string;
	baseReasonCodes: string[];
	policy: string;
	requiredSourceObject: boolean;
	retentionClass: string;
	uploadedState: string;
}): AuthenticatedNoticeAttachmentSourceRetentionDecision {
	const hasBytes = hasCollectedAttachmentBytes(input.attachmentRef);
	const transientFailed =
		parseOptionalText(input.attachmentRef.last_error_class) === "transient_failed";
	const reasonCodes = transientFailed
		? [...input.baseReasonCodes, "transient_failed"]
		: [...input.baseReasonCodes];
	return {
		attachmentCapturePolicy: input.policy,
		attachmentCaptureState: hasBytes
			? input.uploadedState
			: transientFailed
				? "transient_failed"
				: "not_attempted",
		attachmentRefId: input.attachmentRefId,
		byteFetchRequired: !hasBytes,
		reasonCodes,
		requiredSourceObject: input.requiredSourceObject,
		retentionClass: input.retentionClass,
	};
}

function metadataOnlyAttachmentDecision(
	attachmentRefId: string,
	reasonCodes: string[],
): AuthenticatedNoticeAttachmentSourceRetentionDecision {
	return {
		attachmentCapturePolicy: "metadata_only",
		attachmentCaptureState: "metadata_recorded",
		attachmentRefId,
		byteFetchRequired: false,
		reasonCodes,
		requiredSourceObject: false,
		retentionClass: "metadata_only",
	};
}

function hasCollectedAttachmentBytes(attachmentRef: Record<string, unknown>): boolean {
	const ingestStatus = parseOptionalText(attachmentRef.ingest_status);
	return Boolean(
		parseOptionalText(attachmentRef.object_key) &&
			parseOptionalText(attachmentRef.content_sha256) &&
			attachmentRef.byte_size !== null &&
			attachmentRef.byte_size !== undefined &&
			parseOptionalText(attachmentRef.storage_provider) !== "reference_only" &&
			(ingestStatus === "downloaded" || ingestStatus === "uploaded"),
	);
}

function retentionExpiresAt(input: { capturedAt: string; retentionClass: string }): string | null {
	if (input.retentionClass !== "quarantine_candidate") {
		return null;
	}
	const timestamp = Date.parse(input.capturedAt);
	if (!Number.isFinite(timestamp)) {
		return null;
	}
	return new Date(timestamp + 14 * 24 * 60 * 60 * 1000).toISOString();
}

function requireAttachmentRefId(attachmentRef: Record<string, unknown>): string {
	const attachmentRefId = parseOptionalText(attachmentRef.attachment_ref_id);
	if (!attachmentRefId) {
		throw new Error("attachment_ref must include a non-empty attachment_ref_id");
	}
	return attachmentRefId;
}

function countBy(values: readonly string[]): Record<string, number> {
	const counts = new Map<string, number>();
	for (const value of values) {
		counts.set(value, (counts.get(value) ?? 0) + 1);
	}
	return Object.fromEntries(
		[...counts.entries()].sort(([left], [right]) => left.localeCompare(right)),
	);
}

function isText(value: string | null): value is string {
	return Boolean(value);
}
