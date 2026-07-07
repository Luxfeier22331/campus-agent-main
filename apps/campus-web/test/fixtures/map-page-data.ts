type MapPlaceCategory = "building" | "gate" | "landmark" | "service" | "transport";
type MapFeatureLayer = "building" | "sport";

const SAMPLE_COORDINATES = {
	canteenA: [120.0001, 30.0001],
	canteenB: [120.0002, 30.0002],
	dorm1: [120.0003, 30.0003],
	dorm2: [120.0004, 30.0004],
	dorm3: [120.0005, 30.0005],
	dorm4: [120.0006, 30.0006],
	dorm5: [120.0007, 30.0007],
	dorm6: [120.0008, 30.0008],
	apartment: [120.0009, 30.0009],
	eastGate: [120.001, 30.001],
	library: [121.0001, 31.0001],
	service: [121.0002, 31.0002],
	southGate: [120.0011, 30.0011],
	sport: [120.0012, 30.0012],
	teaching: [120.0013, 30.0013],
} as const satisfies Record<string, [number, number]>;

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
		coordinates: SAMPLE_COORDINATES.library,
		description: "示例学习空间位置。",
		id: "sample-library",
		mapFeatureRefs: [{ fid: 101, layer: "building", sourceId: "haidian-campus" }],
		tags: ["学习"],
		title: "示例图书馆",
	}),
	createApiPlace({
		campus: "海淀校区",
		category: "service",
		coordinates: SAMPLE_COORDINATES.service,
		description: "示例学生服务位置。",
		id: "sample-service-center",
		tags: ["办事"],
		title: "示例服务中心",
	}),
	createApiPlace({
		campus: "丰台校区",
		coordinates: SAMPLE_COORDINATES.canteenA,
		description: "示例校区一号餐饮位置。",
		id: "sample-canteen-a",
		mapFeatureRefs: [{ fid: 40, layer: "building", sourceId: "fengtai-campus" }],
		tags: ["食堂", "生活"],
		title: "示例一食堂",
	}),
	createApiPlace({
		campus: "丰台校区",
		coordinates: SAMPLE_COORDINATES.canteenB,
		description: "示例校区二号餐饮位置。",
		id: "sample-canteen-b",
		mapFeatureRefs: [{ fid: 41, layer: "building", sourceId: "fengtai-campus" }],
		tags: ["食堂", "生活"],
		title: "示例二食堂",
	}),
	{
		accessNote: "从示例入口进入后沿主路步行约 3 分钟。",
		campus: "丰台校区",
		category: "transport",
		description: "示例校区通勤和到访的主要入口。",
		geojson: {
			geometry: { coordinates: SAMPLE_COORDINATES.eastGate, type: "Point" },
			properties: { category: "transport", placeId: "sample-east-gate", title: "示例东门" },
			type: "Feature",
		},
		id: "sample-east-gate",
		sourceRefs: ["campus-map:projection:sample-east-gate"],
		tags: ["出入口", "交通"],
		title: "示例东门",
	},
	createApiPlace({
		campus: "丰台校区",
		coordinates: SAMPLE_COORDINATES.teaching,
		description: "示例教学楼位置。",
		id: "sample-teaching-building",
		mapFeatureRefs: [{ fid: 6, layer: "building", sourceId: "fengtai-campus" }],
		tags: ["教学"],
		title: "示例教学楼",
	}),
	createApiPlace({
		campus: "丰台校区",
		category: "landmark",
		coordinates: SAMPLE_COORDINATES.sport,
		description: "示例运动场位置。",
		id: "sample-sport-field",
		mapFeatureRefs: [{ fid: 2, layer: "sport", sourceId: "fengtai-campus" }],
		tags: ["运动", "篮球"],
		title: "示例运动场",
	}),
	createApiPlace({
		campus: "丰台校区",
		category: "service",
		coordinates: [120.0014, 30.0014],
		description: "示例生活服务位置。",
		id: "sample-bathhouse",
		mapFeatureRefs: [
			{ fid: 19, layer: "building", sourceId: "fengtai-campus" },
			{ fid: 20, layer: "building", sourceId: "fengtai-campus" },
		],
		tags: ["浴室", "生活"],
		title: "示例浴室",
	}),
	createApiPlace({
		campus: "丰台校区",
		coordinates: SAMPLE_COORDINATES.dorm1,
		description: "示例宿舍区一号楼。",
		id: "sample-dorm-1",
		mapFeatureRefs: [{ fid: 9, layer: "building", sourceId: "fengtai-campus" }],
		tags: ["宿舍", "生活", "静园"],
		title: "静园一号楼",
	}),
	createApiPlace({
		campus: "丰台校区",
		coordinates: SAMPLE_COORDINATES.dorm2,
		description: "示例宿舍区二号楼。",
		id: "sample-dorm-2",
		mapFeatureRefs: [{ fid: 10, layer: "building", sourceId: "fengtai-campus" }],
		tags: ["宿舍", "生活", "静园"],
		title: "静园二号楼",
	}),
	createApiPlace({
		campus: "丰台校区",
		coordinates: SAMPLE_COORDINATES.dorm3,
		description: "示例宿舍区三号楼。",
		id: "sample-dorm-3",
		mapFeatureRefs: [{ fid: 11, layer: "building", sourceId: "fengtai-campus" }],
		tags: ["宿舍", "生活", "静园"],
		title: "静园三号楼",
	}),
	createApiPlace({
		campus: "丰台校区",
		coordinates: SAMPLE_COORDINATES.dorm4,
		description: "示例宿舍区四号楼。",
		id: "sample-dorm-4",
		mapFeatureRefs: [{ fid: 12, layer: "building", sourceId: "fengtai-campus" }],
		tags: ["宿舍", "生活", "静园"],
		title: "静园四号楼",
	}),
	createApiPlace({
		campus: "丰台校区",
		coordinates: SAMPLE_COORDINATES.dorm5,
		description: "示例宿舍区五号楼。",
		id: "sample-dorm-5",
		mapFeatureRefs: [{ fid: 13, layer: "building", sourceId: "fengtai-campus" }],
		tags: ["宿舍", "生活", "静园"],
		title: "静园五号楼",
	}),
	createApiPlace({
		campus: "丰台校区",
		coordinates: SAMPLE_COORDINATES.dorm6,
		description: "示例宿舍区六号楼。",
		id: "sample-dorm-6",
		mapFeatureRefs: [{ fid: 14, layer: "building", sourceId: "fengtai-campus" }],
		tags: ["宿舍", "生活", "静园"],
		title: "静园六号楼",
	}),
	createApiPlace({
		campus: "丰台校区",
		category: "service",
		coordinates: SAMPLE_COORDINATES.apartment,
		description: "示例公寓服务位置。",
		id: "sample-apartment-zone",
		mapFeatureRefs: [{ fid: 21, layer: "building", sourceId: "fengtai-campus" }],
		tags: ["公寓", "生活", "丰台"],
		title: "示例公寓区",
	}),
	createApiPlace({
		campus: "丰台校区",
		category: "gate",
		coordinates: SAMPLE_COORDINATES.southGate,
		description: "示例校区南侧入口。",
		id: "sample-south-gate",
		mapFeatureRefs: [
			{ fid: 60, layer: "building", sourceId: "fengtai-campus" },
			{ fid: 61, layer: "building", sourceId: "fengtai-campus" },
		],
		tags: ["出入口"],
		title: "示例南门",
	}),
];

