import { listDiningFloorScaffold, listDiningHallScaffold } from "@campus-agent/dining/domain";
import { getDiningFloorplanByFloor } from "@campus-agent/dining/floorplans";
import type { Route } from "@playwright/test";
import { DINING_FLAVOR_STALL_FIXTURES } from "../../test/fixtures/dining-flavor-stalls";

const now = "2026-06-30T08:00:00.000Z";

export async function fulfillDiningFloor(route: Route) {
	const segments = new URL(route.request().url()).pathname.split("/");
	const hallId = decodeURIComponent(segments.at(-3) ?? "haidian-canteen-1");
	const floorId = decodeURIComponent(segments.at(-1) ?? "haidian-canteen-1-1f");
	await route.fulfill({
		contentType: "application/json",
		json: createDiningFloorPayload({ floorId, hallId }),
		status: 200,
	});
}

export function createDiningFloorPayload(input: { floorId: string; hallId: string }) {
	const { floorId, hallId } = input;
	const floorplan = resolveMockDiningFloorplan(input);
	const anchorInventory =
		floorplan.kind === "placeholder"
			? [
					{ anchorId: floorplan.primaryAnchorId, label: "一号窗口", role: "window" },
					{ anchorId: floorplan.secondaryAnchorId, label: "二号窗口", role: "window" },
				]
			: getDiningFloorplanByFloor({ floorId, hallId }).anchorInventory;
	const windows = [
		diningWindow({
			anchorId: floorplan.primaryAnchorId,
			label: "一号窗口",
			locationLabel: `${floorplan.label} · 1 号窗口`,
			name: floorplan.primaryStallName,
			offerings: [
				floorplan.primaryOffering,
				{ name: "时蔬拼盘", priceLabel: "9 元", tags: ["热餐"] },
				{ name: "番茄牛腩饭", priceLabel: "18 元", tags: ["主食", "热餐"] },
			],
			windowId: `${hallId}_${floorId}_window_01`,
		}),
		diningWindow({
			anchorId: floorplan.secondaryAnchorId,
			label: "二号窗口",
			locationLabel: `${floorplan.label} · 2 号窗口`,
			name: "麻辣烫",
			offerings: [
				{ name: "经典麻辣烫", priceLabel: "15 元", tags: ["热餐"] },
				{ name: "番茄麻辣烫", priceLabel: "16 元", tags: ["热餐"] },
				{ name: "清汤麻辣烫", priceLabel: "15 元", tags: ["清淡", "热餐"] },
			],
			windowId: `${hallId}_${floorId}_window_02`,
		}),
	];
	for (const [index, anchor] of anchorInventory.slice(2).entries()) {
		const stall = DINING_FLAVOR_STALL_FIXTURES[index];
		if (!stall) {
			throw new Error(`Dining mock stall name is missing for anchor ${anchor.anchorId}.`);
		}
		windows.push(
			diningWindow({
				anchorId: anchor.anchorId,
				label: anchor.label ?? `${index + 3}号窗口`,
				locationLabel: `${floorplan.label} · ${stall.displayName}`,
				name: stall.displayName,
				offerings: stall.offerings.map((offering) => ({
					...offering,
					tags: ["主食", "热餐"],
				})),
				windowId: `${hallId}_${floorId}_${anchor.anchorId}`,
			}),
		);
	}
	return {
		filters: { tags: ["热餐", "粉面"] },
		floor: {
			floorId,
			floorplan: { floorplanId: floorplan.floorplanId, kind: floorplan.kind },
			hallId,
			label: floorplan.label,
		},
		source: { updatedAt: now },
		windows,
	};
}

export async function fulfillDiningOfferingReviews(route: Route) {
	const segments = new URL(route.request().url()).pathname.split("/");
	const offeringId = decodeURIComponent(segments.at(-2) ?? "");
	await route.fulfill({
		contentType: "application/json",
		json: createDiningOfferingReviewsPayload(offeringId),
		status: 200,
	});
}

export function createDiningOfferingReviewsPayload(offeringId: string) {
	const result = listDiningSearchEntries().find(
		(entry) => entry.offering?.offeringId === offeringId,
	);
	const keepsEmptyReviewState = offeringId.endsWith("_window_01_1");
	const imageAlt = `${result?.offering?.name ?? "菜品"}评价图片`;
	return {
		offeringId,
		reviews:
			result && !keepsEmptyReviewState
				? [
						{
							comment: offeringId.endsWith("_window_01_0")
								? "汤底稳定，午餐时段排队较短。"
								: "味道稳定，分量适合一顿午饭。",
							contributorName: "林川",
							images: offeringId.endsWith("_window_01_0")
								? [
										{
											alt: imageAlt,
											imageId: "dining-review-image:source_review_fish:1",
											url: "/assets/dining/reviews/source_review_fish-1.jpg",
										},
									]
								: [],
							paidPriceLabel: result.offering?.priceLabel ?? null,
							rating: 4,
							reviewId: `review:${offeringId}:1`,
							submittedAt: "2026-07-11T08:00:00.000Z",
						},
						{
							comment: "高峰期稍微等了一会儿，拿到时还是热的。",
							contributorName: "周宁",
							images: [],
							paidPriceLabel: result.offering?.priceLabel ?? null,
							rating: 5,
							reviewId: `review:${offeringId}:2`,
							submittedAt: "2026-07-10T08:00:00.000Z",
						},
					]
				: [],
	};
}

