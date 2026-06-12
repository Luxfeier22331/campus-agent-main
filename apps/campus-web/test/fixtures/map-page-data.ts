type MapPlaceCategory = "building" | "gate" | "landmark" | "service" | "transport";
type MapFeatureLayer = "building" | "sport";

export function createApiPlace(input: {
	campus: "丰台校区" | "海淀校区";
	category?: MapPlaceCategory;
	coordinates: [number, number];
	description?: string;
	id: string;
	mapFeatureRefs?: Array<{ fid: number; layer: MapFeatureLayer; sourceId: string }>;
	tags?: string[];
	title: string;
}) {
	const category = input.category ?? "building";
	return {
		accessNote: null,
		campus: input.campus,
		category,
		description: input.description ?? `${input.campus}${input.title}。`,
		geojson: {
			geometry: { coordinates: input.coordinates, type: "Point" },
			properties: { category, placeId: input.id, title: input.title },
			type: "Feature",
		},
		id: input.id,
		...(input.mapFeatureRefs ? { mapFeatureRefs: input.mapFeatureRefs } : {}),
		sourceRefs: [`campus-map:projection:${input.id}`],
		tags: input.tags ?? ["食堂", "生活"],
		title: input.title,
	};
}

export const mapPagePlaces = [
	createApiPlace({
		campus: "海淀校区",
		coordinates: [116.3211, 39.9524],
		description: "图书馆与自习、借阅相关服务的主要位置。",
		id: "library",
		mapFeatureRefs: [{ fid: 849087992, layer: "building", sourceId: "haidian-campus" }],
		tags: ["学习"],
		title: "图书馆",
	}),
	createApiPlace({
		campus: "海淀校区",
		category: "service",
		coordinates: [116.3222, 39.9515],
		description: "学生事务相关位置。",
		id: "student-service",
		tags: ["办事"],
		title: "学生事务中心",
	}),
	createApiPlace({
		campus: "丰台校区",
		coordinates: [116.10859555, 39.80931605],
		description: "丰台校区荟贤食堂，设一层和二层。",
		id: "fengtai-huixian-canteen",
		mapFeatureRefs: [{ fid: 41, layer: "building", sourceId: "fengtai-campus" }],
		tags: ["食堂", "生活"],
		title: "荟贤食堂",
	}),
	{
		accessNote: "从东门进入后沿主路步行约 3 分钟。",
		campus: "丰台校区",
		category: "transport",
		description: "丰台校区通勤和到访的主要入口。",
		geojson: {
			geometry: { coordinates: [116.11303405, 39.80722115], type: "Point" },
			properties: { category: "transport", placeId: "fengtai-east-gate", title: "丰台东门" },
			type: "Feature",
		},
		id: "fengtai-east-gate",
		sourceRefs: ["campus-map:projection:fengtai-east-gate"],
		tags: ["出入口", "交通"],
		title: "丰台东门",
	},
	createApiPlace({
		campus: "丰台校区",
		coordinates: [116.1139987, 39.81129792],
		description: "博雅楼位于丰台校区东侧教学区。",
		id: "fengtai-boya-building",
		mapFeatureRefs: [{ fid: 6, layer: "building", sourceId: "fengtai-campus" }],
		tags: ["教学"],
		title: "博雅楼",
	}),
	createApiPlace({
		campus: "丰台校区",
		coordinates: [116.10618303, 39.81067803],
		description: "静园一号楼位于丰台校区西侧生活区。",
		id: "fengtai-jingyuan-building-1",
		mapFeatureRefs: [{ fid: 9, layer: "building", sourceId: "fengtai-campus" }],
		tags: ["宿舍", "生活", "静园"],
		title: "静园一号楼",
	}),
	createApiPlace({
		campus: "丰台校区",
		category: "gate",
		coordinates: [116.11303405, 39.80722115],
		description: "丰台校区南门，位于校区南侧。",
		id: "fengtai-main-gate",
		mapFeatureRefs: [
			{ fid: 60, layer: "building", sourceId: "fengtai-campus" },
			{ fid: 61, layer: "building", sourceId: "fengtai-campus" },
		],
		tags: ["出入口"],
		title: "丰台南门",
	}),
];

export const featureInteractionMapPlaces = [
	createApiPlace({
		campus: "海淀校区",
		coordinates: [116.3120537, 39.9472156],
		id: "library",
		mapFeatureRefs: [{ fid: 849087992, layer: "building", sourceId: "haidian-campus" }],
		title: "图书馆",
	}),
	createApiPlace({
		campus: "丰台校区",
		coordinates: [116.10859555, 39.80931605],
		id: "fengtai-huixian-canteen",
		mapFeatureRefs: [{ fid: 41, layer: "building", sourceId: "fengtai-campus" }],
		title: "荟贤食堂",
	}),
	createApiPlace({
		campus: "丰台校区",
		coordinates: [116.108483, 39.8104219],
		id: "fengtai-juya-canteen",
		mapFeatureRefs: [{ fid: 40, layer: "building", sourceId: "fengtai-campus" }],
		title: "聚雅食堂",
	}),
	createApiPlace({
		campus: "丰台校区",
		coordinates: [116.10950564, 39.80796978],
		id: "fengtai-basketball-court",
		mapFeatureRefs: [{ fid: 2, layer: "sport", sourceId: "fengtai-campus" }],
		title: "篮球场",
	}),
	createApiPlace({
		campus: "丰台校区",
		coordinates: [116.1139987, 39.81129792],
		id: "fengtai-boya-building",
		mapFeatureRefs: [{ fid: 6, layer: "building", sourceId: "fengtai-campus" }],
		title: "博雅楼",
	}),
	createApiPlace({
		campus: "丰台校区",
		coordinates: [116.11303405, 39.80722115],
		id: "fengtai-main-gate",
		mapFeatureRefs: [
			{ fid: 60, layer: "building", sourceId: "fengtai-campus" },
			{ fid: 61, layer: "building", sourceId: "fengtai-campus" },
		],
		title: "丰台南门",
	}),
	{
		accessNote: "从东门进入后沿主路步行约 3 分钟。",
		campus: "丰台校区",
		category: "transport",
		description: "丰台校区通勤和到访的主要入口。",
		geojson: {
			geometry: { coordinates: [116.11303405, 39.80722115], type: "Point" },
			properties: { category: "transport", placeId: "fengtai-east-gate", title: "丰台东门" },
			type: "Feature",
		},
		id: "fengtai-east-gate",
		sourceRefs: ["campus-map:projection:fengtai-east-gate"],
		tags: ["出入口", "交通"],
		title: "丰台东门",
	},
];
