import {
	materializeDiningCatalog,
	type DiningDraft,
} from "@campus-agent/dining/domain";

import type {
	DiningCatalogBuildInput,
	DiningCatalogSourceRecords,
	DiningSourceObservation,
	FeishuCampusRecord,
	FeishuDishRecord,
	FeishuHallRecord,
	FeishuStallRecord,
} from "./catalog-source-types";

const FEISHU_CATALOG_ACTOR = "system:feishu-dining-catalog-sync";

export function buildCatalogObservations(
	records: DiningCatalogSourceRecords,
	now = new Date("2026-06-30T00:00:00.000Z"),
): DiningSourceObservation[] {
	const observedAt = now.toISOString();
	const observations: DiningSourceObservation[] = [];
	const campusBySourceId = new Map(records.campuses.map((record) => [record.sourceRecordId, record]));
	const hallBySourceId = new Map(records.halls.map((record) => [record.sourceRecordId, record]));
	const stallBySourceId = new Map(records.stalls.map((record) => [record.sourceRecordId, record]));
	const acceptedHallTargetBySourceId = new Map<string, string>();
	const acceptedStallTargetBySourceId = new Map<string, string>();

	for (const campus of records.campuses) {
		observations.push({
			observationId: observationId("campus", campus.sourceRecordId),
			observedAt,
			payloadJson: {
				campusName: normalizeCampusName(campus.campusName),
				order: campus.order,
				sourceRecordId: campus.sourceRecordId,
			},
			sourceType: "feishu_catalog",
			status: campus.campusName.trim() ? "accepted" : "blocked",
			targetId: stableCampusId(campus),
			targetKind: "campus",
		});
	}

	for (const hall of records.halls) {
		const campus = requireSingleLinkedRecord(hall.campusSourceRecordIds, campusBySourceId);
		const targetId = campus ? stableHallId(campus, hall) : null;
		const blockReason = hallBlockReason(hall, campus);
		const status = blockReason === null ? "accepted" : "blocked";
		if (status === "accepted" && targetId) {
			acceptedHallTargetBySourceId.set(hall.sourceRecordId, targetId);
		}
		observations.push({
			observationId: observationId("hall", hall.sourceRecordId),
			observedAt,
			payloadJson: {
				blockReason,
				campusSourceRecordId: hall.campusSourceRecordIds[0] ?? null,
				hallName: hall.hallName.trim(),
				order: hall.order,
				sourceRecordId: hall.sourceRecordId,
			},
			sourceType: "feishu_catalog",
			status,
			targetId: status === "accepted" ? targetId : null,
			targetKind: "hall",
		});
	}

	const stallStatusBySourceId = computeStallPublishability(
		records.stalls,
		hallBySourceId,
		acceptedHallTargetBySourceId,
	);
	for (const stall of records.stalls) {
		const publishability = requireStallPublishability(stallStatusBySourceId, stall.sourceRecordId);
		if (publishability.status === "accepted") {
			acceptedStallTargetBySourceId.set(stall.sourceRecordId, stableStallId(stall));
		}
		observations.push({
			observationId: observationId("stall", stall.sourceRecordId),
			observedAt,
			payloadJson: {
				blockReason: publishability.blockReason,
				hallSourceRecordIds: stall.hallSourceRecordIds,
				order: stall.order,
				sourceRecordId: stall.sourceRecordId,
				stallName: stall.stallName.trim(),
				tags: uniqueStrings(stall.tags),
			},
			sourceType: "feishu_catalog",
			status: publishability.status,
			targetId: publishability.status === "accepted" ? stableStallId(stall) : null,
			targetKind: "stall",
		});
	}

	for (const dish of records.dishes) {
		const hasPublishableStall = dish.stallSourceRecordIds.some((stallSourceRecordId) =>
			acceptedStallTargetBySourceId.has(stallSourceRecordId),
		);
		const menuItemBlockReason = dishBlockReason(dish, hasPublishableStall);
		const dishStatus = menuItemBlockReason === null ? "accepted" : "blocked";
		observations.push({
			observationId: observationId("menu_item", dish.sourceRecordId),
			observedAt,
			payloadJson: {
				blockReason: menuItemBlockReason,
				dishName: dish.dishName.trim(),
				sourceRecordId: dish.sourceRecordId,
				tags: uniqueStrings(dish.tags),
			},
			sourceType: "feishu_catalog",
			status: dishStatus,
			targetId: dishStatus === "accepted" ? stableMenuItemId(dish) : null,
			targetKind: "menu_item",
		});
		for (const stallSourceRecordId of dish.stallSourceRecordIds) {
			const stall = stallBySourceId.get(stallSourceRecordId);
			const stallIsPublishable = acceptedStallTargetBySourceId.has(stallSourceRecordId);
			const offeringBlockReason = menuOfferingBlockReason(dish, stall, stallIsPublishable);
			const status = offeringBlockReason === null ? "accepted" : "blocked";
			observations.push({
				observationId: `feishu:menu_offering:${dish.sourceRecordId}:${stallSourceRecordId}`,
				observedAt,
				payloadJson: {
					blockReason: offeringBlockReason,
					dishName: dish.dishName.trim(),
					priceLabel: normalizePriceLabel(dish.priceLabel),
					sourceRecordId: dish.sourceRecordId,
					stallSourceRecordId,
					tags: uniqueStrings(dish.tags),
				},
				sourceType: "feishu_catalog",
				status,
				targetId: status === "accepted" && stall
					? `offering:${stableStallId(stall)}:${stableMenuItemId(dish)}`
					: null,
				targetKind: "menu_offering",
			});
		}
	}

	return observations;
}

