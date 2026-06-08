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
	{
		accessNote: null,
		campus: "海淀校区",
		category: "building",
		description: "图书馆与自习、借阅相关服务的主要位置。",
		geojson: createPointFeature("library", "图书馆", "building", [116.3211, 39.9524]),
		id: "library",
		sourceRefs: ["campus-map:projection:library"],
		tags: ["学习", "自习", "借阅"],
		title: "图书馆",
	},
	{
		accessNote: null,
		campus: "海淀校区",
		category: "service",
		description: "学生事务、办事咨询与材料提交常用地点。",
		geojson: createPointFeature("student-service", "学生事务中心", "service", [116.3222, 39.9515]),
		id: "student-service",
		sourceRefs: ["campus-map:projection:student-service"],
		tags: ["办事", "咨询"],
		title: "学生事务中心",
	},
	{
		accessNote: null,
		campus: "海淀校区",
		category: "gate",
		description: "常用出入口之一，适合定位到校路线。",
		geojson: createPointFeature("east-gate", "东门", "gate", [116.3234, 39.9512]),
		id: "east-gate",
		sourceRefs: ["campus-map:projection:east-gate"],
		tags: ["出入口", "交通"],
		title: "东门",
	},
];

const DINING_HALLS: DiningHallSummary[] = [
	{
		campus: "海淀校区",
		floors: [
			{ floorId: "1f", label: "一层" },
			{ floorId: "2f", label: "二层" },
		],
		hallId: "north-canteen",
		name: "北区食堂",
	},
	{
		campus: "海淀校区",
		floors: [{ floorId: "1f", label: "一层" }],
		hallId: "south-canteen",
		name: "南区食堂",
	},
];

const DINING_FLOORS: Record<string, DiningFloorResponse> = {
	"north-canteen:1f": {
		floor: {
			floorId: "1f",
			hallId: "north-canteen",
			label: "北区食堂一层",
			svgAssetUrl: "/assets/dining/north-canteen-1f.svg",
		},
		source: {
			label: "校园食堂平面图整理",
			updatedAt: "2026-06-01T00:00:00.000Z",
		},
		stalls: [
			{
				id: "rice-bowl",
				locationLabel: "入口左侧",
				name: "盖饭窗口",
				priceLabel: "12-18 元",
				tags: ["主食", "热餐"],
			},
			{
				id: "noodle",
				locationLabel: "中部东侧",
				name: "面食窗口",
				priceLabel: "10-16 元",
				tags: ["面食"],
			},
			{
				id: "halal",
				locationLabel: "北侧",
				name: "清真窗口",
				priceLabel: "12-20 元",
				tags: ["清真"],
			},
		],
	},
};

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
					id: "haidian",
					name: "海淀校区",
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

function createFeedbackId(input: SubmitFeedbackInput): string {
	const material = `${input.category}:${input.routeContext}:${input.body}`;
	let hash = 0;
	for (let index = 0; index < material.length; index += 1) {
		hash = (hash * 31 + material.charCodeAt(index)) >>> 0;
	}
	return `fb_${hash.toString(36).padStart(8, "0")}`;
}
