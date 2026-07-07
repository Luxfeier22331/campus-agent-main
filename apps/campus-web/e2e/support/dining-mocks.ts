import type { Route } from "@playwright/test";

const now = "2026-06-30T08:00:00.000Z";

export async function fulfillDiningFloor(route: Route) {
	const segments = new URL(route.request().url()).pathname.split("/");
	const hallId = decodeURIComponent(segments.at(-3) ?? "haidian-canteen-1");
	const floorId = decodeURIComponent(segments.at(-1) ?? "haidian-canteen-1-1f");
	const floorplan = resolveMockDiningFloorplan({ floorId, hallId });
	await route.fulfill({
		contentType: "application/json",
		json: {
			filters: { tags: ["热餐", "粉面"] },
			floor: {
				canvas: { height: 480, width: 720 },
				floorId,
				floorplan: {
					anchorInventory: [
						{ anchorId: floorplan.primaryAnchorId, label: "一号窗口", role: "window" },
						{ anchorId: floorplan.secondaryAnchorId, label: "二号窗口", role: "window" },
					],
					floorId,
					floorplanId: floorplan.floorplanId,
					hallId,
					sha256: floorplan.sha256,
					svgAssetUrl: floorplan.svgAssetUrl,
				},
				hallId,
				label: floorplan.label,
				svgAssetUrl: floorplan.svgAssetUrl,
			},
			source: { updatedAt: now },
			windows: [
				diningWindow({
					anchorId: floorplan.primaryAnchorId,
					geometry: { height: 76, width: 168, x: 72, y: 92 },
					label: "一号窗口",
					locationLabel: `${floorplan.label} · 1 号窗口`,
					name: floorplan.primaryStallName,
					offerings: [floorplan.primaryOffering],
					windowId: `${hallId}_${floorId}_window_01`,
				}),
				diningWindow({
					anchorId: floorplan.secondaryAnchorId,
					geometry: { height: 76, width: 168, x: 280, y: 92 },
					label: "二号窗口",
					locationLabel: `${floorplan.label} · 2 号窗口`,
					name: "麻辣烫",
					offerings: [{ name: "麻辣烫", priceLabel: "15 元", tags: ["热餐"] }],
					windowId: `${hallId}_${floorId}_window_02`,
				}),
			],
		},
		status: 200,
	});
}

export async function fulfillDiningReviews(route: Route) {
	const segments = new URL(route.request().url()).pathname.split("/");
	const hallId = decodeURIComponent(segments.at(-2) ?? "haidian-canteen-1");
	const floorId = hallId === "haidian-canteen-1" ? "haidian-canteen-1-1f" : hallId;
	const firstWindowId = `${hallId}_${floorId}_window_01`;
	await route.fulfill({
		contentType: "application/json",
		json: {
			reviews: [
				{
					campus: "海淀校区",
					comment: "汤底稳定，午餐时段排队较短。",
					contributorName: "测试同学",
					dishName: "金汤鱼粉",
					hallId: "haidian-canteen-1",
					hallName: "海淀一食堂",
					images: [
						{
							alt: "金汤鱼粉评价图片",
							imageId: "dining-review-image:source_review_fish:1",
							url: "/assets/dining/reviews/source_review_fish-1.jpg",
						},
					],
					paidPriceLabel: "18 元",
					rating: 4,
					reviewId: "review_fish",
					sourceRecordId: "source_review_fish",
					stallName: "鱼粉",
					stallProfileId: `stall_${firstWindowId}`,
					windowId: firstWindowId,
				},
			],
		},
		status: 200,
	});
}

function diningWindow(input: {
	anchorId: string;
	label: string;
	locationLabel: string;
	geometry?: { height: number; width: number; x: number; y: number };
	name: string;
	offerings: Array<{ name: string; priceLabel: string; tags: string[] }>;
	windowId: string;
}) {
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
				tags: ["热餐"],
			},
		},
		geometry: input.geometry ?? { height: 72, width: 150, x: 64, y: 72 },
		label: input.label,
		locationLabel: input.locationLabel,
		status: "active",
		svgAnchorId: input.anchorId,
		tags: ["热餐"],
		windowId: input.windowId,
	};
}

