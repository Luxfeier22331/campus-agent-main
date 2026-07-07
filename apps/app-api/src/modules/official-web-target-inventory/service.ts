import mucPublicTargetInventoryManifest from "../../../../../configs/sources/official_web/muc_public/target-inventory.json";
import { AppApiRouteError } from "../../http";
import type { ResolvedAppPrincipal } from "../auth";

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

export interface OfficialWebTargetInventoryEntry {
	admissionTargetId: string;
	consumerFamily: string;
	inventoryId: string;
	inventoryOnly: boolean;
	materializationPolicy: string;
	notes: string;
	ownerToolOrRuntime: string;
	ownerSurface: string;
	previewStatus: string;
	releaseBlockers: string[];
	optionalEvidence: string[];
	optionalFields: string[];
	requiredEvidence: string[];
	requiredFields: string[];
	selectedWriteTarget: string;
	sourceHosts: string[];
	sourceUrls: string[];
	targetLabel: string;
}

export interface OfficialWebTargetInventory {
	entries: OfficialWebTargetInventoryEntry[];
	inventoryVersion: string;
	schemaVersion: string;
	siteId: string;
}

interface OfficialWebTargetInventoryManifestEntry {
	admission_target_id: string;
	consumer_family: string;
	inventory_id: string;
	inventory_only: boolean;
	materialization_policy: string;
	notes: string;
	owner_tool_or_runtime: string;
	owner_surface: string;
	preview_status: string;
	release_blockers: string[];
	optional_evidence?: string[];
	optional_fields?: string[];
	required_evidence: string[];
	required_fields: string[];
	selected_write_target: string;
	source_hosts: string[];
	source_urls: string[];
	target_label: string;
}

interface OfficialWebTargetInventoryManifest {
	entries: OfficialWebTargetInventoryManifestEntry[];
	inventory_version: string;
	schema_version: string;
	site_id: string;
}

