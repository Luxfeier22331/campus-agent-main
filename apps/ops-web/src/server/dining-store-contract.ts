import type {
	DiningMapDraft,
	DiningMenuItemRecord,
	DiningOpsReportPage,
	DiningOpsReviewDetail,
	DiningOpsReviewPage,
	DiningOpsReviewRecord,
} from "@campus-agent/dining/domain";
import type { DiningFloorplanBundleV1 } from "@campus-agent/dining/floorplans";
import type {
	DiningOpsState,
	DiningReleaseList,
	DiningReleaseSummary,
} from "../shared/dining-contract.ts";
import type { DiningFloorplanAssetStoreEnv } from "./dining-floorplan-assets.ts";

export interface DiningOpsActor {
	displayName: string;
	principalId: string;
}

export type DiningStoreEnv = DiningFloorplanAssetStoreEnv;

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
	): Promise<DiningOpsReviewRecord>;
	deleteOperatorReview(actor: DiningOpsActor, reviewId: string): Promise<void>;
	getReview(reviewId: string): Promise<DiningOpsReviewDetail>;
	listReports(input: {
		cursor?: string;
		limit: number;
		status: "pending" | "resolved";
	}): Promise<DiningOpsReportPage>;
	listReviews(input: {
		cursor?: string;
		limit: number;
		menuItemId?: string;
		q?: string;
		visibility?: "visible" | "hidden" | "deleted";
		windowId?: string;
	}): Promise<DiningOpsReviewPage>;
	resolveReports(
		actor: DiningOpsActor,
		reviewId: string,
		resolution: "keep" | "hide",
	): Promise<void>;
	setReviewVisibility(
		actor: DiningOpsActor,
		reviewId: string,
		visible: boolean,
	): Promise<DiningOpsReviewRecord>;
	updateReview(
		actor: DiningOpsActor,
		reviewId: string,
		body: string,
	): Promise<DiningOpsReviewRecord>;
}

export interface DiningStores {
	map: DiningMapStore;
	menu: DiningMenuStore;
	reviews: DiningReviewStore;
}
