import type { InitialDiningHallSeed, InitialDiningStallSeed } from "./initial-data";

export const FENGTAI_OUTDOOR_DINING_ZONE_SEED: InitialDiningHallSeed = {
	campus: "丰台校区",
	floors: [
		{
			floorId: "fengtai-outdoor-dining-zone-ground",
			label: "地面区",
			stalls: [
				createOutdoorStall("shop-01-maituanxiong", "麦团熊", "北侧 01", ["露天餐饮", "小吃"]),
				createOutdoorStall("shop-02-zuozuoxiang", "左左香", "北侧 02", ["露天餐饮", "热餐"]),
				createOutdoorStall("shop-03-tastien", "塔斯汀", "北侧 03", ["露天餐饮", "简餐"]),
				createOutdoorStall("shop-04-huihan-zhachuan", "会汉炸串", "西北侧 04", [
					"露天餐饮",
					"小吃",
				]),
				createOutdoorStall("shop-05-luckin-jixiang-huntun", "瑞幸咖啡 / 吉祥馄饨", "西南侧 05", [
					"露天餐饮",
					"饮品",
					"面食",
				]),
				createOutdoorStall("shop-06-lage-lamei", "辣哥辣妹", "南侧 06", ["露天餐饮", "热餐"]),
				createOutdoorStall("shop-07-ice-snacks", "冰品小吃", "南侧 07", [
					"露天餐饮",
					"饮品",
					"小吃",
				]),
				createOutdoorStall("shop-08-guizhou-snacks", "贵州小吃", "南侧 08", ["露天餐饮", "小吃"]),
				createOutdoorStall("stall-water-bar", "水吧", "中部临时摊位", ["露天餐饮", "饮品"]),
				createOutdoorStall("stall-fruit", "水果", "中部临时摊位", ["露天餐饮", "水果"]),
				createOutdoorStall("stall-light-food", "轻食", "中部临时摊位", ["露天餐饮", "轻食"]),
			],
			svgAssetUrl: "/assets/dining/fengtai-outdoor-dining-zone.svg",
		},
	],
	hallId: "fengtai-outdoor-dining-zone",
	name: "丰台露天餐饮区",
};

function createOutdoorStall(
	svgAnchorId: string,
	name: string,
	locationLabel: string,
	tags: string[],
): InitialDiningStallSeed {
	const compactName = name.replace(" / ", "");
	return {
		id: svgAnchorId,
		locationLabel,
		name,
		offerings: [
			{
				name: `${compactName}招牌套餐`,
				priceLabel: "18 元",
				tags,
			},
			{
				name: `${compactName}双人套餐`,
				priceLabel: "28 元",
				tags,
			},
			{
				name: `${compactName}单品`,
				priceLabel: "12 元",
				tags,
			},
		],
		priceLabel: "18 元",
		svgAnchorId,
		tags,
		windowIdSuffix: svgAnchorId,
	};
}
