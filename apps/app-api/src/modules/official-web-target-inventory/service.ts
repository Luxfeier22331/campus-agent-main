import {
	buildOfficialWebTargetInventoryReportFromInventory,
	normalizeOfficialWebTargetInventoryManifest,
	type OfficialWebTargetInventory,
	type OfficialWebTargetInventoryManifest,
	type OfficialWebTargetInventoryPreviewEvidence,
} from "official-web-core/target-inventory";

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

const DEFAULT_TARGET_INVENTORY = normalizeOfficialWebTargetInventoryManifest(
	mucPublicTargetInventoryManifest as OfficialWebTargetInventoryManifest,
);

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
