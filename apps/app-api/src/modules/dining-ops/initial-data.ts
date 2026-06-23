import { FENGTAI_OUTDOOR_DINING_ZONE_SEED } from "./fengtai-outdoor-dining-zone";

export interface InitialDiningOfferingSeed {
	name: string;
	priceLabel: string;
	tags: string[];
}

export interface InitialDiningStallSeed {
	id: string;
	locationLabel: string;
	name: string;
	offerings: InitialDiningOfferingSeed[];
	priceLabel: string;
	svgAnchorId?: string;
	tags: string[];
	windowIdSuffix?: string;
}

export interface InitialDiningFloorSeed {
	floorId: string;
	label: string;
	stalls: InitialDiningStallSeed[];
	svgAssetUrl?: string;
}

export interface InitialDiningHallSeed {
	campus: string;
	floors: InitialDiningFloorSeed[];
	hallId: string;
	name: string;
}

export const DINING_SOURCE = {
	label: "校园食堂平面图整理",
	updatedAt: "2026-06-08T00:00:00.000Z",
};

export const DINING_CANVAS = {
	height: 420,
	width: 720,
};

export const INITIAL_DINING_HALL_SEEDS: InitialDiningHallSeed[] = [
	FENGTAI_OUTDOOR_DINING_ZONE_SEED,
	createSingleFloorHall("haidian-canteen-1", "海淀一食堂", "海淀校区", [
		createStall(
			"rice-bowl",
			"盖饭窗口",
			"入口左侧",
			"12-18 元",
			["主食", "热餐"],
			[
				createOffering("番茄牛腩饭", "18 元", ["主食", "热餐"]),
				createOffering("鸡腿盖饭", "16 元", ["主食", "热餐"]),
				createOffering("土豆牛肉饭", "17 元", ["主食", "热餐"]),
			],
		),
		createStall(
			"noodle",
			"面食窗口",
			"中部东侧",
			"10-16 元",
			["面食"],
			[
				createOffering("牛肉面", "16 元", ["面食"]),
				createOffering("番茄鸡蛋面", "12 元", ["面食"]),
				createOffering("炸酱面", "14 元", ["面食"]),
			],
		),
		createStall(
			"breakfast",
			"早餐窗口",
			"入口右侧",
			"4-12 元",
			["早餐", "轻食"],
			[createOffering("豆浆油条", "6 元", ["早餐"])],
		),
		createStall(
			"drinks",
			"饮品窗口",
			"出口侧",
			"3-10 元",
			["饮品"],
			[createOffering("柠檬茶", "8 元", ["饮品"])],
		),
		createStall(
			"soup",
			"汤粥窗口",
			"北侧",
			"5-12 元",
			["粥品", "汤品"],
			[createOffering("皮蛋瘦肉粥", "8 元", ["粥品"])],
		),
	]),
	createSingleFloorHall("haidian-canteen-2", "海淀二食堂", "海淀校区", [
		createStall(
			"self-service",
			"自选称重窗口",
			"入口左侧",
			"12-25 元",
			["自选菜"],
			[
				createOffering("自选热菜", "3.8 元/两", ["自选菜"]),
				createOffering("素菜拼盘", "10 元", ["自选菜"]),
			],
		),
		createStall(
			"fried-rice",
			"炒饭炒面窗口",
			"中部",
			"10-18 元",
			["快餐"],
			[createOffering("扬州炒饭", "14 元", ["快餐"])],
		),
		createStall(
			"malatang",
			"麻辣烫窗口",
			"东侧",
			"15-28 元",
			["热餐"],
			[createOffering("麻辣烫", "2.8 元/两", ["热餐"])],
		),
		createStall(
			"dumpling",
			"饺子馄饨窗口",
			"北侧",
			"10-18 元",
			["面食"],
			[createOffering("猪肉白菜饺子", "16 元", ["面食"])],
		),
		createStall(
			"fruit",
			"水果轻食窗口",
			"出口侧",
			"5-16 元",
			["轻食"],
			[createOffering("水果杯", "12 元", ["轻食"])],
		),
	]),
	createSingleFloorHall("haidian-canteen-3", "海淀三食堂", "海淀校区", [
		createStall(
			"halal-noodle",
			"牛肉面窗口",
			"北侧",
			"12-22 元",
			["清真", "面食"],
			[
				createOffering("兰州牛肉面", "18 元", ["清真", "面食"]),
				createOffering("拌面", "16 元", ["清真", "面食"]),
			],
		),
		createStall(
			"halal-rice",
			"手抓饭窗口",
			"东侧",
			"15-26 元",
			["清真", "米饭"],
			[createOffering("羊肉手抓饭", "24 元", ["清真", "米饭"])],
		),
		createStall(
			"halal-set",
			"清真套餐窗口",
			"中部",
			"14-24 元",
			["清真", "套餐"],
			[createOffering("清真鸡肉套餐", "18 元", ["清真", "套餐"])],
		),
		createStall(
			"bun",
			"包子饼类窗口",
			"入口侧",
			"4-12 元",
			["早餐"],
			[createOffering("牛肉包", "4 元", ["早餐", "清真"])],
		),
		createStall(
			"soup",
			"汤品窗口",
			"南侧",
			"6-14 元",
			["汤品"],
			[createOffering("牛肉汤", "12 元", ["汤品", "清真"])],
		),
	]),
	createSingleFloorHall("haidian-canteen-4", "海淀四食堂", "海淀校区", [
		createStall(
			"home-style",
			"家常菜窗口",
			"入口左侧",
			"10-18 元",
			["热餐"],
			[createOffering("鱼香肉丝饭", "15 元", ["热餐", "主食"])],
		),
		createStall(
			"clay-pot",
			"砂锅窗口",
			"西侧",
			"14-24 元",
			["砂锅"],
			[createOffering("牛肉砂锅", "22 元", ["砂锅"])],
		),
		createStall(
			"rice-noodle",
			"米粉窗口",
			"东侧",
			"10-18 元",
			["粉面"],
			[createOffering("酸辣米粉", "14 元", ["粉面"])],
		),
		createStall(
			"snack",
			"小吃窗口",
			"出口侧",
			"5-14 元",
			["小吃"],
			[createOffering("煎饼", "9 元", ["小吃"])],
		),
		createStall(
			"tea",
			"茶饮窗口",
			"南侧",
			"5-16 元",
			["饮品"],
			[createOffering("鲜奶茶", "12 元", ["饮品"])],
		),
	]),
	createSingleFloorHall("haidian-canteen-5", "海淀五食堂", "海淀校区", [
		createStall(
			"set-meal",
			"套餐窗口",
			"中部",
			"14-22 元",
			["套餐"],
			[createOffering("双拼套餐", "20 元", ["套餐"])],
		),
		createStall(
			"western",
			"简餐窗口",
			"西侧",
			"16-28 元",
			["简餐"],
			[createOffering("鸡排饭", "22 元", ["简餐"])],
		),
		createStall(
			"baked-rice",
			"烤盘饭窗口",
			"东侧",
			"15-24 元",
			["米饭"],
			[createOffering("照烧鸡烤盘饭", "20 元", ["米饭"])],
		),
		createStall(
			"bakery",
			"面包甜点窗口",
			"入口右侧",
			"5-18 元",
			["甜品"],
			[createOffering("可颂", "8 元", ["甜品"])],
		),
		createStall(
			"coffee",
			"咖啡饮品窗口",
			"出口侧",
			"8-20 元",
			["饮品"],
			[createOffering("拿铁", "16 元", ["饮品"])],
		),
	]),
	{
		campus: "丰台校区",
		floors: [
			createDiningFloor("fengtai-huixian-canteen-1f", "一层", [
				createStall(
					"huixian-1f-breakfast",
					"早餐窗口",
					"入口左侧",
					"4-12 元",
					["早餐"],
					[createOffering("豆腐脑套餐", "9 元", ["早餐"])],
				),
				createStall(
					"huixian-1f-rice",
					"盖饭窗口",
					"中部",
					"12-20 元",
					["米饭"],
					[createOffering("黑椒牛柳饭", "18 元", ["米饭"])],
				),
				createStall(
					"huixian-1f-noodle",
					"面食窗口",
					"东侧",
					"10-18 元",
					["面食"],
					[createOffering("炸酱面", "14 元", ["面食"])],
				),
				createStall(
					"huixian-1f-soup",
					"汤粥窗口",
					"北侧",
					"5-14 元",
					["汤品"],
					[createOffering("南瓜粥", "6 元", ["汤品"])],
				),
				createStall(
					"huixian-1f-drinks",
					"饮品窗口",
					"出口侧",
					"4-12 元",
					["饮品"],
					[createOffering("酸梅汤", "6 元", ["饮品"])],
				),
			]),
			createDiningFloor("fengtai-huixian-canteen-2f", "二层", [
				createStall(
					"huixian-2f-hot-pot",
					"小火锅窗口",
					"西侧",
					"18-30 元",
					["热餐"],
					[createOffering("番茄小火锅", "28 元", ["热餐"])],
				),
				createStall(
					"huixian-2f-bibimbap",
					"石锅拌饭窗口",
					"北侧",
					"15-24 元",
					["米饭"],
					[createOffering("肥牛石锅拌饭", "22 元", ["米饭"])],
				),
				createStall(
					"huixian-2f-dumpling",
					"饺子馄饨窗口",
					"东侧",
					"10-18 元",
					["面食"],
					[createOffering("三鲜馄饨", "14 元", ["面食"])],
				),
				createStall(
					"huixian-2f-light",
					"轻食窗口",
					"南侧",
					"12-24 元",
					["轻食"],
					[createOffering("鸡胸肉沙拉", "22 元", ["轻食"])],
				),
				createStall(
					"huixian-2f-dessert",
					"甜品窗口",
					"出口侧",
					"6-16 元",
					["甜品"],
					[createOffering("双皮奶", "12 元", ["甜品"])],
				),
			]),
		],
		hallId: "fengtai-huixian-canteen",
		name: "荟贤食堂",
	},
	{
		campus: "丰台校区",
		floors: [
			createDiningFloor("fengtai-juya-canteen-1f", "一层", [
				createStall(
					"juya-1f-self-service",
					"自选称重窗口",
					"入口左侧",
					"12-26 元",
					["自选菜"],
					[createOffering("自选热菜", "3.6 元/两", ["自选菜"])],
				),
				createStall(
					"juya-1f-set",
					"套餐窗口",
					"中部",
					"14-22 元",
					["套餐"],
					[createOffering("家常套餐", "18 元", ["套餐"])],
				),
				createStall(
					"juya-1f-noodle",
					"粉面窗口",
					"东侧",
					"10-18 元",
					["粉面"],
					[createOffering("酸汤粉", "14 元", ["粉面"])],
				),
				createStall(
					"juya-1f-snack",
					"小吃窗口",
					"出口侧",
					"5-14 元",
					["小吃"],
					[createOffering("手抓饼", "9 元", ["小吃"])],
				),
				createStall(
					"juya-1f-tea",
					"茶饮窗口",
					"南侧",
					"5-18 元",
					["饮品"],
					[createOffering("茉莉奶绿", "12 元", ["饮品"])],
				),
			]),
			createDiningFloor("fengtai-juya-canteen-2f", "二层", [
				createStall(
					"juya-2f-grill",
					"烤盘饭窗口",
					"西侧",
					"15-26 元",
					["米饭"],
					[createOffering("黑椒烤肉饭", "22 元", ["米饭"])],
				),
				createStall(
					"juya-2f-spicy",
					"麻辣烫窗口",
					"北侧",
					"15-28 元",
					["热餐"],
					[createOffering("麻辣烫", "2.8 元/两", ["热餐"])],
				),
				createStall(
					"juya-2f-sandwich",
					"简餐窗口",
					"东侧",
					"16-28 元",
					["简餐"],
					[createOffering("火腿芝士三明治", "18 元", ["简餐"])],
				),
				createStall(
					"juya-2f-fruit",
					"水果轻食窗口",
					"南侧",
					"5-18 元",
					["轻食"],
					[createOffering("酸奶水果杯", "15 元", ["轻食"])],
				),
				createStall(
					"juya-2f-coffee",
					"咖啡窗口",
					"出口侧",
					"8-20 元",
					["饮品"],
					[createOffering("美式咖啡", "12 元", ["饮品"])],
				),
			]),
		],
		hallId: "fengtai-juya-canteen",
		name: "聚雅食堂",
	},
];

