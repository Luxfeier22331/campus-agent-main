export type { DiningSourceObservation } from "@campus-agent/dining/domain";

import type { DiningSourceObservation } from "@campus-agent/dining/domain";

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
	blockReason?: string;
	campusName: string;
	order: number | null;
	sourceRecordId: string;
}

export interface FeishuHallRecord {
	blockReason?: string;
	campusSourceRecordIds: string[];
	hallName: string;
	order: number | null;
	sourceRecordId: string;
}

export interface FeishuStallRecord {
	blockReason?: string;
	hallSourceRecordIds: string[];
	order: number | null;
	sourceRecordId: string;
	stallName: string;
	tags: string[];
}

export interface FeishuDishRecord {
	blockReason?: string;
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
