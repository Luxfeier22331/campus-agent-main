import type { DiningPublishedSnapshot } from "./types";

export interface DiningValidationIssue {
	code:
		| "duplicate_svg_anchor_binding"
		| "floorplan_manifest_mismatch"
		| "missing_floorplan_manifest"
		| "missing_menu_item_projection"
		| "missing_stall_profile_projection"
		| "missing_svg_anchor"
		| "unbound_required_window";
	message: string;
	ref: Record<string, string>;
}

export interface DiningValidationReport {
	blockers: DiningValidationIssue[];
	createdAt: string;
	draftRevision: number;
	status: "fail" | "pass";
	summary: Record<string, number>;
	warnings: DiningValidationIssue[];
}

export interface DiningRelease {
	createdAt: string;
	createdBy: string;
	draftRevision: number;
	notes: string;
	predecessorReleaseId: string | null;
	releaseId: string;
	rollbackOfReleaseId: string | null;
	snapshotHash: string;
	validation: DiningValidationReport;
}

export interface DiningReleaseDetail {
	release: DiningRelease;
	snapshot: DiningPublishedSnapshot;
}

export interface DiningPublication {
	catalogReleaseId: string | null;
	reviewRevision: number;
	updatedAt: string;
}