function createSingleFloorHall(
	hallId: string,
	name: string,
	campus: string,
	stalls: InitialDiningStallSeed[],
): InitialDiningHallSeed {
	return {
		campus,
		floors: [createDiningFloor(`${hallId}-1f`, "一层", stalls)],
		hallId,
		name,
	};
}

function createDiningFloor(
	floorId: string,
	label: string,
	stalls: InitialDiningStallSeed[],
): InitialDiningFloorSeed {
	return { floorId, label, stalls };
}

function createStall(
	id: string,
	name: string,
	locationLabel: string,
	priceLabel: string,
	tags: string[],
	offerings: InitialDiningOfferingSeed[],
): InitialDiningStallSeed {
	return {
		id,
		locationLabel,
		name,
		offerings: withMinimumSeedOfferings(offerings, name, tags),
		priceLabel,
		tags,
	};
}

function createOffering(
	name: string,
	priceLabel: string,
	tags: string[],
): InitialDiningOfferingSeed {
	return { name, priceLabel, tags };
}

function withMinimumSeedOfferings(
	offerings: InitialDiningOfferingSeed[],
	stallName: string,
	tags: string[],
): InitialDiningOfferingSeed[] {
	if (offerings.length >= 3) {
		return offerings;
	}
	const compactName = stallName.replace(/窗口$/, "");
	return [
		...offerings,
		...[
			createOffering(`${compactName}推荐菜`, "18 元", tags),
			createOffering(`${compactName}招牌菜`, "12 元", tags),
		].slice(0, 3 - offerings.length),
	];
}
