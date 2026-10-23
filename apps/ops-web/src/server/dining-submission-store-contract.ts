import type {
	DiningOpsSubmissionDetail,
	DiningOpsSubmissionPage,
	DiningOpsSubmissionRecord,
} from "@campus-agent/dining/domain";
import type { DiningOpsActor } from "./dining-store-contract.ts";

export type DiningOpsSubmissionPhotoResult =
	| { etag: string; notModified: true }
	| { bytes: Uint8Array; etag: string; notModified: false };

export interface DiningSubmissionStore {
	listSubmissions(input: {
		cursor?: string;
		limit: number;
		windowId?: string;
		status?: "public" | "hidden" | "deleted" | "expired" | "purged";
		reportStatus?: "pending" | "resolved";
	}): Promise<DiningOpsSubmissionPage>;
	getSubmission(submissionId: string): Promise<DiningOpsSubmissionDetail>;
	getPhoto(
		submissionId: string,
		photoId: string,
		ifNoneMatch: string | null,
	): Promise<DiningOpsSubmissionPhotoResult>;
	setVisibility(
		actor: DiningOpsActor,
		submissionId: string,
		expectedRevision: number,
		visible: boolean,
	): Promise<DiningOpsSubmissionRecord>;
	deleteSubmission(
		actor: DiningOpsActor,
		submissionId: string,
		expectedRevision: number,
	): Promise<DiningOpsSubmissionRecord>;
	restoreSubmission(
		actor: DiningOpsActor,
		submissionId: string,
		expectedRevision: number,
	): Promise<DiningOpsSubmissionRecord>;
	resolveReports(
		actor: DiningOpsActor,
		submissionId: string,
		expectedRevision: number,
		resolution: "keep" | "hide",
	): Promise<void>;
}