interface OfficialWebTargetInventoryReportEntry {
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

interface BuildOfficialWebTargetInventoryReportInput {
	fieldStatusByInventoryId?: Record<string, Record<string, OfficialWebTargetInventoryFieldStatus>>;
	previewEvidence?: OfficialWebTargetInventoryPreviewEvidence[];
}

export interface OfficialWebTargetInventoryRecord {
	admissionTargetId: string;
	consumerFamily: string;
	fieldStatus: Record<string, OfficialWebTargetInventoryFieldStatus>;
	id: string;
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

export interface OfficialWebTargetInventoryListFilters {
	consumerFamily?: string | null;
	ownerSurface?: string | null;
	reviewState?: string | null;
	siteId?: string | null;
}

export interface NormalizedOfficialWebTargetInventoryListFilters {
	consumerFamily: string | null;
	ownerSurface: string | null;
	reviewState: string | null;
	siteId: string | null;
}

export interface OfficialWebTargetInventoryListResult {
	entries: OfficialWebTargetInventoryRecord[];
	page: { nextCursor: string | null };
	summary: {
		countsByReviewState: Partial<Record<OfficialWebTargetInventoryReviewState, number>>;
		inventoryVersion: string;
		siteId: string;
	};
}

export interface OfficialWebTargetInventoryService {
	getTargetInventoryEntryById(input: {
		inventoryId: string;
		principal: ResolvedAppPrincipal;
	}): Promise<OfficialWebTargetInventoryRecord>;
	listTargetInventory(input: {
		filters: OfficialWebTargetInventoryListFilters;
		principal: ResolvedAppPrincipal;
	}): Promise<OfficialWebTargetInventoryListResult>;
}

export interface OfficialWebTargetInventoryServiceOptions {
	fieldStatusStore?: OfficialWebTargetInventoryFieldStatusStore;
	previewEvidenceStore?: OfficialWebTargetInventoryPreviewEvidenceStore;
	targetInventory?: OfficialWebTargetInventory;
}

export interface OfficialWebTargetInventoryFieldStatusStore {
	listFieldStatus(input: {
		entries: OfficialWebTargetInventory["entries"];
		siteId: string;
	}): Promise<Record<string, Record<string, OfficialWebTargetInventoryFieldStatus>>>;
}

export interface OfficialWebTargetInventoryPreviewEvidenceStore {
	listPreviewEvidence(input: {
		entries: OfficialWebTargetInventory["entries"];
		siteId: string;
	}): Promise<OfficialWebTargetInventoryPreviewEvidence[]>;
}

const REQUIRED_PREVIEW_FIELDS = [
	["appApiRunId", "missing_app_api_run_id"],
	["targetJobId", "missing_target_job_id"],
	["targetAttemptId", "missing_target_attempt_id"],
	["rawAssetId", "missing_raw_asset_id"],
	["rawVersionId", "missing_raw_version_id"],
] as const;

const DEFAULT_TARGET_INVENTORY = normalizeOfficialWebTargetInventoryManifest(
	mucPublicTargetInventoryManifest as OfficialWebTargetInventoryManifest,
);

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

function normalizeOfficialWebTargetInventoryManifest(
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

function buildOfficialWebTargetInventoryReportFromInventory(
	targetInventory: OfficialWebTargetInventory,
	input: BuildOfficialWebTargetInventoryReportInput = {},
): {
	entries: OfficialWebTargetInventoryReportEntry[];
	inventoryVersion: string;
	siteId: string;
} {
	const evidenceByInventoryId = new Map(
		(input.previewEvidence ?? []).map((evidence) => [evidence.inventoryId, evidence]),
	);
	const entries = targetInventory.entries.map((entry) =>
		buildEntryReport(entry, {
			fieldStatus: input.fieldStatusByInventoryId?.[entry.inventoryId],
			previewEvidence: evidenceByInventoryId.get(entry.inventoryId),
		}),
	);

	return {
		entries,
		inventoryVersion: targetInventory.inventoryVersion,
		siteId: targetInventory.siteId,
	};
}

function ensureOperatorPrincipal(principal: ResolvedAppPrincipal): void {
	if (!principal.permissions.operator) {
		throw new AppApiRouteError({
			code: "forbidden",
			message: "Operator access is not available for this principal.",
			retryable: false,
			status: 403,
		});
	}
}

function normalizeOptionalString(value: string | null | undefined): string | null {
	const normalized = value?.trim();
	return normalized ? normalized : null;
}

function normalizeFilters(
	filters: OfficialWebTargetInventoryListFilters,
): NormalizedOfficialWebTargetInventoryListFilters {
	return {
		consumerFamily: normalizeOptionalString(filters.consumerFamily),
		ownerSurface: normalizeOptionalString(filters.ownerSurface),
		reviewState: normalizeOptionalString(filters.reviewState),
		siteId: normalizeOptionalString(filters.siteId),
	};
}

function countsByReviewState(records: OfficialWebTargetInventoryRecord[]) {
	const counts: Partial<Record<OfficialWebTargetInventoryReviewState, number>> = {};
	for (const record of records) {
		counts[record.reviewState] = (counts[record.reviewState] ?? 0) + 1;
	}
	return counts;
}

function mapReportEntryToRecord(entry: {
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
}): OfficialWebTargetInventoryRecord {
	return {
		...entry,
		id: entry.inventoryId,
	};
}

export function buildOfficialWebTargetInventoryService(
	options: OfficialWebTargetInventoryServiceOptions = {},
): OfficialWebTargetInventoryService {
	const targetInventory = options.targetInventory ?? DEFAULT_TARGET_INVENTORY;

	async function buildReport() {
		const previewEvidence = options.previewEvidenceStore
			? await options.previewEvidenceStore.listPreviewEvidence({
					entries: targetInventory.entries,
					siteId: targetInventory.siteId,
				})
			: [];
		const fieldStatusByInventoryId = options.fieldStatusStore
			? await options.fieldStatusStore.listFieldStatus({
					entries: targetInventory.entries,
					siteId: targetInventory.siteId,
				})
			: {};
		return buildOfficialWebTargetInventoryReportFromInventory(targetInventory, {
			fieldStatusByInventoryId,
			previewEvidence,
		});
	}

	return {
		async getTargetInventoryEntryById(input) {
			ensureOperatorPrincipal(input.principal);
			const inventoryId = normalizeOptionalString(input.inventoryId);
			const report = await buildReport();
			const entry = report.entries.find((item) => item.inventoryId === inventoryId);
			if (!entry) {
				throw new AppApiRouteError({
					code: "target_inventory_not_found",
					message: "Official web target inventory entry not found.",
					retryable: false,
					status: 404,
				});
			}
			return mapReportEntryToRecord(entry);
		},

		async listTargetInventory(input) {
			ensureOperatorPrincipal(input.principal);
			const filters = normalizeFilters(input.filters);
			const siteId = filters.siteId ?? targetInventory.siteId;
			const report = await buildReport();
			const entries =
				siteId === targetInventory.siteId
					? report.entries
							.filter(
								(entry) =>
									(!filters.consumerFamily || entry.consumerFamily === filters.consumerFamily) &&
									(!filters.ownerSurface || entry.ownerSurface === filters.ownerSurface) &&
									(!filters.reviewState || entry.reviewState === filters.reviewState),
							)
							.map(mapReportEntryToRecord)
					: [];

			return {
				entries,
				page: { nextCursor: null },
				summary: {
					countsByReviewState: countsByReviewState(entries),
					inventoryVersion: targetInventory.inventoryVersion,
					siteId,
				},
			};
		},
	};
}
