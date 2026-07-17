import { getDiningFloorplanByFloor } from "@campus-agent/dining/floorplans";
import type { DiningFloorTransportResponse } from "../src/features/dining/model";
import { DINING_FLAVOR_STALL_FIXTURES } from "./fixtures/dining-flavor-stalls";

interface DiningApiMock {
	getDiningBootstrap: {
		mockResolvedValue: (value: unknown) => unknown;
	};
	getDiningFloor: {
		mockImplementation: (
			implementation: (input: { floorId: string; hallId: string }) => Promise<unknown>,
		) => unknown;
	};
	getDiningOfferingReviews: {
		mockImplementation: (
			implementation: (input: { offeringId: string }) => Promise<unknown>,
		) => unknown;
	};
	getDiningPublication?: {
		mockResolvedValue: (value: unknown) => unknown;
	};
	searchDining: {
		mockImplementation: (
			implementation: (input: {
				query: string;
				scopeHallId: string;
				tag: string | null;
			}) => Promise<unknown>,
		) => unknown;
	};
}

export function mockDiningFixtureApi(diningApiMock: DiningApiMock) {
	diningApiMock.getDiningPublication?.mockResolvedValue({
		catalogReleaseId: "dining_release:fixture",
		reviewRevision: 1,
		updatedAt: "2026-07-16T00:00:00.000Z",
	});
	const halls = [
		{
			campus: "海淀校区",
			floors: [{ floorId: "haidian-canteen-1-1f", label: "地图" }],
			hallId: "haidian-canteen-1",
			name: "海淀一食堂",
			tags: ["粉面", "热餐"],
		},
		{
			campus: "丰台校区",
			floors: [
				{ floorId: "fengtai-huixian-canteen-1f", label: "一层" },
				{ floorId: "fengtai-huixian-canteen-2f", label: "二层" },
			],
			hallId: "fengtai-huixian-canteen",
			name: "荟贤食堂",
			tags: ["粉面", "热餐"],
		},
	];
	const initialFloor = createDiningFloorPayload({
		floorId: "haidian-canteen-1-1f",
		hallId: "haidian-canteen-1",
		label: "海淀一食堂",
	});
	diningApiMock.getDiningBootstrap.mockResolvedValue({
		halls,
		initial: { floor: initialFloor },
	});
	diningApiMock.getDiningFloor.mockImplementation(
		({ floorId, hallId }: { floorId: string; hallId: string }) => {
			const projections = {
				"fengtai-huixian-canteen:fengtai-huixian-canteen-1f": "荟贤食堂一层",
				"fengtai-huixian-canteen:fengtai-huixian-canteen-2f": "荟贤食堂二层",
				"haidian-canteen-1:haidian-canteen-1-1f": "海淀一食堂",
			} as const;
			const label = projections[`${hallId}:${floorId}` as keyof typeof projections];
			if (!label) {
				return Promise.reject(new Error("missing dining projection"));
			}
			return Promise.resolve(createDiningFloorPayload({ floorId, hallId, label }));
		},
	);
	diningApiMock.getDiningOfferingReviews.mockImplementation(
		({ offeringId }: { offeringId: string }) =>
			Promise.resolve(createDiningReviewPayload(offeringId)),
	);
	diningApiMock.searchDining.mockImplementation(
		({ query, scopeHallId, tag }: { query: string; scopeHallId: string; tag: string | null }) =>
			Promise.resolve(createDiningSearchPayload({ query, scopeHallId, tag })),
	);
	return { halls, initialFloor };
}

function createDiningReviewPayload(offeringId: string) {
	return {
		offeringId,
		reviews:
			offeringId === "offering:rice:1"
				? [
						{
							comment: "有一点辣，有一点酸。",
							contributorName: "果小生",
							images: [
								{
									alt: "金汤鱼粉评价图片",
									imageId: "dining-review-image:rec27DpktN6uQn:1",
									url: "/assets/dining/reviews/rec27DpktN6uQn-1.jpg",
								},
							],
							paidPriceLabel: "12 元",
							rating: 4,
							reviewId: "dining-review:rec27DpktN6uQn",
							submittedAt: "2026-07-11T08:00:00.000Z",
						},
					]
				: [],
	};
}

function createDiningSearchPayload(input: {
	query: string;
	scopeHallId: string;
	tag: string | null;
}) {
	const allResults = [
		{
			campus: "海淀校区",
			floorId: "haidian-canteen-1-1f",
			floorLabel: "地图",
			hallId: "haidian-canteen-1",
			hallName: "海淀一食堂",
			kind: "offering" as const,
			offering: { offeringId: "offering:rice:1", name: "金汤鱼粉", priceLabel: "12 元" },
			resultId: "offering:rice:1",
			stallName: "鱼粉",
			stallProfileId: "stall:rice",
			windowId: "haidian-canteen-1:haidian-canteen-1-1f:window-01",
			windowLabel: "一号窗口",
			tags: ["粉面", "热餐"],
		},
		{
			campus: "海淀校区",
			floorId: "haidian-canteen-1-1f",
			floorLabel: "地图",
			hallId: "haidian-canteen-1",
			hallName: "海淀一食堂",
			kind: "stall" as const,
			offering: null,
			resultId: "stall:noodle",
			stallName: "螺蛳粉",
			stallProfileId: "stall:noodle",
			windowId: "haidian-canteen-1:haidian-canteen-1-1f:window-02",
			windowLabel: "二号窗口",
			tags: ["粉面", "热餐"],
		},
	];
	const campus = input.scopeHallId.startsWith("fengtai-") ? "丰台校区" : "海淀校区";
	const normalizedQuery = input.query.trim().toLocaleLowerCase("zh-CN");
	const results = allResults
		.filter((result) => result.campus === campus)
		.filter(
			(result) =>
				!normalizedQuery ||
				result.stallName.toLocaleLowerCase("zh-CN").includes(normalizedQuery) ||
				result.offering?.name.toLocaleLowerCase("zh-CN").includes(normalizedQuery),
		)
		.filter((result) => !input.tag || result.tags.includes(input.tag))
		.map(({ tags: _tags, ...result }) => result);
	return {
		results,
		scope: { campus, hallId: input.scopeHallId },
		source: { updatedAt: "2026-07-11T00:00:00.000Z" },
		total: results.length,
	};
}

