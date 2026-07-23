export interface LarkAttachmentRef {
	fileToken: string;
	name: string;
	size: number;
}

export interface DiningSourceRecord {
	attachments: LarkAttachmentRef[];
	campus: string;
	comment: string | null;
	contributorName: string | null;
	dishName: string;
	hallName: string;
	paidPriceLabel: string | null;
	rating: number | null;
	sourceBlockReason?: string;
	sourceRecordId: string;
	stallName: string;
	submittedAt: string | null;
}

export interface DiningReviewSourceSnapshot {
	complete: true;
	records: DiningSourceRecord[];
}

export interface DiningReviewImage {
	alt: string;
	imageId: string;
	url: string;
}

export interface DiningReviewProjection {
	campus: string;
	comment: string | null;
	contributorName: string | null;
	dishName: string;
	hallId: string;
	hallName: string;
	images: DiningReviewImage[];
	offeringId: string;
	paidPriceLabel: string | null;
	rating: number | null;
	reviewId: string;
	sourceRecordId: string;
	stallName: string;
	stallProfileId: string;
	submittedAt: string;
	windowId: string;
}

export interface ModerationResult {
	status: "blocked" | "safe" | "uncertain";
}

export interface SyncReport {
	attachmentCount: number;
	blockedCount: number;
	blockedReasons: Record<string, number>;
	observationSync: {
		acceptedCount: number;
		blockedCount: number;
		runId: string;
		staleCount: number;
		totalCount: number;
	};
	publishedCount: number;
	readCount: number;
	reusedCount: number;
	reviews: DiningReviewProjection[];
	status: "no_publishable_records" | "published";
}
