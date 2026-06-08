import { AppApiRouteError } from "../../http";

export type CampusMapPlaceCategory = "building" | "gate" | "landmark" | "service" | "transport";

export interface CampusMapPlace {
	accessNote: string | null;
	campus: string;
	category: CampusMapPlaceCategory;
	description: string;
	geojson: {
		type: "Feature";
		geometry: {
			type: "Point";
			coordinates: [number, number];
		};
		properties: {
			category: CampusMapPlaceCategory;
			placeId: string;
			title: string;
		};
	};
	id: string;
	sourceRefs: string[];
	tags: string[];
	title: string;
}

export interface CampusMapPlacesResponse {
	campus: {
		defaultCenter: [number, number];
		id: string;
		name: string;
	};
	places: CampusMapPlace[];
}

export interface DiningHallSummary {
	campus: string;
	floors: Array<{
		floorId: string;
		label: string;
	}>;
	hallId: string;
	name: string;
}

export interface DiningHallsResponse {
	halls: DiningHallSummary[];
}

export interface DiningFloorResponse {
	floor: {
		floorId: string;
		hallId: string;
		label: string;
		svgAssetUrl: string;
	};
	source: {
		label: string;
		updatedAt: string;
	};
	stalls: Array<{
		id: string;
		locationLabel: string;
		name: string;
		priceLabel: string;
		tags: string[];
	}>;
}

export type FeedbackCategory =
	| "content_issue"
	| "dining_issue"
	| "experience_issue"
	| "map_issue"
	| "other";

export interface SubmitFeedbackInput {
	body: string;
	category: FeedbackCategory;
	contact: string | null;
	routeContext: string;
}

export interface SubmitFeedbackResponse {
	feedback: {
		category: FeedbackCategory;
		feedbackId: string;
		receivedAt: string;
		routeContext: string;
		status: "received";
	};
}

export interface CampusExperienceService {
	getDiningFloor(input: { floorId: string; hallId: string }): Promise<DiningFloorResponse>;
	getDiningHalls(): Promise<DiningHallsResponse>;
	getMapPlace(input: { placeId: string }): Promise<{ place: CampusMapPlace }>;
	getMapPlaces(): Promise<CampusMapPlacesResponse>;
	submitFeedback(input: SubmitFeedbackInput): Promise<SubmitFeedbackResponse>;
}

const CAMPUS_CENTER: [number, number] = [116.3216, 39.9519];