interface StallPublishability {
	blockReason: string | null;
	status: DiningSourceObservation["status"];
}

function hallBlockReason(
	hall: FeishuHallRecord,
	campus: FeishuCampusRecord | null,
): string | null {
	if (!hall.hallName.trim()) {
		return "hall_name_missing";
	}
	if (!campus) {
		return "campus_not_found";
	}
	return null;
}

function computeStallPublishability(
	stalls: FeishuStallRecord[],
	hallBySourceId: Map<string, FeishuHallRecord>,
	acceptedHallTargetBySourceId: Map<string, string>,
): Map<string, StallPublishability> {
	const results = new Map<string, StallPublishability>();
	for (const stall of stalls) {
		const hallSourceRecordId = stall.hallSourceRecordIds[0] ?? null;
		const hall = hallSourceRecordId ? hallBySourceId.get(hallSourceRecordId) : null;
		const hallTargetId = hallSourceRecordId
			? acceptedHallTargetBySourceId.get(hallSourceRecordId)
			: null;
		if (!stall.stallName.trim()) {
			results.set(stall.sourceRecordId, {
				blockReason: "stall_name_missing",
				status: "blocked",
			});
			continue;
		}
		if (!hall) {
			results.set(stall.sourceRecordId, {
				blockReason: "hall_not_found",
				status: "blocked",
			});
			continue;
		}
		if (!hallTargetId) {
			results.set(stall.sourceRecordId, {
				blockReason: "hall_not_publishable",
				status: "blocked",
			});
			continue;
		}
		results.set(stall.sourceRecordId, {
			blockReason: null,
			status: "accepted",
		});
	}
	return results;
}

function requireStallPublishability(
	results: Map<string, StallPublishability>,
	sourceRecordId: string,
): StallPublishability {
	const result = results.get(sourceRecordId);
	if (!result) {
		throw new Error(`Missing stall publishability for ${sourceRecordId}.`);
	}
	return result;
}

function dishBlockReason(dish: FeishuDishRecord, hasPublishableStall: boolean): string | null {
	if (!dish.dishName.trim()) {
		return "dish_name_missing";
	}
	return hasPublishableStall ? null : "stall_not_publishable";
}

function menuOfferingBlockReason(
	dish: FeishuDishRecord,
	stall: FeishuStallRecord | undefined,
	stallIsPublishable: boolean,
): string | null {
	if (!dish.dishName.trim()) {
		return "dish_name_missing";
	}
	if (!stall) {
		return "stall_not_found";
	}
	return stallIsPublishable ? null : "stall_not_publishable";
}

export function buildDiningDraftFromCatalogObservations(input: DiningCatalogBuildInput): DiningDraft {
	return materializeDiningCatalog({
		actorId: FEISHU_CATALOG_ACTOR,
		baseReleaseId: null,
		currentRevision: 1,
		now: input.source.updatedAt,
		observations: input.observations,
	});
}

function observationId(kind: string, sourceRecordId: string): string {
	return `feishu:${kind}:${sourceRecordId}`;
}

function requireSingleLinkedRecord<T>(
	sourceRecordIds: string[],
	records: Map<string, T>,
): T | null {
	const sourceRecordId = sourceRecordIds[0];
	return sourceRecordId ? (records.get(sourceRecordId) ?? null) : null;
}

export function normalizeCampusName(value: string): string {
	const trimmed = value.trim();
	return trimmed.endsWith("校区") ? trimmed : `${trimmed}校区`;
}

export function canonicalHallName(value: string): string {
	const trimmed = value.trim();
	const map = new Map([
		["第一食堂", "海淀一食堂"],
		["第二食堂", "海淀二食堂"],
		["第三食堂", "海淀三食堂"],
		["第四食堂", "海淀四食堂"],
		["第五食堂", "海淀五食堂"],
		["聚雅一层", "聚雅食堂"],
		["聚雅二层", "聚雅食堂"],
		["荟贤一层", "荟贤食堂"],
		["荟贤二层", "荟贤食堂"],
		["博雅商铺区", "丰台露天餐饮区"],
	]);
	return map.get(trimmed) ?? trimmed;
}

function stableCampusId(campus: FeishuCampusRecord): string {
	return stableId("campus", campus.sourceRecordId);
}

function stableHallId(campus: FeishuCampusRecord, hall: FeishuHallRecord): string {
	const name = canonicalHallName(hall.hallName);
	if (name === "海淀一食堂") return "haidian-canteen-1";
	if (name === "海淀二食堂") return "haidian-canteen-2";
	if (name === "海淀三食堂") return "haidian-canteen-3";
	if (name === "海淀四食堂") return "haidian-canteen-4";
	if (name === "海淀五食堂") return "haidian-canteen-5";
	if (name === "荟贤食堂") return "fengtai-huixian-canteen";
	if (name === "聚雅食堂") return "fengtai-juya-canteen";
	if (name === "丰台露天餐饮区") return "fengtai-outdoor-dining-zone";
	return stableId("hall", `${campus.sourceRecordId}:${hall.sourceRecordId}`);
}

function stableStallId(stall: FeishuStallRecord): string {
	return stableId("stall", stall.sourceRecordId);
}

function stableMenuItemId(dish: FeishuDishRecord): string {
	return stableId("menu", dish.sourceRecordId);
}

function stableId(prefix: string, value: string): string {
	return `${prefix}:${value.trim()}`;
}

function normalizePriceLabel(value: unknown): string | null {
	if (value === null || value === undefined) {
		return null;
	}
	const label = String(value).trim();
	return label ? label : null;
}

function uniqueStrings(values: string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((left, right) =>
		left.localeCompare(right, "zh-CN"),
	);
}
