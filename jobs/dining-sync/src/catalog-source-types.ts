import type { DiningOperationsState } from "@campus-agent/dining/domain";

export type DiningSourceObservationStatus = "accepted" | "blocked" | "observed";

export interface DiningSourceObservation {
	observationId: string;
	observedAt: string;
	payloadJson: Record<string, unknown>;
	sourceType: "feishu_catalog" | "feishu_review";
	status: DiningSourceObservationStatus;
	targetId: string | null;
	targetKind: "campus" | "hall" | "menu_item" | "menu_offering" | "review" | "stall";
}

export interface FeishuCatalogSourceIdentity {
	baseToken: string;
	campusTableId: string;
	dishTableId: string;
	hallTableId: string;
	stallTableId: string;
}

export interface FeishuReviewSourceIdentity {
	baseToken: string;
	reviewTableId: string;
}

export interface FeishuCampusRecord {
	campusName: string;
	order: number | null;
	sourceRecordId: string;
}

export interface FeishuHallRecord {
	campusSourceRecordIds: string[];
	hallName: string;
	order: number | null;
	sourceRecordId: string;
}

export interface FeishuStallRecord {
	hallSourceRecordIds: string[];
	order: number | null;
	sourceRecordId: string;
	stallName: string;
	tags: string[];
}

export interface FeishuDishRecord {
	dishName: string;
	priceLabel: string | null;
	sourceRecordId: string;
	stallSourceRecordIds: string[];
	tags: string[];
}

export interface DiningCatalogSourceRecords {
	campuses: FeishuCampusRecord[];
	dishes: FeishuDishRecord[];
	halls: FeishuHallRecord[];
	stalls: FeishuStallRecord[];
}

export interface DiningCatalogBuildInput {
	observations: DiningSourceObservation[];
	source: {
		label: string;
		updatedAt: string;
	};
}

export interface DiningCatalogPublisher {
	publishCatalog(state: DiningOperationsState): Promise<void>;
}
