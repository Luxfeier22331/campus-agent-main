import type { DiningPublication } from "@campus-agent/dining/domain";

export type {
	DiningDraft,
	DiningPublication,
	DiningRelease,
	DiningReleaseDetail,
	DiningValidationReport,
} from "@campus-agent/dining/domain";

export interface DiningOpsOverview {
	draft: { baseReleaseId: string | null; revision: number; updatedAt: string; updatedBy: string };
	publication: DiningPublication;
	releases: number;
	reviews: { blocked: number; hidden: number; published: number };
	source: { latestRunAt: string | null; pendingCatalogObservations: number };
}

export interface DiningOpsReview {
	comment: string | null;
	contributorName: string | null;
	dishName: string;
	moderationStatus: string;
	offeringId: string | null;
	rating: number | null;
	reviewId: string;
	stallName: string;
	submittedAt: string;
	visibility: string;
}

export interface DiningOpsSourceRun {
	acceptedCount: number;
	blockedCount: number;
	completedAt: string | null;
	runId: string;
	sourceType: string;
	staleCount: number;
	startedAt: string;
	status: string;
	totalCount: number;
}

export interface DiningOpsObservation {
	observationId: string;
	observedAt: string;
	payloadJson: Record<string, unknown>;
	sourceType: string;
	staleAt: string | null;
	status: string;
	targetId: string | null;
	targetKind: string;
}

export type DiningCatalogCommand =
	| { kind: "rename_stall"; stallProfileId: string; displayName: string }
	| { kind: "set_offering_price"; offeringId: string; priceLabel: string | null }
	| {
			kind: "assign_stall";
			windowId: string;
			stallProfileId: string;
			displayName: string;
			tags: string[];
	  }
	| { kind: "remove_assignment"; assignmentId: string };

export type DiningReviewCommand =
	| { kind: "hide"; reason: string }
	| { kind: "restore"; reason: string }
	| { kind: "rebind"; offeringId: string; reason: string }
	| { kind: "recheck" };