export async function fulfillDiningSearch(route: Route) {
	const url = new URL(route.request().url());
	await route.fulfill({
		contentType: "application/json",
		json: createDiningSearchPayload({
			query: url.searchParams.get("q") ?? "",
			scopeHallId: url.searchParams.get("scopeHallId") ?? "",
			tag: url.searchParams.get("tag"),
		}),
		status: 200,
	});
}

export function createDiningSearchPayload(input: {
	query: string;
	scopeHallId: string;
	tag: string | null;
}) {
	const scope = DINING_SEARCH_SCOPES.find((entry) => entry.hallId === input.scopeHallId);
	const campus = scope?.campus ?? "海淀校区";
	const query = input.query.trim().toLocaleLowerCase("zh-CN");
	const results = listDiningSearchEntries()
		.filter((entry) => entry.campus === campus)
		.filter(
			(entry) =>
				!query ||
				entry.stallName.toLocaleLowerCase("zh-CN").includes(query) ||
				entry.offering?.name.toLocaleLowerCase("zh-CN").includes(query),
		)
		.filter((entry) => !input.tag || entry.tags.includes(input.tag))
		.sort((left, right) => {
			const leftCurrentHall = left.hallId === input.scopeHallId ? 0 : 1;
			const rightCurrentHall = right.hallId === input.scopeHallId ? 0 : 1;
			return leftCurrentHall - rightCurrentHall || left.resultId.localeCompare(right.resultId);
		})
		.slice(0, 20)
		.map(({ tags: _tags, ...result }) => result);
	return {
		results,
		scope: { campus, hallId: input.scopeHallId },
		source: { updatedAt: now },
		total: results.length,
	};
}

function diningWindow(input: {
	anchorId: string;
	label: string;
	locationLabel: string;
	name: string;
	offerings: Array<{ name: string; priceLabel: string; tags: string[] }>;
	windowId: string;
}) {
	const tags = [...new Set(input.offerings.flatMap((offering) => offering.tags))];
	return {
		assignment: {
			assignmentId: `assignment_${input.windowId}`,
			offerings: input.offerings.map((offering, index) => ({
				menuItemId: `menu_${input.windowId}_${index}`,
				name: offering.name,
				offeringId: `offering_${input.windowId}_${index}`,
				priceLabel: offering.priceLabel,
				tags: offering.tags,
			})),
			stallProfile: {
				displayName: input.name,
				stallProfileId: `stall_${input.windowId}`,
				stallType: "hot_meal",
				tags,
			},
		},
		label: input.label,
		locationLabel: input.locationLabel,
		status: "active",
		svgAnchorId: input.anchorId,
		tags,
		windowId: input.windowId,
	};
}

const DINING_SEARCH_SCOPES = listDiningHallScaffold().flatMap((hall) =>
	listDiningFloorScaffold({ hallId: hall.hallId }).map((floor) => ({
		campus: hall.campus,
		floorId: floor.floorId,
		floorLabel: floor.label,
		hallId: hall.hallId,
		hallName: hall.name,
	})),
);

function listDiningSearchEntries() {
	return DINING_SEARCH_SCOPES.flatMap((scope) => {
		const floor = createDiningFloorPayload({ floorId: scope.floorId, hallId: scope.hallId });
		return floor.windows.flatMap((diningWindow) => {
			if (!diningWindow.assignment) {
				return [];
			}
			return diningWindow.assignment.offerings.map((offering) => ({
				campus: scope.campus,
				floorId: scope.floorId,
				floorLabel: scope.floorLabel,
				hallId: scope.hallId,
				hallName: scope.hallName,
				kind: "offering" as const,
				offering: {
					offeringId: offering.offeringId,
					name: offering.name,
					priceLabel: offering.priceLabel,
				},
				resultId: offering.offeringId,
				stallName: diningWindow.assignment.stallProfile.displayName,
				stallProfileId: diningWindow.assignment.stallProfile.stallProfileId,
				tags: [...new Set([...diningWindow.assignment.stallProfile.tags, ...offering.tags])],
				windowId: diningWindow.windowId,
				windowLabel: diningWindow.label,
			}));
		});
	});
}

