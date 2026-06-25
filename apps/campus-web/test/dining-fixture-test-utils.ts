interface DiningApiMock {
	getDiningFloor: {
		mockImplementation: (
			implementation: (input: { floorId: string; hallId: string }) => Promise<unknown>,
		) => unknown;
	};
	getDiningHallReviews: {
		mockImplementation: (
			implementation: (input: { hallId: string }) => Promise<unknown>,
		) => unknown;
	};
	getDiningHalls: {
		mockResolvedValue: (value: unknown) => unknown;
	};
}

export function mockDiningFixtureApi(diningApiMock: DiningApiMock) {
	diningApiMock.getDiningHalls.mockResolvedValue({
		halls: [
			{
				campus: "海淀校区",
				floors: [{ floorId: "haidian-canteen-1-1f", label: "一层" }],
				hallId: "haidian-canteen-1",
				name: "海淀一食堂",
			},
			{
				campus: "丰台校区",
				floors: [
					{ floorId: "fengtai-huixian-canteen-1f", label: "一层" },
					{ floorId: "fengtai-huixian-canteen-2f", label: "二层" },
				],
				hallId: "fengtai-huixian-canteen",
				name: "荟贤食堂",
			},
		],
	});
	diningApiMock.getDiningFloor.mockImplementation(
		({ floorId, hallId }: { floorId: string; hallId: string }) => {
			const projections = {
				"fengtai-huixian-canteen:fengtai-huixian-canteen-1f": "荟贤食堂一层",
				"fengtai-huixian-canteen:fengtai-huixian-canteen-2f": "荟贤食堂二层",
				"haidian-canteen-1:haidian-canteen-1-1f": "海淀一食堂一层",
			} as const;
			const label = projections[`${hallId}:${floorId}` as keyof typeof projections];
			if (!label) {
				return Promise.reject(new Error("missing dining projection"));
			}
			return Promise.resolve(createDiningFloorPayload({ floorId, hallId, label }));
		},
	);
	diningApiMock.getDiningHallReviews.mockImplementation(({ hallId }: { hallId: string }) =>
		Promise.resolve({
			reviews:
				hallId === "haidian-canteen-1"
					? [
							{
								campus: "海淀校区",
								comment: "有一点辣，有一点酸。",
								contributorName: "果小生",
								dishName: "金汤鱼粉",
								hallId: "haidian-canteen-1",
								hallName: "海淀一食堂",
								images: [
									{
										alt: "金汤鱼粉评价图片",
										imageId: "dining-review-image:rec27DpktN6uQn:1",
										url: "/assets/dining/reviews/rec27DpktN6uQn.jpg",
									},
								],
								paidPriceLabel: "12 元",
								rating: 4,
								reviewId: "dining-review:rec27DpktN6uQn",
								sourceRecordId: "rec27DpktN6uQn",
								stallName: "鱼粉",
							},
						]
					: [],
		}),
	);
}

function createDiningFloorPayload(input: { floorId: string; hallId: string; label: string }) {
	return {
		filters: { tags: ["主食", "热餐"] },
		floor: {
			canvas: { height: 420, width: 720 },
			floorId: input.floorId,
			floorplan: toDiningFloorplanRef(input),
			hallId: input.hallId,
			label: input.label,
			svgAssetUrl: `/assets/dining/${input.hallId}-${input.floorId}.svg`,
		},
		source: {
			label: "校园食堂平面图整理",
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
							priceLabel: "16 元",
							tags: ["粉面"],
						},
					],
					stallProfile: {
						displayName: "鱼粉",
						stallProfileId: "stall:rice",
						stallType: "hot_meal",
						tags: ["粉面"],
					},
				},
				geometry: { height: 72, width: 150, x: 64, y: 72 },
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
				geometry: { height: 72, width: 150, x: 240, y: 72 },
				label: "二号窗口",
				locationLabel: "中部",
				svgAnchorId: "window-02",
				status: "active",
				tags: ["粉面", "热餐"],
				windowId: `${input.hallId}:${input.floorId}:window-02`,
			},
		],
	};
}

function toDiningFloorplanRef(input: { floorId: string; hallId: string }) {
	const shaByFloor = {
		"fengtai-huixian-canteen-1f":
			"sha256:1f02bf778c9c11ec7c9ce0426fa63bfff0ba1ec6dc9dc0be20b26a9a6a5b710a",
		"fengtai-huixian-canteen-2f":
			"sha256:2641cf62e78b00690f4a03d265d161613fd475bef5c86ecb3bd139728ec3c3e2",
		"haidian-canteen-1-1f":
			"sha256:c55f08aa63157e174970361c07811678f54727179b317901c20b1b2f25df6929",
	} as const;
	const sha256 = shaByFloor[input.floorId as keyof typeof shaByFloor];
	if (!sha256) {
		throw new Error(`missing dining floorplan test fixture: ${input.hallId}/${input.floorId}`);
	}
	return {
		anchorInventory: [
			{ anchorId: "window-01", label: "一号窗口", role: "window" },
			{ anchorId: "window-02", label: "二号窗口", role: "window" },
			{ anchorId: "window-03", label: "三号窗口", role: "window" },
			{ anchorId: "window-04", label: "四号窗口", role: "window" },
			{ anchorId: "window-05", label: "五号窗口", role: "window" },
		],
		floorId: input.floorId,
		floorplanId: `floorplan:${input.hallId}:${input.floorId}`,
		hallId: input.hallId,
		sha256,
		svgAssetUrl: `/assets/dining/${input.hallId}-${input.floorId}.svg`,
	};
}