function createDiningFloorPayload(input: {
	floorId: string;
	hallId: string;
	label: string;
}): DiningFloorTransportResponse {
	const floorplan = toDiningFloorplanRef(input);
	return {
		filters: { tags: ["主食", "热餐"] },
		floor: {
			floorId: input.floorId,
			floorplan: { floorplanId: floorplan.floorplanId, kind: "asset" },
			hallId: input.hallId,
			label: input.label,
		},
		source: {
			updatedAt: "2026-06-08T00:00:00.000Z",
		},
		windows: [
			{
				assignment: {
					assignmentId: `assignment:${input.hallId}:${input.floorId}:window-01`,
					offerings: [
						{
							menuItemId: "menu:rice:1",
							name: "金汤鱼粉",
							offeringId: "offering:rice:1",
							priceLabel: "12 元",
							tags: ["粉面"],
						},
						{
							menuItemId: "menu:rice:2",
							name: "鱼粉招牌菜",
							offeringId: "offering:rice:2",
							priceLabel: null,
							tags: ["粉面"],
						},
						{
							menuItemId: "menu:rice:3",
							name: "清淡鱼粉",
							offeringId: "offering:rice:3",
							priceLabel: null,
							tags: ["粉面"],
						},
						{
							menuItemId: "menu:rice:4",
							name: "酸菜鱼粉",
							offeringId: "offering:rice:4",
							priceLabel: "13 元",
							tags: ["粉面", "热餐"],
						},
					],
					stallProfile: {
						displayName: "鱼粉",
						stallProfileId: "stall:rice",
						stallType: "hot_meal",
						tags: ["粉面"],
					},
				},
				label: "一号窗口",
				locationLabel: "入口侧",
				svgAnchorId: "window-01",
				status: "active",
				tags: ["粉面"],
				windowId: `${input.hallId}:${input.floorId}:window-01`,
			},
			{
				assignment: {
					assignmentId: `assignment:${input.hallId}:${input.floorId}:window-02`,
					offerings: [
						{
							menuItemId: "menu:noodle:1",
							name: "螺蛳粉（不加炸蛋）",
							offeringId: "offering:noodle:1",
							priceLabel: "12 元",
							tags: ["粉面", "热餐"],
						},
					],
					stallProfile: {
						displayName: "螺蛳粉",
						stallProfileId: "stall:noodle",
						stallType: "noodle",
						tags: ["粉面", "热餐"],
					},
				},
				label: "二号窗口",
				locationLabel: "中部",
				svgAnchorId: "window-02",
				status: "active",
				tags: ["粉面", "热餐"],
				windowId: `${input.hallId}:${input.floorId}:window-02`,
			},
			...floorplan.anchorInventory.slice(2).map((anchor, index) => {
				const stall = DINING_FLAVOR_STALL_FIXTURES[index];
				if (!stall) {
					throw new Error(`Dining fixture stall is missing for anchor ${anchor.anchorId}.`);
				}
				const windowId = `${input.hallId}:${input.floorId}:${anchor.anchorId}`;
				return {
					assignment: {
						assignmentId: `assignment:${windowId}`,
						offerings: stall.offerings.map((offering, offeringIndex) => ({
							menuItemId: `menu:${windowId}:${offeringIndex + 1}`,
							name: offering.name,
							offeringId: `offering:${windowId}:${offeringIndex + 1}`,
							priceLabel: offering.priceLabel,
							tags: ["主食", "热餐"],
						})),
						stallProfile: {
							displayName: stall.displayName,
							stallProfileId: `stall:${windowId}`,
							stallType: "hot_meal",
							tags: ["主食", "热餐"],
						},
					},
					label: anchor.label ?? `${index + 3}号窗口`,
					locationLabel: stall.displayName,
					status: "active" as const,
					svgAnchorId: anchor.anchorId,
					tags: ["主食", "热餐"],
					windowId,
				};
			}),
		],
	};
}

function toDiningFloorplanRef(input: { floorId: string; hallId: string }) {
	const manifest = getDiningFloorplanByFloor(input);
	return {
		anchorInventory: manifest.anchorInventory,
		floorId: manifest.floorId,
		floorplanId: manifest.floorplanId,
		hallId: manifest.hallId,
		sha256: manifest.sha256,
		svgAssetUrl: manifest.svgAssetUrl,
	};
}
