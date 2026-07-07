import type {
	OfficialWebConfigBundle,
	OfficialWebConsumerFamily,
	OfficialWebConsumerMaterializationPolicy,
	OfficialWebConsumerRequiredEvidence,
	OfficialWebTargetInventory,
	OfficialWebTargetInventoryEntry,
} from "./config-models.ts";

export type { OfficialWebTargetInventory } from "./config-models.ts";

export type OfficialWebTargetInventoryReviewState =
	| "candidate"
	| "previewed"
	| "blocked_fields"
	| "blocked_lineage"
	| "blocked_source"
	| "inventory_only"
	| "ready_for_selected_write"
	| "excluded";

export type OfficialWebTargetInventoryFieldStatus =
	| "ambiguous"
	| "missing"
	| "not_applicable"
	| "present"
	| "source_not_provided";

export interface OfficialWebTargetInventoryPreviewEvidence {
	appApiRunId: string;
	currentTruthImportWasNull: boolean;
	ingestionStatus: string;
	inventoryId: string;
	promotionDecision: string;
	rawAssetId: string;
	rawVersionId: string;
	sourceObjectKeys: string[];
	targetAttemptId: string;
	targetJobId: string;
}

export interface OfficialWebTargetInventoryReportEntry {
	admissionTargetId: string;
	consumerFamily: string;
	fieldStatus: Record<string, OfficialWebTargetInventoryFieldStatus>;
	inventoryId: string;
	ownerSurface: string;
	optionalEvidence: string[];
	optionalFields: string[];
	previewEvidence: OfficialWebTargetInventoryPreviewEvidence | null;
	releaseBlockers: string[];
	requiredEvidence: string[];
	requiredFields: string[];
	reviewState: OfficialWebTargetInventoryReviewState;
	selectedWriteTarget: string;
	sourceUrls: string[];
	targetLabel: string;
}

export interface OfficialWebTargetInventoryReport {
	countsByReviewState: Partial<Record<OfficialWebTargetInventoryReviewState, number>>;
	entries: OfficialWebTargetInventoryReportEntry[];
	inventoryVersion: string;
	siteId: string;
}

export interface OfficialWebTargetInventoryManifestEntry {
	admission_target_id: string;
	consumer_family: OfficialWebConsumerFamily;
	inventory_id: string;
	inventory_only: boolean;
	materialization_policy: OfficialWebConsumerMaterializationPolicy;
	notes: string;
	owner_tool_or_runtime: string;
	owner_surface: string;
	preview_status: string;
	release_blockers: string[];
	optional_evidence?: OfficialWebConsumerRequiredEvidence[];
	optional_fields?: string[];
	required_evidence: OfficialWebConsumerRequiredEvidence[];
	required_fields: string[];
	selected_write_target: string;
	source_hosts: string[];
	source_urls: string[];
	target_label: string;
}

export interface OfficialWebTargetInventoryManifest {
	entries: OfficialWebTargetInventoryManifestEntry[];
	inventory_version: string;
	schema_version: string;
	site_id: string;
}

export interface BuildOfficialWebTargetInventoryReportInput {
	fieldStatusByInventoryId?: Record<string, Record<string, OfficialWebTargetInventoryFieldStatus>>;
	previewEvidence?: OfficialWebTargetInventoryPreviewEvidence[];
}

const REQUIRED_PREVIEW_FIELDS = [
	["appApiRunId", "missing_app_api_run_id"],
	["targetJobId", "missing_target_job_id"],
	["targetAttemptId", "missing_target_attempt_id"],
	["rawAssetId", "missing_raw_asset_id"],
	["rawVersionId", "missing_raw_version_id"],
] as const;