const MAP_PLACES: CampusMapPlace[] = [
	createMapPlace({
		campus: "海淀校区",
		category: "building",
		coordinates: [116.3211, 39.9524],
		description: "图书馆与自习、借阅相关服务的主要位置。",
		id: "library",
		tags: ["学习", "自习", "借阅"],
		title: "图书馆",
	}),
	createMapPlace({
		campus: "海淀校区",
		category: "building",
		coordinates: [116.3207, 39.952],
		description: "教学楼区域，集中展示课程、上课地点和教学相关入口。",
		id: "teaching-building",
		tags: ["上课", "教学"],
		title: "教学楼",
	}),
	createMapPlace({
		campus: "海淀校区",
		category: "service",
		coordinates: [116.3222, 39.9515],
		description: "学生事务、办事咨询与材料提交常用地点。",
		id: "student-service",
		tags: ["办事", "咨询"],
		title: "学生事务中心",
	}),
	createMapPlace({
		campus: "海淀校区",
		category: "gate",
		coordinates: [116.3234, 39.9512],
		description: "海淀校区常用出入口之一，适合定位到校路线。",
		id: "east-gate",
		tags: ["出入口", "交通"],
		title: "东门",
	}),
	createMapPlace({
		campus: "海淀校区",
		category: "landmark",
		coordinates: [116.3214, 39.9518],
		description: "校园中心开放空间，适合约定集合和识别方位。",
		id: "central-square",
		tags: ["地标", "集合"],
		title: "中心广场",
	}),
	createMapPlace({
		campus: "海淀校区",
		category: "transport",
		coordinates: [116.3237, 39.9513],
		description: "海淀校区东侧通勤连接点。",
		id: "bus-stop-east",
		tags: ["公交", "通勤"],
		title: "东门公交站",
	}),
	createMapPlace({
		campus: "海淀校区",
		category: "building",
		coordinates: [116.3212, 39.9527],
		description: "海淀校区一食堂，单层食堂。",
		id: "haidian-canteen-1",
		tags: ["食堂", "生活", "海淀"],
		title: "海淀一食堂",
	}),
	createMapPlace({
		campus: "海淀校区",
		category: "building",
		coordinates: [116.3208, 39.9525],
		description: "海淀校区二食堂，单层食堂。",
		id: "haidian-canteen-2",
		tags: ["食堂", "生活", "海淀"],
		title: "海淀二食堂",
	}),
	createMapPlace({
		campus: "海淀校区",
		category: "building",
		coordinates: [116.3218, 39.9526],
		description: "海淀校区三食堂，单层食堂。",
		id: "haidian-canteen-3",
		tags: ["食堂", "生活", "海淀"],
		title: "海淀三食堂",
	}),
	createMapPlace({
		campus: "海淀校区",
		category: "building",
		coordinates: [116.3209, 39.9509],
		description: "海淀校区四食堂，单层食堂。",
		id: "haidian-canteen-4",
		tags: ["食堂", "生活", "海淀"],
		title: "海淀四食堂",
	}),
	createMapPlace({
		campus: "海淀校区",
		category: "building",
		coordinates: [116.3217, 39.9507],
		description: "海淀校区五食堂，单层食堂。",
		id: "haidian-canteen-5",
		tags: ["食堂", "生活", "海淀"],
		title: "海淀五食堂",
	}),
	createMapPlace({
		campus: "丰台校区",
		category: "building",
		coordinates: [116.3242, 39.9532],
		description: "丰台校区汇贤食堂，设一层和二层。",
		id: "fengtai-huixian-canteen",
		tags: ["食堂", "生活", "丰台"],
		title: "汇贤食堂",
	}),
	createMapPlace({
		campus: "丰台校区",
		category: "building",
		coordinates: [116.3249, 39.9534],
		description: "丰台校区聚雅食堂，设一层和二层。",
		id: "fengtai-juya-canteen",
		tags: ["食堂", "生活", "丰台"],
		title: "聚雅食堂",
	}),
	createMapPlace({
		campus: "丰台校区",
		category: "gate",
		coordinates: [116.3253, 39.953],
		description: "丰台校区主要出入口之一。",
		id: "fengtai-main-gate",
		tags: ["出入口", "丰台"],
		title: "丰台校区主入口",
	}),
	createMapPlace({
		campus: "丰台校区",
		category: "transport",
		coordinates: [116.3257, 39.9531],
		description: "丰台校区通勤接驳点。",
		id: "fengtai-shuttle-stop",
		tags: ["通勤", "丰台"],
		title: "丰台校区接驳点",
	}),
];

export type DiningStallSeed = DiningFloorResponse["stalls"][number];

export interface DiningFloorSeed {
	floorId: string;
	label: string;
	stalls: DiningStallSeed[];
}

export interface DiningHallSeed {
	campus: string;
	floors: DiningFloorSeed[];
	hallId: string;
	name: string;
}

export const DINING_SOURCE = {
	label: "校园食堂平面图整理",
	updatedAt: "2026-06-08T00:00:00.000Z",
};

