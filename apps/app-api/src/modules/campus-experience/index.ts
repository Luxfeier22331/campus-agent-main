import { AppApiRouteError } from "../../http";

export type CampusMapPlaceCategory = "building" | "gate" | "landmark" | "service" | "transport";
export type CampusMapFeatureLayer = "boundary" | "building" | "sport";

export interface CampusMapFeatureRef {
	fid: number;
	layer: CampusMapFeatureLayer;
	sourceId: string;
}

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
	mapFeatureRefs?: CampusMapFeatureRef[];
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

const CAMPUS_CENTER: [number, number] = [116.2145, 39.8798];
const MUC_CAMPUS_MAP_URL = "https://www.muc.edu.cn/xxgk1/xydt.htm";
const MUC_HAIDIAN_CAMPUS_MAP_IMAGE_URL =
	"https://www.muc.edu.cn/__local/F/91/AB/7FD57D5626A89FCED2B52241DFC_FD318D0B_612F3.png";

const HAIDIAN_CAMPUS_POINTS = {
	auditorium: [116.31423, 39.94947],
	artMuseum: [116.31192, 39.94955],
	basketballCourt: [116.31165, 39.94978],
	canteenAreaEast: [116.3157, 39.9522],
	canteenAreaNorth: [116.3143, 39.9534],
	canteenAreaSouth: [116.3144, 39.9512],
	canteenAreaWest: [116.3133, 39.9522],
	eastSmallGate: [116.3184, 39.95185],
	eastGate: [116.31835, 39.94735],
	hospital: [116.3125467, 39.9513664],
	library: [116.3120537, 39.9472156],
	museum: [116.31115, 39.94885],
	nanruiBuilding: [116.31655, 39.94766],
	northComplexBuilding: [116.31665, 39.9497],
	northWisdomBuilding: [116.31625, 39.9497],
	northGate: [116.3141, 39.95425],
	officeBuilding1: [116.31385, 39.94705],
	officeBuilding2: [116.31505, 39.94698],
	officeBuilding3: [116.3161, 39.94885],
	rollerSkatingGround: [116.3146, 39.95005],
	scienceEngineeringBuilding: [116.3132037, 39.9473297],
	shawGymnasium: [116.31555, 39.9534],
	socialScienceEthnicInstitute: [116.3152, 39.95035],
	southComplexBuilding: [116.3171, 39.94675],
	southGate: [116.31505, 39.94672],
	studentService: [116.3152, 39.94855],
	staffApartment14: [116.31225, 39.95015],
	staffApartment15: [116.31215, 39.94975],
	staffApartment23: [116.30975, 39.9509],
	apartmentBuilding4: [116.3156, 39.95075],
	studentApartment1: [116.3132, 39.9513],
	studentApartment2: [116.3135, 39.9507],
	studentApartment4: [116.3117, 39.9511],
	studentApartment5: [116.31165, 39.95175],
	studentApartment6: [116.3154, 39.9518],
	studentApartment7: [116.3162, 39.95125],
	studentApartment8: [116.3157, 39.95045],
	teachingBuilding10: [116.3139, 39.94955],
	teachingBuilding16: [116.31195, 39.94922],
	teachingBuilding18: [116.31025, 39.94975],
	teachingBuilding20: [116.31025, 39.9502],
	teachingBuilding21: [116.30965, 39.94835],
	tennisCourt: [116.3156, 39.94995],
	theater: [116.31435, 39.94785],
	trackFootballField: [116.31645, 39.95055],
	volleyballCourt: [116.31635, 39.94925],
	wenhuaBuilding: [116.31345, 39.94985],
	weigongcunSubway: [116.32324, 39.95792],
	westGate: [116.3089, 39.95175],
	zhonghuiBuilding: [116.3168, 39.94825],
} satisfies Record<string, [number, number]>;

const FENGTAI_CAMPUS_POINTS = {
	huixianCanteen: [116.10859555, 39.80931605],
	juyaCanteen: [116.108483, 39.8104219],
	northGate: [116.1130193, 39.813499125],
	southGate: [116.11303405, 39.80722115],
} satisfies Record<string, [number, number]>;