function normalizeFieldStatus(
	entry: OfficialWebTargetInventoryEntry,
	fieldStatus: Record<string, OfficialWebTargetInventoryFieldStatus> | undefined,
): Record<string, OfficialWebTargetInventoryFieldStatus> {
	const normalized: Record<string, OfficialWebTargetInventoryFieldStatus> = {};
	for (const fieldName of blockingReviewFields(entry)) {
		normalized[fieldName] = fieldStatus?.[fieldName] ?? "missing";
	}
	for (const fieldName of optionalReviewFields(entry)) {
		if (fieldName in normalized) {
			continue;
		}
		normalized[fieldName] = fieldStatus?.[fieldName] ?? "source_not_provided";
	}
	return normalized;
}

function uniqueFields(fields: string[]): string[] {
	const unique: string[] = [];
	for (const fieldName of fields) {
		if (!unique.includes(fieldName)) {
			unique.push(fieldName);
		}
	}
	return unique;
}

function blockingReviewFields(entry: OfficialWebTargetInventoryEntry): string[] {
	const requiredEvidence =
		entry.materializationPolicy === "candidate_only" ? entry.requiredEvidence : [];
	return uniqueFields([...entry.requiredFields, ...requiredEvidence]);
}

function optionalReviewFields(entry: OfficialWebTargetInventoryEntry): string[] {
	const optionalEvidence =
		entry.materializationPolicy === "candidate_only" ? entry.optionalEvidence : [];
	return uniqueFields([...entry.optionalFields, ...optionalEvidence]);
}

function previewLineageBlockers(evidence: OfficialWebTargetInventoryPreviewEvidence): string[] {
	const blockers: string[] = [];
	for (const [fieldName, blocker] of REQUIRED_PREVIEW_FIELDS) {
		if (!evidence[fieldName].trim()) {
			blockers.push(blocker);
		}
	}
	if (evidence.sourceObjectKeys.length === 0) {
		blockers.push("missing_source_object_keys");
	}
	if (evidence.ingestionStatus !== "staged") {
		blockers.push("ingestion_not_staged");
	}
	if (evidence.promotionDecision !== "staged") {
		blockers.push("promotion_not_staged");
	}
	if (!evidence.currentTruthImportWasNull) {
		blockers.push("current_truth_import_present");
	}
	return blockers;
}

function fieldBlockers(
	fieldStatus: Record<string, OfficialWebTargetInventoryFieldStatus>,
	blockingFields: string[],
): string[] {
	const blockers: string[] = [];
	for (const fieldName of blockingFields) {
		const status = fieldStatus[fieldName] ?? "missing";
		if (status === "missing" || status === "ambiguous") {
			blockers.push(`${status}_${fieldName}`);
		}
	}
	return blockers;
}

function releaseGateBlockers(entry: OfficialWebTargetInventoryEntry): string[] {
	const blockers = entry.releaseBlockers.filter((blocker) => blocker !== "no_preview_evidence");
	return blockers.length > 0 ? blockers : ["release_gate_not_reviewed"];
}

function usesAppApiReleaseGate(entry: OfficialWebTargetInventoryEntry): boolean {
	return (
		entry.consumerFamily === "stable_reference_candidate" &&
		entry.selectedWriteTarget === "official_web/stable_reference"
	);
}

