import type {
	DiningMapDraft,
	DiningMenuItemRecord,
	DiningOpsContentReportPage,
	DiningOpsContentReviewDetail,
	DiningOpsContentReviewPage,
	DiningOpsContentReviewRecord,
} from "@campus-agent/dining/domain";
import type { DiningFloorplanBundleV1 } from "@campus-agent/dining/floorplans";
import type {
	DiningOpsState,
	DiningReleaseList,
	DiningReleaseSummary,
} from "../shared/dining-contract.ts";
import type { DiningFloorplanAssetStoreEnv } from "./dining-floorplan-assets.ts";
import type { DiningSubmissionAssetEnv } from "./dining-submission-assets.ts";
import type { DiningSubmissionStore } from "./dining-submission-store-contract.ts";

export interface DiningOpsActor {
	displayName: string;
	principalId: string;
}

export type DiningStoreEnv = DiningFloorplanAssetStoreEnv & DiningSubmissionAssetEnv;

export interface DiningMapStore {
	getState(): Promise<DiningOpsState>;
	listReleases(): Promise<DiningReleaseList>;
	publish(actor: DiningOpsActor, expectedRevision: number): Promise<DiningReleaseSummary>;
	restore(
		actor: DiningOpsActor,
		releaseId: string,
		expectedRevision: number,
	): Promise<{ draft: DiningMapDraft; release: DiningReleaseSummary }>;
	saveDraft(
		actor: DiningOpsActor,
		bundle: DiningFloorplanBundleV1,
		expectedRevision: number,
	): Promise<DiningMapDraft>;
	verifyReadiness(): Promise<void>;
}

export interface DiningMenuStore {
	archiveMenuItem(actor: DiningOpsActor, menuItemId: string): Promise<DiningMenuItemRecord>;
	createMenuItem(
		actor: DiningOpsActor,
		input: { name: string; priceText: string | null; windowId: string },
	): Promise<DiningMenuItemRecord>;
	listMenuItems(): Promise<DiningMenuItemRecord[]>;
	moveMenuItem(
		actor: DiningOpsActor,
		menuItemId: string,
		windowId: string,
	): Promise<DiningMenuItemRecord>;
	reorderMenuItems(
		actor: DiningOpsActor,
		windowId: string,
		menuItemIds: string[],
	): Promise<DiningMenuItemRecord[]>;
	restoreMenuItem(actor: DiningOpsActor, menuItemId: string): Promise<DiningMenuItemRecord>;
	updateMenuItem(
		actor: DiningOpsActor,
		menuItemId: string,
		input: { name?: string; priceText?: string | null },
	): Promise<DiningMenuItemRecord>;
	verifyReadiness(): Promise<void>;
}

export interface DiningReviewStore {
	createReview(
		actor: DiningOpsActor,
		input: { anonymous: boolean; body: string; idempotencyKey: string; menuItemId: string },
	): Promise<DiningOpsContentReviewRecord>;
	deleteOperatorReview(actor: DiningOpsActor, reviewId: string): Promise<void>;
	getReview(reviewId: string): Promise<DiningOpsContentReviewDetail>;
	listReports(input: {
		cursor?: string;
		limit: number;
		status: "pending" | "resolved";
		menuItemId?: string;
		submissionId?: string;
		targetType?: "review" | "submission";
	}): Promise<DiningOpsContentReportPage>;
	listReviews(input: {
		cursor?: string;
		limit: number;
		menuItemId?: string;
		submissionId?: string;
		targetType?: "menu_item" | "submission";
		q?: string;
		visibility?: "visible" | "hidden" | "deleted";
		windowId?: string;
	}): Promise<DiningOpsContentReviewPage>;
	resolveReports(
		actor: DiningOpsActor,
		reviewId: string,
		resolution: "keep" | "hide",
	): Promise<void>;
	setReviewVisibility(
		actor: DiningOpsActor,
		reviewId: string,
		visible: boolean,
	): Promise<DiningOpsContentReviewRecord>;
	updateReview(
		actor: DiningOpsActor,
		reviewId: string,
		body: string,
	): Promise<DiningOpsContentReviewRecord>;
}

export interface DiningStores {
	submissions: DiningSubmissionStore;
	map: DiningMapStore;
	menu: DiningMenuStore;
	reviews: DiningReviewStore;
}