export const featureInteractionMapPlaces = [
	createApiPlace({
		campus: "海淀校区",
		coordinates: SAMPLE_COORDINATES.library,
		id: "sample-library",
		mapFeatureRefs: [{ fid: 101, layer: "building", sourceId: "haidian-campus" }],
		title: "示例图书馆",
	}),
	createApiPlace({
		campus: "丰台校区",
		coordinates: SAMPLE_COORDINATES.canteenB,
		id: "sample-canteen-b",
		mapFeatureRefs: [{ fid: 41, layer: "building", sourceId: "fengtai-campus" }],
		title: "示例二食堂",
	}),
	createApiPlace({
		campus: "丰台校区",
		coordinates: SAMPLE_COORDINATES.canteenA,
		id: "sample-canteen-a",
		mapFeatureRefs: [{ fid: 40, layer: "building", sourceId: "fengtai-campus" }],
		title: "示例一食堂",
	}),
	createApiPlace({
		campus: "丰台校区",
		coordinates: SAMPLE_COORDINATES.sport,
		id: "sample-sport-field",
		mapFeatureRefs: [{ fid: 2, layer: "sport", sourceId: "fengtai-campus" }],
		title: "示例运动场",
	}),
	createApiPlace({
		campus: "丰台校区",
		coordinates: SAMPLE_COORDINATES.teaching,
		id: "sample-teaching-building",
		mapFeatureRefs: [{ fid: 6, layer: "building", sourceId: "fengtai-campus" }],
		title: "示例教学楼",
	}),
	createApiPlace({
		campus: "丰台校区",
		coordinates: SAMPLE_COORDINATES.southGate,
		id: "sample-south-gate",
		mapFeatureRefs: [
			{ fid: 60, layer: "building", sourceId: "fengtai-campus" },
			{ fid: 61, layer: "building", sourceId: "fengtai-campus" },
		],
		title: "示例南门",
	}),
	{
		accessNote: "从示例入口进入后沿主路步行约 3 分钟。",
		campus: "丰台校区",
		category: "transport",
		description: "示例校区通勤和到访的主要入口。",
		geojson: {
			geometry: { coordinates: SAMPLE_COORDINATES.eastGate, type: "Point" },
			properties: { category: "transport", placeId: "sample-east-gate", title: "示例东门" },
			type: "Feature",
		},
		id: "sample-east-gate",
		sourceRefs: ["campus-map:projection:sample-east-gate"],
		tags: ["出入口", "交通"],
		title: "示例东门",
	},
];