function resolveMockDiningFloorplan(input: { floorId: string; hallId: string }) {
	if (input.hallId === "fengtai-pending-canteen") {
		return {
			floorplanId: "placeholder:fengtai-pending-canteen:fengtai-pending-canteen",
			kind: "placeholder" as const,
			label: "待补充食堂",
			primaryAnchorId: "pending-window-01",
			primaryOffering: { name: "青菜豆腐", priceLabel: "10 元", tags: ["清淡", "热餐"] },
			primaryStallName: "清淡窗口",
			secondaryAnchorId: "pending-window-02",
		};
	}
	const manifest = getDiningFloorplanByFloor(input);
	if (input.hallId === "haidian-canteen-2") {
		return {
			floorplanId: manifest.floorplanId,
			kind: "asset" as const,
			label: "海淀二食堂",
			primaryAnchorId: "window-01",
			primaryOffering: { name: "二食堂清炒时蔬", priceLabel: "12 元", tags: ["热餐"] },
			primaryStallName: "二食堂窗口",
			secondaryAnchorId: "window-02",
		};
	}
	if (input.hallId === "haidian-canteen-4") {
		return {
			floorplanId: manifest.floorplanId,
			kind: "asset" as const,
			label: "海淀四食堂",
			primaryAnchorId: "window-01",
			primaryOffering: { name: "四食堂番茄鸡蛋饭", priceLabel: "14 元", tags: ["热餐"] },
			primaryStallName: "四食堂窗口",
			secondaryAnchorId: "window-02",
		};
	}
	if (input.hallId === "haidian-canteen-3") {
		return {
			floorplanId: manifest.floorplanId,
			kind: "asset" as const,
			label: "海淀三食堂",
			primaryAnchorId: "window-01",
			primaryOffering: { name: "三食堂番茄鸡蛋饭", priceLabel: "14 元", tags: ["热餐"] },
			primaryStallName: "三食堂窗口",
			secondaryAnchorId: "window-02",
		};
	}
	if (input.hallId === "haidian-canteen-5") {
		return {
			floorplanId: manifest.floorplanId,
			kind: "asset" as const,
			label: "海淀五食堂",
			primaryAnchorId: "window-01",
			primaryOffering: { name: "五食堂时蔬套餐", priceLabel: "13 元", tags: ["热餐"] },
			primaryStallName: "五食堂窗口",
			secondaryAnchorId: "window-02",
		};
	}
	if (input.hallId === "fengtai-juya-canteen") {
		return {
			floorplanId: manifest.floorplanId,
			kind: "asset" as const,
			label: `聚雅食堂${input.floorId.endsWith("-2f") ? "二层" : "一层"}`,
			primaryAnchorId: "window-01",
			primaryOffering: { name: "广式风味套餐", priceLabel: "16 元", tags: ["热餐"] },
			primaryStallName: "广式风味窗口",
			secondaryAnchorId: "window-02",
		};
	}
	if (input.hallId === "fengtai-outdoor-dining-zone") {
		return {
			floorplanId: manifest.floorplanId,
			kind: "asset" as const,
			label: "丰台露天餐饮区",
			primaryAnchorId: "window-01",
			primaryOffering: { name: "露天餐饮套餐", priceLabel: "15 元", tags: ["热餐"] },
			primaryStallName: "露天餐饮窗口",
			secondaryAnchorId: "window-02",
		};
	}
	if (
		input.hallId === "fengtai-huixian-canteen" &&
		input.floorId === "fengtai-huixian-canteen-2f"
	) {
		return {
			floorplanId: manifest.floorplanId,
			kind: "asset" as const,
			label: "荟贤食堂二层",
			primaryAnchorId: "window-01",
			primaryOffering: { name: "螺蛳粉", priceLabel: "16 元", tags: ["热餐"] },
			primaryStallName: "螺蛳粉",
			secondaryAnchorId: "window-02",
		};
	}
	if (input.hallId === "fengtai-huixian-canteen") {
		return {
			floorplanId: manifest.floorplanId,
			kind: "asset" as const,
			label: "荟贤食堂一层",
			primaryAnchorId: "window-01",
			primaryOffering: { name: "螺蛳粉", priceLabel: "16 元", tags: ["热餐"] },
			primaryStallName: "螺蛳粉",
			secondaryAnchorId: "window-02",
		};
	}
	return {
		floorplanId: manifest.floorplanId,
		kind: "asset" as const,
		label: "海淀一食堂",
		primaryAnchorId: "window-01",
		primaryOffering: { name: "金汤鱼粉", priceLabel: "18 元", tags: ["热餐", "粉面"] },
		primaryStallName: "鱼粉",
		secondaryAnchorId: "window-02",
	};
}