export const DINING_HALL_SEEDS: DiningHallSeed[] = [
	createSingleFloorHall("haidian-canteen-1", "海淀一食堂", "海淀校区", [
		createStall("rice-bowl", "盖饭窗口", "入口左侧", "12-18 元", ["主食", "热餐"]),
		createStall("noodle", "面食窗口", "中部东侧", "10-16 元", ["面食"]),
		createStall("breakfast", "早餐窗口", "入口右侧", "4-12 元", ["早餐", "轻食"]),
		createStall("drinks", "饮品窗口", "出口侧", "3-10 元", ["饮品"]),
		createStall("soup", "汤粥窗口", "北侧", "5-12 元", ["粥品", "汤品"]),
	]),
	createSingleFloorHall("haidian-canteen-2", "海淀二食堂", "海淀校区", [
		createStall("self-service", "自选称重窗口", "入口左侧", "12-25 元", ["自选菜"]),
		createStall("fried-rice", "炒饭炒面窗口", "中部", "10-18 元", ["快餐"]),
		createStall("malatang", "麻辣烫窗口", "东侧", "15-28 元", ["热餐"]),
		createStall("dumpling", "饺子馄饨窗口", "北侧", "10-18 元", ["面食"]),
		createStall("fruit", "水果轻食窗口", "出口侧", "5-16 元", ["轻食"]),
	]),
	createSingleFloorHall("haidian-canteen-3", "海淀三食堂", "海淀校区", [
		createStall("halal-noodle", "牛肉面窗口", "北侧", "12-22 元", ["清真", "面食"]),
		createStall("halal-rice", "手抓饭窗口", "东侧", "15-26 元", ["清真", "米饭"]),
		createStall("halal-set", "清真套餐窗口", "中部", "14-24 元", ["清真", "套餐"]),
		createStall("bun", "包子饼类窗口", "入口侧", "4-12 元", ["早餐"]),
		createStall("soup", "汤品窗口", "南侧", "6-14 元", ["汤品"]),
	]),
	createSingleFloorHall("haidian-canteen-4", "海淀四食堂", "海淀校区", [
		createStall("home-style", "家常菜窗口", "入口左侧", "10-18 元", ["热餐"]),
		createStall("clay-pot", "砂锅窗口", "西侧", "14-24 元", ["砂锅"]),
		createStall("rice-noodle", "米粉窗口", "东侧", "10-18 元", ["粉面"]),
		createStall("snack", "小吃窗口", "出口侧", "5-14 元", ["小吃"]),
		createStall("tea", "茶饮窗口", "南侧", "5-16 元", ["饮品"]),
	]),
	createSingleFloorHall("haidian-canteen-5", "海淀五食堂", "海淀校区", [
		createStall("set-meal", "套餐窗口", "中部", "14-22 元", ["套餐"]),
		createStall("western", "简餐窗口", "西侧", "16-28 元", ["简餐"]),
		createStall("baked-rice", "烤盘饭窗口", "东侧", "15-24 元", ["米饭"]),
		createStall("bakery", "面包甜点窗口", "入口右侧", "5-18 元", ["甜品"]),
		createStall("coffee", "咖啡饮品窗口", "出口侧", "8-20 元", ["饮品"]),
	]),
	{
		campus: "丰台校区",
		floors: [
			createDiningFloor("1f", "一层", [
				createStall("huixian-1f-breakfast", "早餐窗口", "入口左侧", "4-12 元", ["早餐"]),
				createStall("huixian-1f-rice", "盖饭窗口", "中部", "12-20 元", ["米饭"]),
				createStall("huixian-1f-noodle", "面食窗口", "东侧", "10-18 元", ["面食"]),
				createStall("huixian-1f-soup", "汤粥窗口", "北侧", "5-14 元", ["汤品"]),
				createStall("huixian-1f-drinks", "饮品窗口", "出口侧", "4-12 元", ["饮品"]),
			]),
			createDiningFloor("2f", "二层", [
				createStall("huixian-2f-hot-pot", "小火锅窗口", "西侧", "18-30 元", ["热餐"]),
				createStall("huixian-2f-bibimbap", "石锅拌饭窗口", "北侧", "15-24 元", ["米饭"]),
				createStall("huixian-2f-dumpling", "饺子馄饨窗口", "东侧", "10-18 元", ["面食"]),
				createStall("huixian-2f-light", "轻食窗口", "南侧", "12-24 元", ["轻食"]),
				createStall("huixian-2f-dessert", "甜品窗口", "出口侧", "6-16 元", ["甜品"]),
			]),
		],
		hallId: "fengtai-huixian-canteen",
		name: "汇贤食堂",
	},
	{
		campus: "丰台校区",
		floors: [
			createDiningFloor("1f", "一层", [
				createStall("juya-1f-self-service", "自选称重窗口", "入口左侧", "12-26 元", ["自选菜"]),
				createStall("juya-1f-set", "套餐窗口", "中部", "14-22 元", ["套餐"]),
				createStall("juya-1f-noodle", "粉面窗口", "东侧", "10-18 元", ["粉面"]),
				createStall("juya-1f-snack", "小吃窗口", "出口侧", "5-14 元", ["小吃"]),
				createStall("juya-1f-tea", "茶饮窗口", "南侧", "5-18 元", ["饮品"]),
			]),
			createDiningFloor("2f", "二层", [
				createStall("juya-2f-grill", "烤盘饭窗口", "西侧", "15-26 元", ["米饭"]),
				createStall("juya-2f-spicy", "麻辣烫窗口", "北侧", "15-28 元", ["热餐"]),
				createStall("juya-2f-sandwich", "简餐窗口", "东侧", "16-28 元", ["简餐"]),
				createStall("juya-2f-fruit", "水果轻食窗口", "南侧", "5-18 元", ["轻食"]),
				createStall("juya-2f-coffee", "咖啡窗口", "出口侧", "8-20 元", ["饮品"]),
			]),
		],
		hallId: "fengtai-juya-canteen",
		name: "聚雅食堂",
	},
];