function buildEntryReport(
	entry: OfficialWebTargetInventoryEntry,
	input: {
		fieldStatus: Record<string, OfficialWebTargetInventoryFieldStatus> | undefined;
		previewEvidence: OfficialWebTargetInventoryPreviewEvidence | undefined;
	},
): OfficialWebTargetInventoryReportEntry {
	const normalizedFieldStatus = normalizeFieldStatus(entry, input.fieldStatus);
	const evidence = input.previewEvidence ?? null;

	let reviewState: OfficialWebTargetInventoryReviewState = "candidate";
	let releaseBlockers = [...entry.releaseBlockers];
	if (entry.inventoryOnly) {
		reviewState = "inventory_only";
	} else if (evidence) {
		const lineageBlockers = previewLineageBlockers(evidence);
		if (lineageBlockers.length > 0) {
			reviewState = "blocked_lineage";
			releaseBlockers = lineageBlockers;
		} else {
			const missingFields = fieldBlockers(normalizedFieldStatus, blockingReviewFields(entry));
			if (missingFields.length > 0) {
				reviewState = "blocked_fields";
				releaseBlockers = missingFields;
			} else if (
				entry.materializationPolicy === "release_gate_required" &&
				usesAppApiReleaseGate(entry)
			) {
				reviewState = "previewed";
				releaseBlockers = releaseGateBlockers(entry);
			} else {
				reviewState = "ready_for_selected_write";
				releaseBlockers = [];
			}
		}
	} else {
		reviewState = "candidate";
	}

	return {
		admissionTargetId: entry.admissionTargetId,
		consumerFamily: entry.consumerFamily,
		fieldStatus: normalizedFieldStatus,
		inventoryId: entry.inventoryId,
		ownerSurface: entry.ownerSurface,
		optionalEvidence: entry.optionalEvidence,
		optionalFields: entry.optionalFields,
		previewEvidence: evidence,
		releaseBlockers,
		requiredEvidence: entry.requiredEvidence,
		requiredFields: entry.requiredFields,
		reviewState,
		selectedWriteTarget: entry.selectedWriteTarget,
		sourceUrls: entry.sourceUrls,
		targetLabel: entry.targetLabel,
	};
}

export function normalizeOfficialWebTargetInventoryManifest(
	manifest: OfficialWebTargetInventoryManifest,
): OfficialWebTargetInventory {
	return {
		entries: manifest.entries.map((entry) => ({
			admissionTargetId: entry.admission_target_id,
			consumerFamily: entry.consumer_family,
			inventoryId: entry.inventory_id,
			inventoryOnly: entry.inventory_only,
			materializationPolicy: entry.materialization_policy,
			notes: entry.notes,
			ownerToolOrRuntime: entry.owner_tool_or_runtime,
			ownerSurface: entry.owner_surface,
			previewStatus: entry.preview_status,
			releaseBlockers: entry.release_blockers,
			optionalEvidence: entry.optional_evidence ?? [],
			optionalFields: entry.optional_fields ?? [],
			requiredEvidence: entry.required_evidence,
			requiredFields: entry.required_fields,
			selectedWriteTarget: entry.selected_write_target,
			sourceHosts: entry.source_hosts,
			sourceUrls: entry.source_urls,
			targetLabel: entry.target_label,
		})),
		inventoryVersion: manifest.inventory_version,
		schemaVersion: manifest.schema_version,
		siteId: manifest.site_id,
	};
}

export function buildOfficialWebTargetInventoryReportFromInventory(
	targetInventory: OfficialWebTargetInventory,
	input: BuildOfficialWebTargetInventoryReportInput = {},
): OfficialWebTargetInventoryReport {
	const evidenceByInventoryId = new Map(
		(input.previewEvidence ?? []).map((evidence) => [evidence.inventoryId, evidence]),
	);
	const entries = targetInventory.entries.map((entry) =>
		buildEntryReport(entry, {
			fieldStatus: input.fieldStatusByInventoryId?.[entry.inventoryId],
			previewEvidence: evidenceByInventoryId.get(entry.inventoryId),
		}),
	);
	const countsByReviewState: Partial<Record<OfficialWebTargetInventoryReviewState, number>> = {};
	for (const entry of entries) {
		countsByReviewState[entry.reviewState] = (countsByReviewState[entry.reviewState] ?? 0) + 1;
	}

	return {
		countsByReviewState,
		entries,
		inventoryVersion: targetInventory.inventoryVersion,
		siteId: targetInventory.siteId,
	};
}

export function buildOfficialWebTargetInventoryReport(
	bundle: OfficialWebConfigBundle,
	input: BuildOfficialWebTargetInventoryReportInput = {},
): OfficialWebTargetInventoryReport {
	return buildOfficialWebTargetInventoryReportFromInventory(bundle.targetInventory, input);
}