const MAP_PLACES: CampusMapPlace[] = [
	createOfficialHaidianMapPlace({
		category: "building",
		coordinates: HAIDIAN_CAMPUS_POINTS.library,
		description: "海淀校区图书馆，位于校园西南侧，靠近理工楼和民族博物馆。",
		id: "library",
		mapFeatureRefs: [{ fid: 849087992, layer: "building", sourceId: "haidian-campus" }],
		tags: ["学习", "自习", "借阅"],
		title: "图书馆",
	}),
	createOfficialHaidianMapPlace({
		category: "building",
		coordinates: [116.3132037, 39.9473297],
		description: "理工楼位于海淀校区南侧教学区。",
		id: "science-engineering-building",
		mapFeatureRefs: [{ fid: 849087990, layer: "building", sourceId: "haidian-campus" }],
		tags: ["上课", "教学", "理工"],
		title: "理工楼",
	}),
	createOfficialHaidianMapPlace({
		category: "gate",
		coordinates: HAIDIAN_CAMPUS_POINTS.westGate,
		description: "西校门位于海淀校区西侧，靠近中央民族大学西路。",
		id: "haidian-west-gate",
		tags: ["出入口", "交通"],
		title: "西校门",
	}),
	createOfficialHaidianMapPlace({
		category: "gate",
		coordinates: HAIDIAN_CAMPUS_POINTS.eastSmallGate,
		description: "东小门位于海淀校区东侧，靠近中关村南大街。",
		id: "haidian-east-small-gate",
		tags: ["出入口", "交通"],
		title: "东小门",
	}),
	createOfficialHaidianMapPlace({
		category: "gate",
		coordinates: HAIDIAN_CAMPUS_POINTS.northGate,
		description: "北门位于海淀校区北侧，靠近魏公街。",
		id: "haidian-north-gate",
		tags: ["出入口", "交通"],
		title: "北门",
	}),
	createOfficialHaidianMapPlace({
		category: "building",
		coordinates: HAIDIAN_CAMPUS_POINTS.staffApartment23,
		description: "23号教职工公寓位于海淀校区西侧生活区。",
		id: "haidian-staff-apartment-23",
		tags: ["公寓", "生活"],
		title: "23号教职工公寓",
	}),
	createOfficialHaidianMapPlace({
		category: "building",
		coordinates: HAIDIAN_CAMPUS_POINTS.teachingBuilding20,
		description: "20号教学楼位于海淀校区西侧教学区。",
		id: "haidian-teaching-building-20",
		tags: ["教学", "上课"],
		title: "20号教学楼",
	}),
	createOfficialHaidianMapPlace({
		category: "building",
		coordinates: HAIDIAN_CAMPUS_POINTS.teachingBuilding18,
		description: "18号教学楼位于海淀校区西侧教学区。",
		id: "haidian-teaching-building-18",
		tags: ["教学", "上课"],
		title: "18号教学楼",
	}),
	createOfficialHaidianMapPlace({
		category: "building",
		coordinates: HAIDIAN_CAMPUS_POINTS.teachingBuilding21,
		description: "21号教学楼位于海淀校区西南侧，靠近图书馆。",
		id: "haidian-teaching-building-21",
		tags: ["教学", "上课"],
		title: "21号教学楼",
	}),
	createOfficialHaidianMapPlace({
		category: "building",
		coordinates: HAIDIAN_CAMPUS_POINTS.staffApartment15,
		description: "15号教职工公寓位于海淀校区中西侧生活区。",
		id: "haidian-staff-apartment-15",
		tags: ["公寓", "生活"],
		title: "15号教职工公寓",
	}),
	createOfficialHaidianMapPlace({
		category: "building",
		coordinates: HAIDIAN_CAMPUS_POINTS.staffApartment14,
		description: "14号教职工公寓位于海淀校区中西侧生活区。",
		id: "haidian-staff-apartment-14",
		tags: ["公寓", "生活"],
		title: "14号教职工公寓",
	}),
	createOfficialHaidianMapPlace({
		category: "building",
		coordinates: HAIDIAN_CAMPUS_POINTS.teachingBuilding16,
		description: "16号教学楼位于海淀校区西侧教学区，靠近篮球场和美术馆。",
		id: "haidian-teaching-building-16",
		tags: ["教学", "上课"],
		title: "16号教学楼",
	}),
	createOfficialHaidianMapPlace({
		category: "landmark",
		coordinates: HAIDIAN_CAMPUS_POINTS.basketballCourt,
		description: "篮球场位于海淀校区西侧，靠近16号教学楼和美术馆。",
		id: "haidian-basketball-court",
		tags: ["运动", "篮球"],
		title: "篮球场",
	}),
	createOfficialHaidianMapPlace({
		category: "landmark",
		coordinates: HAIDIAN_CAMPUS_POINTS.artMuseum,
		description: "美术馆位于海淀校区西侧，靠近篮球场和16号教学楼。",
		id: "haidian-art-museum",
		tags: ["展览", "美术", "地标"],
		title: "美术馆",
	}),
	createOfficialHaidianMapPlace({
		category: "building",
		coordinates: HAIDIAN_CAMPUS_POINTS.wenhuaBuilding,
		description: "文华楼位于海淀校区中部教学区。",
		id: "wenhua-building",
		tags: ["教学", "上课"],
		title: "文华楼",
	}),
	createOfficialHaidianMapPlace({
		category: "building",
		coordinates: HAIDIAN_CAMPUS_POINTS.teachingBuilding10,
		description: "10号教学楼位于海淀校区中部，靠近大礼堂。",
		id: "haidian-teaching-building-10",
		tags: ["教学", "上课"],
		title: "10号教学楼",
	}),
	createOfficialHaidianMapPlace({
		category: "landmark",
		coordinates: HAIDIAN_CAMPUS_POINTS.auditorium,
		description: "大礼堂位于海淀校区中部，靠近10号教学楼和轮滑场地。",
		id: "auditorium",
		tags: ["活动", "地标"],
		title: "大礼堂",
	}),
	createOfficialHaidianMapPlace({
		category: "building",
		coordinates: HAIDIAN_CAMPUS_POINTS.studentApartment5,
		description: "学生5号公寓位于海淀校区北侧学生生活区。",
		id: "haidian-student-apartment-5",
		tags: ["公寓", "生活"],
		title: "学生5号公寓",
	}),
	createOfficialHaidianMapPlace({
		category: "building",
		coordinates: HAIDIAN_CAMPUS_POINTS.studentApartment4,
		description: "学生4号公寓位于海淀校区北侧学生生活区。",
		id: "haidian-student-apartment-4",
		tags: ["公寓", "生活"],
		title: "学生4号公寓",
	}),
	createOfficialHaidianMapPlace({
		category: "building",
		coordinates: HAIDIAN_CAMPUS_POINTS.apartmentBuilding4,
		description: "4号公寓楼位于海淀校区东中部生活区。",
		id: "haidian-apartment-building-4",
		tags: ["公寓", "生活"],
		title: "4号公寓楼",
	}),
	createOfficialHaidianMapPlace({
		category: "building",
		coordinates: HAIDIAN_CAMPUS_POINTS.studentApartment1,
		description: "学生1号公寓位于海淀校区中北侧学生生活区。",
		id: "haidian-student-apartment-1",
		tags: ["公寓", "生活"],
		title: "学生1号公寓",
	}),
	createOfficialHaidianMapPlace({
		category: "building",
		coordinates: HAIDIAN_CAMPUS_POINTS.studentApartment2,
		description: "学生2号公寓位于海淀校区中部学生生活区。",
		id: "haidian-student-apartment-2",
		tags: ["公寓", "生活"],
		title: "学生2号公寓",
	}),
	createOfficialHaidianMapPlace({
		category: "building",
		coordinates: HAIDIAN_CAMPUS_POINTS.studentApartment6,
		description: "学生6号公寓位于海淀校区东北侧学生生活区。",
		id: "haidian-student-apartment-6",
		tags: ["公寓", "生活"],
		title: "学生6号公寓",
	}),
	createOfficialHaidianMapPlace({
		category: "building",
		coordinates: HAIDIAN_CAMPUS_POINTS.studentApartment7,
		description: "学生7号公寓位于海淀校区东北侧学生生活区。",
		id: "haidian-student-apartment-7",
		tags: ["公寓", "生活"],
		title: "学生7号公寓",
	}),
	createOfficialHaidianMapPlace({
		category: "building",
		coordinates: HAIDIAN_CAMPUS_POINTS.studentApartment8,
		description: "学生8号公寓位于海淀校区东侧学生生活区。",
		id: "haidian-student-apartment-8",
		tags: ["公寓", "生活"],
		title: "学生8号公寓",
	}),
	createOfficialHaidianMapPlace({
		category: "building",
		coordinates: HAIDIAN_CAMPUS_POINTS.socialScienceEthnicInstitute,
		description: "社科民族研究所（6号办公楼）位于海淀校区东中部办公区。",
		id: "haidian-social-science-ethnic-institute",
		tags: ["办公", "科研"],
		title: "社科民族研究所（6号办公楼）",
	}),
	createOfficialHaidianMapPlace({
		category: "landmark",
		coordinates: HAIDIAN_CAMPUS_POINTS.rollerSkatingGround,
		description: "轮滑场地位于海淀校区中部，靠近大礼堂和网球场。",
		id: "haidian-roller-skating-ground",
		tags: ["运动", "轮滑"],
		title: "轮滑场地",
	}),
	createOfficialHaidianMapPlace({
		category: "landmark",
		coordinates: HAIDIAN_CAMPUS_POINTS.tennisCourt,
		description: "网球场位于海淀校区中东部运动区。",
		id: "haidian-tennis-court",
		tags: ["运动", "网球"],
		title: "网球场",
	}),
	createOfficialHaidianMapPlace({
		category: "building",
		coordinates: HAIDIAN_CAMPUS_POINTS.officeBuilding1,
		description: "1号办公楼位于海淀校区南侧办公区。",
		id: "haidian-office-building-1",
		tags: ["办公"],
		title: "1号办公楼",
	}),
	createOfficialHaidianMapPlace({
		category: "building",
		coordinates: HAIDIAN_CAMPUS_POINTS.officeBuilding2,
		description: "2号办公楼位于海淀校区南侧办公区。",
		id: "haidian-office-building-2",
		tags: ["办公"],
		title: "2号办公楼",
	}),
	createOfficialHaidianMapPlace({
		category: "building",
		coordinates: HAIDIAN_CAMPUS_POINTS.officeBuilding3,
		description: "3号办公楼位于海淀校区东南侧办公区。",
		id: "haidian-office-building-3",
		tags: ["办公"],
		title: "3号办公楼",
	}),
	createOfficialHaidianMapPlace({
		category: "building",
		coordinates: HAIDIAN_CAMPUS_POINTS.zhonghuiBuilding,
		description: "中慧楼（音乐厅）位于海淀校区东南侧。",
		id: "zhonghui-building",
		tags: ["教学", "音乐厅"],
		title: "中慧楼（音乐厅）",
	}),
	createOfficialHaidianMapPlace({
		category: "building",
		coordinates: HAIDIAN_CAMPUS_POINTS.nanruiBuilding,
		description: "南睿楼位于海淀校区南侧。",
		id: "nanrui-building",
		tags: ["教学", "办公"],
		title: "南睿楼",
	}),
	createOfficialHaidianMapPlace({
		category: "building",
		coordinates: HAIDIAN_CAMPUS_POINTS.northWisdomBuilding,
		description: "北智楼位于海淀校区东侧，靠近运动区。",
		id: "haidian-north-wisdom-building",
		tags: ["教学", "办公"],
		title: "北智楼",
	}),
	createOfficialHaidianMapPlace({
		category: "building",
		coordinates: HAIDIAN_CAMPUS_POINTS.northComplexBuilding,
		description: "北综合楼位于海淀校区东侧，靠近运动区。",
		id: "haidian-north-complex-building",
		tags: ["综合楼", "办公"],
		title: "北综合楼",
	}),
	createOfficialHaidianMapPlace({
		category: "building",
		coordinates: HAIDIAN_CAMPUS_POINTS.southComplexBuilding,
		description: "南综合楼位于海淀校区东南侧。",
		id: "haidian-south-complex-building",
		tags: ["综合楼", "办公"],
		title: "南综合楼",
	}),
	createOfficialHaidianMapPlace({
		category: "landmark",
		coordinates: HAIDIAN_CAMPUS_POINTS.trackFootballField,
		description: "田径场/足球场位于海淀校区东侧运动区。",
		id: "haidian-track-football-field",
		tags: ["运动", "田径", "足球"],
		title: "田径场/足球场",
	}),
	createOfficialHaidianMapPlace({
		category: "landmark",
		coordinates: HAIDIAN_CAMPUS_POINTS.volleyballCourt,
		description: "排球场位于海淀校区东侧运动区。",
		id: "haidian-volleyball-court",
		tags: ["运动", "排球"],
		title: "排球场",
	}),
	createOfficialHaidianMapPlace({
		category: "landmark",
		coordinates: HAIDIAN_CAMPUS_POINTS.shawGymnasium,
		description: "逸夫体育馆位于海淀校区北侧，靠近食堂和学生公寓区。",
		id: "shaw-gymnasium",
		tags: ["运动", "体育馆"],
		title: "逸夫体育馆",
	}),
	createMapPlace({
		campus: "海淀校区",
		category: "service",
		coordinates: HAIDIAN_CAMPUS_POINTS.studentService,
		description: "海淀校区学生事务相关服务点，靠近主教学区。",
		id: "student-service",
		tags: ["办事", "咨询"],
		title: "学生事务中心",
	}),
	createOfficialHaidianMapPlace({
		category: "gate",
		coordinates: HAIDIAN_CAMPUS_POINTS.eastGate,
		description: "海淀校区东侧出入口，靠近中关村南大街。",
		id: "east-gate",
		tags: ["出入口", "交通"],
		title: "东大门",
	}),
	createOfficialHaidianMapPlace({
		category: "landmark",
		coordinates: HAIDIAN_CAMPUS_POINTS.museum,
		description: "民族博物馆位于海淀校区西侧，靠近图书馆和教学楼区域。",
		id: "ethnic-museum",
		tags: ["展览", "参观", "地标"],
		title: "民族博物馆",
	}),
	createMapPlace({
		campus: "海淀校区",
		category: "transport",
		coordinates: HAIDIAN_CAMPUS_POINTS.weigongcunSubway,
		description: "魏公村地铁站位于海淀校区东北侧，适合作为到校接驳点。",
		id: "weigongcun-subway",
		tags: ["地铁", "通勤"],
		title: "魏公村地铁站",
	}),
	createOfficialHaidianMapPlace({
		category: "service",
		coordinates: HAIDIAN_CAMPUS_POINTS.hospital,
		description: "校医院位于海淀校区西北侧，靠近学生公寓和食堂区域。",
		id: "haidian-hospital",
		mapFeatureRefs: [{ fid: 548820883, layer: "building", sourceId: "haidian-campus" }],
		tags: ["医疗", "门诊"],
		title: "校医院",
	}),
	createOfficialHaidianMapPlace({
		category: "landmark",
		coordinates: HAIDIAN_CAMPUS_POINTS.theater,
		description: "民族剧院位于海淀校区南侧文化活动区域。",
		id: "ethnic-theater",
		mapFeatureRefs: [{ fid: 849087987, layer: "building", sourceId: "haidian-campus" }],
		tags: ["演出", "地标"],
		title: "民族剧院",
	}),
	createOfficialHaidianMapPlace({
		category: "gate",
		coordinates: HAIDIAN_CAMPUS_POINTS.southGate,
		description: "海淀校区南侧出入口，靠近中央民族大学南路。",
		id: "haidian-south-gate",
		tags: ["出入口", "交通"],
		title: "南门",
	}),
	createMapPlace({
		campus: "海淀校区",
		category: "building",
		coordinates: HAIDIAN_CAMPUS_POINTS.canteenAreaSouth,
		description: "海淀校区食堂区域，具体窗口和楼层以饭堂分布图为准。",
		id: "haidian-canteen-1",
		tags: ["食堂", "生活", "海淀"],
		title: "海淀一食堂",
	}),
	createMapPlace({
		campus: "海淀校区",
		category: "building",
		coordinates: HAIDIAN_CAMPUS_POINTS.canteenAreaWest,
		description: "海淀校区食堂区域，具体窗口和楼层以饭堂分布图为准。",
		id: "haidian-canteen-2",
		tags: ["食堂", "生活", "海淀"],
		title: "海淀二食堂",
	}),
	createMapPlace({
		campus: "海淀校区",
		category: "building",
		coordinates: HAIDIAN_CAMPUS_POINTS.canteenAreaNorth,
		description: "海淀校区食堂区域，具体窗口和楼层以饭堂分布图为准。",
		id: "haidian-canteen-3",
		tags: ["食堂", "生活", "海淀"],
		title: "海淀三食堂",
	}),
	createMapPlace({
		campus: "海淀校区",
		category: "building",
		coordinates: HAIDIAN_CAMPUS_POINTS.canteenAreaEast,
		description: "海淀校区食堂区域，具体窗口和楼层以饭堂分布图为准。",
		id: "haidian-canteen-4",
		tags: ["食堂", "生活", "海淀"],
		title: "海淀四食堂",
	}),
	createMapPlace({
		campus: "海淀校区",
		category: "building",
		coordinates: [116.3135, 39.9532],
		description: "海淀校区食堂区域，具体窗口和楼层以饭堂分布图为准。",
		id: "haidian-canteen-5",
		tags: ["食堂", "生活", "海淀"],
		title: "海淀五食堂",
	}),
	createMapPlace({
		campus: "丰台校区",
		category: "building",
		coordinates: FENGTAI_CAMPUS_POINTS.huixianCanteen,
		description: "丰台校区荟贤食堂，设一层和二层。",
		id: "fengtai-huixian-canteen",
		mapFeatureRefs: [{ fid: 41, layer: "building", sourceId: "fengtai-campus" }],
		tags: ["食堂", "生活", "丰台"],
		title: "荟贤食堂",
	}),
	createMapPlace({
		campus: "丰台校区",
		category: "building",
		coordinates: FENGTAI_CAMPUS_POINTS.juyaCanteen,
		description: "丰台校区聚雅食堂，设一层和二层。",
		id: "fengtai-juya-canteen",
		mapFeatureRefs: [{ fid: 40, layer: "building", sourceId: "fengtai-campus" }],
		tags: ["食堂", "生活", "丰台"],
		title: "聚雅食堂",
	}),
	createMapPlace({
		campus: "丰台校区",
		category: "gate",
		coordinates: FENGTAI_CAMPUS_POINTS.southGate,
		description: "丰台校区主要出入口之一。",
		id: "fengtai-main-gate",
		tags: ["出入口", "丰台"],
		title: "丰台校区主入口",
	}),
	createMapPlace({
		campus: "丰台校区",
		category: "transport",
		coordinates: FENGTAI_CAMPUS_POINTS.northGate,
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
	mapFeatureRefs?: CampusMapFeatureRef[];
	sourceRefs?: string[];
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
		...(input.mapFeatureRefs ? { mapFeatureRefs: input.mapFeatureRefs } : {}),
		sourceRefs: input.sourceRefs ?? [`campus-map:projection:${input.id}`],
		tags: input.tags,
		title: input.title,
	};
}

function createOfficialHaidianMapPlace(input: {
	category: CampusMapPlaceCategory;
	coordinates: [number, number];
	description: string;
	id: string;
	mapFeatureRefs?: CampusMapFeatureRef[];
	tags: string[];
	title: string;
}) {
	return createMapPlace({
		campus: "海淀校区",
		category: input.category,
		coordinates: input.coordinates,
		description: input.description,
		id: input.id,
		...(input.mapFeatureRefs ? { mapFeatureRefs: input.mapFeatureRefs } : {}),
		sourceRefs: [
			MUC_CAMPUS_MAP_URL,
			MUC_HAIDIAN_CAMPUS_MAP_IMAGE_URL,
			`campus-map:projection:${input.id}`,
		],
		tags: input.tags,
		title: input.title,
	});
}

function createFeedbackId(input: SubmitFeedbackInput): string {
	const material = `${input.category}:${input.routeContext}:${input.body}`;
	let hash = 0;
	for (let index = 0; index < material.length; index += 1) {
		hash = (hash * 31 + material.charCodeAt(index)) >>> 0;
	}
	return `fb_${hash.toString(36).padStart(8, "0")}`;
}
