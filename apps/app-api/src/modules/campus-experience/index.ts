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

export function buildCampusExperienceService(): CampusExperienceService {
	return {
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

function createFeedbackId(input: SubmitFeedbackInput): string {
	const material = `${input.category}:${input.routeContext}:${input.body}`;
	let hash = 0;
	for (let index = 0; index < material.length; index += 1) {
		hash = (hash * 31 + material.charCodeAt(index)) >>> 0;
	}
	return `fb_${hash.toString(36).padStart(8, "0")}`;
}
