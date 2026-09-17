import type {
	DiningMySubmissionPage,
	DiningMySubmissionResponse,
	DiningSubmissionCreate,
	DiningSubmissionPage,
	DiningSubmissionResponse,
	DiningSubmissionUpdate,
} from "@campus-agent/dining/domain";

export interface DiningSubmissionActor {
	displayName: string;
	principalId: string;
}

export interface DiningSubmissionService {
	create(input: {
		actor: DiningSubmissionActor;
		windowId: string;
		idempotencyKey: string;
		metadata: DiningSubmissionCreate;
		photo: Uint8Array | null;
	}): Promise<DiningMySubmissionResponse>;
	update(input: {
		actor: DiningSubmissionActor;
		submissionId: string;
		expectedRevision: number;
		metadata: DiningSubmissionUpdate;
		photo: Uint8Array | null;
	}): Promise<DiningMySubmissionResponse>;
	deleteOwn(input: {
		userId: string;
		submissionId: string;
		expectedRevision: number;
	}): Promise<void>;
	listPublic(input: {
		windowId: string;
		viewerUserId: string | null;
		cursor?: string;
		limit: number;
	}): Promise<DiningSubmissionPage>;
	getPublic(input: {
		submissionId: string;
		viewerUserId: string | null;
	}): Promise<DiningSubmissionResponse>;
	listOwn(input: {
		userId: string;
		cursor?: string;
		limit: number;
	}): Promise<DiningMySubmissionPage>;
	getOwn(input: { userId: string; submissionId: string }): Promise<DiningMySubmissionResponse>;
	getPhoto(input: {
		submissionId: string;
		photoId: string;
		ownerUserId: string | null;
		ifNoneMatch: string | null;
	}): Promise<DiningSubmissionPhotoResult>;
}

// Photo bytes are immutable per photoId: the object key is written once and the
// row is removed at cleanup, so a matching validator proves content identity.
export type DiningSubmissionPhotoResult =
	| { etag: string; notModified: true }
	| { bytes: Uint8Array; etag: string; notModified: false };