const DINING_HALLS: DiningHallSummary[] = DINING_HALL_SEEDS.map((hall) => ({
	campus: hall.campus,
	floors: hall.floors.map((floor) => ({ floorId: floor.floorId, label: floor.label })),
	hallId: hall.hallId,
	name: hall.name,
}));

const DINING_FLOORS: Record<string, DiningFloorResponse> = Object.fromEntries(
	DINING_HALL_SEEDS.flatMap((hall) =>
		hall.floors.map((floor) => [
			`${hall.hallId}:${floor.floorId}`,
			{
				floor: {
					floorId: floor.floorId,
					hallId: hall.hallId,
					label: `${hall.name}${floor.label}`,
					svgAssetUrl: `/assets/dining/${hall.hallId}-${floor.floorId}.svg`,
				},
				source: DINING_SOURCE,
				stalls: floor.stalls,
			},
		]),
	),
) as Record<string, DiningFloorResponse>;

export function buildCampusExperienceService(): CampusExperienceService {
	return {
		async getDiningFloor(input) {
			const floor = DINING_FLOORS[`${input.hallId}:${input.floorId}`];
			if (!floor) {
				throw new AppApiRouteError({
					code: "dining_floor_not_found",
					message: "Dining floor projection was not found.",
					retryable: false,
					status: 404,
				});
			}
			return floor;
		},
		async getDiningHalls() {
			return { halls: DINING_HALLS };
		},
		async getMapPlace(input) {
			const place = MAP_PLACES.find((item) => item.id === input.placeId);
			if (!place) {
				throw new AppApiRouteError({
					code: "campus_place_not_found",
					message: "Campus map place projection was not found.",
					retryable: false,
					status: 404,
				});
			}
			return { place };
		},
		async getMapPlaces() {
			return {
				campus: {
					defaultCenter: CAMPUS_CENTER,
					id: "muc-campuses",
					name: "中央民族大学校区",
				},
				places: MAP_PLACES,
			};
		},
		async submitFeedback(input) {
			return {
				feedback: {
					category: input.category,
					feedbackId: createFeedbackId(input),
					receivedAt: new Date().toISOString(),
					routeContext: input.routeContext,
					status: "received",
				},
			};
		},
	};
}

export function parseFeedbackCategory(value: unknown): FeedbackCategory {
	if (
		value === "content_issue" ||
		value === "dining_issue" ||
		value === "experience_issue" ||
		value === "map_issue" ||
		value === "other"
	) {
		return value;
	}

	throw new AppApiRouteError({
		code: "validation_failed",
		details: { field: "category" },
		message: "category must be a supported feedback category.",
		retryable: false,
		status: 400,
	});
}

function createPointFeature(
	placeId: string,
	title: string,
	category: CampusMapPlaceCategory,
	coordinates: [number, number],
): CampusMapPlace["geojson"] {
	return {
		type: "Feature",
		geometry: {
			type: "Point",
			coordinates,
		},
		properties: {
			category,
			placeId,
			title,
		},
	};
}

function createMapPlace(input: {
	campus: string;
	category: CampusMapPlaceCategory;
	coordinates: [number, number];
	description: string;
	id: string;
	tags: string[];
	title: string;
}): CampusMapPlace {
	return {
		accessNote: null,
		campus: input.campus,
		category: input.category,
		description: input.description,
		geojson: createPointFeature(input.id, input.title, input.category, input.coordinates),
		id: input.id,
		sourceRefs: [`campus-map:projection:${input.id}`],
		tags: input.tags,
		title: input.title,
	};
}

function createSingleFloorHall(
	hallId: string,
	name: string,
	campus: string,
	stalls: DiningStallSeed[],
): DiningHallSeed {
	return {
		campus,
		floors: [createDiningFloor("1f", "一层", stalls)],
		hallId,
		name,
	};
}

function createDiningFloor(
	floorId: string,
	label: string,
	stalls: DiningStallSeed[],
): DiningFloorSeed {
	return { floorId, label, stalls };
}

function createStall(
	id: string,
	name: string,
	locationLabel: string,
	priceLabel: string,
	tags: string[],
): DiningStallSeed {
	return {
		id,
		locationLabel,
		name,
		priceLabel,
		tags,
	};
}

function createFeedbackId(input: SubmitFeedbackInput): string {
	const material = `${input.category}:${input.routeContext}:${input.body}`;
	let hash = 0;
	for (let index = 0; index < material.length; index += 1) {
		hash = (hash * 31 + material.charCodeAt(index)) >>> 0;
	}
	return `fb_${hash.toString(36).padStart(8, "0")}`;
}