function resolveMockDiningFloorplan(input: { floorId: string; hallId: string }) {
	if (input.hallId === "fengtai-pending-canteen") {
		return {
			floorplanId: "placeholder:fengtai-pending-canteen:fengtai-pending-canteen",
			label: "待补充食堂",
			primaryAnchorId: "pending-window-01",
			primaryOffering: { name: "青菜豆腐", priceLabel: "10 元", tags: ["清淡", "热餐"] },
			primaryStallName: "清淡窗口",
			secondaryAnchorId: "pending-window-02",
			sha256: "sha256:placeholder-fengtai-pending-canteen",
			svgAssetUrl: "",
		};
	}
	if (input.hallId === "haidian-canteen-2") {
		return {
			floorplanId: "floorplan:haidian-canteen-2:haidian-canteen-2",
			label: "海淀二食堂",
			primaryAnchorId: "window-01",
			primaryOffering: { name: "二食堂清炒时蔬", priceLabel: "12 元", tags: ["热餐"] },
			primaryStallName: "二食堂窗口",
			secondaryAnchorId: "window-02",
			sha256: "sha256:e89bcd21875064f370b99b3caac118164b07582240852204e2b60647ca558660",
			svgAssetUrl: "/assets/dining/haidian-canteen-2.svg",
		};
	}
	if (input.hallId === "haidian-canteen-4") {
		return {
			floorplanId: "floorplan:haidian-canteen-4:haidian-canteen-4",
			label: "海淀四食堂",
			primaryAnchorId: "window-01",
			primaryOffering: { name: "四食堂番茄鸡蛋饭", priceLabel: "14 元", tags: ["热餐"] },
			primaryStallName: "四食堂窗口",
			secondaryAnchorId: "window-02",
			sha256: "sha256:a1464e58196fc309cdb285a9192e9de4a1552850c3c8a129bb6e119d8382d160",
			svgAssetUrl: "/assets/dining/haidian-canteen-4.svg",
		};
	}
	if (
		input.hallId === "fengtai-huixian-canteen" &&
		input.floorId === "fengtai-huixian-canteen-2f"
	) {
		return {
			floorplanId: "floorplan:fengtai-huixian-canteen:fengtai-huixian-canteen-2f",
			label: "荟贤食堂二层",
			primaryAnchorId: "window-01",
			primaryOffering: { name: "螺蛳粉", priceLabel: "16 元", tags: ["热餐"] },
			primaryStallName: "螺蛳粉",
			secondaryAnchorId: "window-02",
			sha256: "sha256:25ba425130f907bf36f9e9057cf2509f77657ee299ccc38e2b724777680e54bf",
			svgAssetUrl: "/assets/dining/fengtai-huixian-canteen-fengtai-huixian-canteen-2f.svg",
		};
	}
	if (input.hallId === "fengtai-huixian-canteen") {
		return {
			floorplanId: "floorplan:fengtai-huixian-canteen:fengtai-huixian-canteen-1f",
			label: "荟贤食堂一层",
			primaryAnchorId: "window-01",
			primaryOffering: { name: "螺蛳粉", priceLabel: "16 元", tags: ["热餐"] },
			primaryStallName: "螺蛳粉",
			secondaryAnchorId: "window-02",
			sha256: "sha256:d5af2f44ac03d509f549efdb689c665b9f4dc54541dbd14c842f3ca839f016d6",
			svgAssetUrl: "/assets/dining/fengtai-huixian-canteen-fengtai-huixian-canteen-1f.svg",
		};
	}
	return {
		floorplanId: "floorplan:haidian-canteen-1:haidian-canteen-1-1f",
		label: "海淀一食堂",
		primaryAnchorId: "window-01",
		primaryOffering: { name: "金汤鱼粉", priceLabel: "18 元", tags: ["热餐", "粉面"] },
		primaryStallName: "鱼粉",
		secondaryAnchorId: "window-02",
		sha256: "sha256:c55f08aa63157e174970361c07811678f54727179b317901c20b1b2f25df6929",
		svgAssetUrl: "/assets/dining/haidian-canteen-1-haidian-canteen-1-1f.svg",
	};
}
