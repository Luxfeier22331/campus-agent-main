import type { Route } from "@playwright/test";

const now = "2026-06-30T08:00:00.000Z";

export async function fulfillDiningFloor(route: Route) {
	const segments = new URL(route.request().url()).pathname.split("/");
	const hallId = decodeURIComponent(segments.at(-3) ?? "haidian-canteen-1");
	const floorId = decodeURIComponent(segments.at(-1) ?? "haidian-canteen-1-1f");
	const isFengtai = hallId === "fengtai-huixian-canteen";
	const floorplan = isFengtai
		? floorId === "fengtai-huixian-canteen-2f"
			? {
					floorplanId: "floorplan:fengtai-huixian-canteen:fengtai-huixian-canteen-2f",
					label: "荟贤食堂二层",
					sha256: "sha256:2641cf62e78b00690f4a03d265d161613fd475bef5c86ecb3bd139728ec3c3e2",
				}
			: {
					floorplanId: "floorplan:fengtai-huixian-canteen:fengtai-huixian-canteen-1f",
					label: "荟贤食堂一层",
					sha256: "sha256:1f02bf778c9c11ec7c9ce0426fa63bfff0ba1ec6dc9dc0be20b26a9a6a5b710a",
				}
		: {
				floorplanId: "floorplan:haidian-canteen-1:haidian-canteen-1-1f",
				label: "海淀一食堂一层",
				sha256: "sha256:c55f08aa63157e174970361c07811678f54727179b317901c20b1b2f25df6929",
			};
	await route.fulfill({
		contentType: "application/json",
		json: {
			filters: { tags: ["热餐", "粉面"] },
			floor: {
				canvas: { height: 480, width: 720 },
				floorId,
				floorplan: {
					anchorInventory: [
						{ anchorId: "window-01", label: "一号窗口", role: "window" },
						{ anchorId: "window-02", label: "二号窗口", role: "window" },
					],
					floorId,
					floorplanId: floorplan.floorplanId,
					hallId,
					sha256: floorplan.sha256,
					svgAssetUrl: `/assets/dining/${hallId}-${floorId}.svg`,
				},
				hallId,
				label: floorplan.label,
				svgAssetUrl: `/assets/dining/${hallId}-${floorId}.svg`,
			},
			source: { label: "E2E 食堂数据", updatedAt: now },
			windows: [
				diningWindow({
					anchorId: "window-01",
					label: "一号窗口",
					locationLabel: `${floorplan.label} · 1 号窗口`,
					name: isFengtai ? "螺蛳粉" : "鱼粉",
					offerings: isFengtai
						? [{ name: "螺蛳粉", priceLabel: "16 元", tags: ["热餐"] }]
						: [{ name: "金汤鱼粉", priceLabel: "18 元", tags: ["热餐", "粉面"] }],
					windowId: "window_01",
				}),
				diningWindow({
					anchorId: "window-02",
					label: "二号窗口",
					locationLabel: `${floorplan.label} · 2 号窗口`,
					name: "麻辣烫",
					offerings: [{ name: "麻辣烫", priceLabel: "15 元", tags: ["热餐"] }],
					windowId: "window_02",
				}),
			],
		},
		status: 200,
	});
}

function diningWindow(input: {
	anchorId: string;
	label: string;
	locationLabel: string;
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
		geometry: { height: 72, width: 150, x: 64, y: 72 },
		label: input.label,
		locationLabel: input.locationLabel,
		status: "active",
		svgAnchorId: input.anchorId,
		tags: ["热餐"],
		windowId: input.windowId,
	};
}
