import { createFengtaiFeatureMapPlace } from "./map-place-factory";
import type { CampusMapPlace } from "./types";

const FENGTAI_EXTENSION_POINTS = {
	boyaBuilding: [116.1139987, 39.81129792],
	commercialZone: [116.10599203, 39.80936525],
	jingyuanBuilding1: [116.10618303, 39.81067803],
	jingyuanBuilding2: [116.10726898, 39.81049298],
	jingyuanBuilding3: [116.10604724, 39.81012656],
	jingyuanBuilding4: [116.10718656, 39.80969036],
	jingyuanBuilding5: [116.10606823, 39.8096247],
	jingyuanBuilding6: [116.10696123, 39.80887375],
	jingyuanBuilding7: [116.10602302, 39.80895092],
	jingyuanBuilding8: [116.10698609, 39.80801328],
	jingyuanBuilding9: [116.10583952, 39.80824191],
	jingyuanBuilding10: [116.10577941, 39.80770751],
	northGate: [116.1130193, 39.813499125],
	rixinBuildingCafe: [116.11217045, 39.80980446],
	southGate: [116.11303405, 39.80722115],
	wisdomCenter: [116.11200086, 39.81164646],
	womenBathhouse: [116.10705164, 39.80931028],
} satisfies Record<string, [number, number]>;

function createFengtaiJingyuanMapPlaces(): CampusMapPlace[] {
	return [
		{
			fid: 9,
			key: "1",
			point: FENGTAI_EXTENSION_POINTS.jingyuanBuilding1,
			title: "静园一号楼",
		},
		{
			fid: 22,
			key: "2",
			point: FENGTAI_EXTENSION_POINTS.jingyuanBuilding2,
			title: "静园二号楼",
		},
		{
			fid: 8,
			key: "3",
			point: FENGTAI_EXTENSION_POINTS.jingyuanBuilding3,
			title: "静园三号楼",
		},
		{
			fid: 21,
			key: "4",
			point: FENGTAI_EXTENSION_POINTS.jingyuanBuilding4,
			title: "静园四号楼",
		},
		{
			fid: 10,
			key: "5",
			point: FENGTAI_EXTENSION_POINTS.jingyuanBuilding5,
			title: "静园五号楼",
		},
		{
			fid: 18,
			key: "6",
			point: FENGTAI_EXTENSION_POINTS.jingyuanBuilding6,
			title: "静园六号楼",
		},
		{
			fid: 13,
			key: "7",
			point: FENGTAI_EXTENSION_POINTS.jingyuanBuilding7,
			title: "静园七号楼",
		},
		{
			fid: 17,
			key: "8",
			point: FENGTAI_EXTENSION_POINTS.jingyuanBuilding8,
			title: "静园八号楼",
		},
		{
			fid: 15,
			key: "9",
			point: FENGTAI_EXTENSION_POINTS.jingyuanBuilding9,
			title: "静园九号楼",
		},
		{
			fid: 16,
			key: "10",
			point: FENGTAI_EXTENSION_POINTS.jingyuanBuilding10,
			title: "静园十号楼",
		},
	].map((building) =>
		createFengtaiFeatureMapPlace({
			category: "building",
			coordinates: building.point,
			description: `${building.title}位于丰台校区西侧生活区。`,
			id: `fengtai-jingyuan-building-${building.key}`,
			mapFeatureRefs: [{ fid: building.fid, layer: "building", sourceId: "fengtai-campus" }],
			tags: ["宿舍", "生活", "静园", "丰台"],
			title: building.title,
		}),
	);
}

export const FENGTAI_MAP_PLACE_EXTENSIONS: CampusMapPlace[] = [
	createFengtaiFeatureMapPlace({
		category: "building",
		coordinates: FENGTAI_EXTENSION_POINTS.boyaBuilding,
		description: "博雅楼位于丰台校区东侧教学区。",
		id: "fengtai-boya-building",
		mapFeatureRefs: [{ fid: 6, layer: "building", sourceId: "fengtai-campus" }],
		tags: ["教学", "丰台"],
		title: "博雅楼",
	}),
	createFengtaiFeatureMapPlace({
		category: "building",
		coordinates: FENGTAI_EXTENSION_POINTS.rixinBuildingCafe,
		description: "日新楼与咖啡厅位于丰台校区中东部。",
		id: "fengtai-rixin-building-cafe",
		mapFeatureRefs: [{ fid: 48, layer: "building", sourceId: "fengtai-campus" }],
		tags: ["学习", "咖啡", "丰台"],
		title: "日新楼与咖啡厅",
	}),
	createFengtaiFeatureMapPlace({
		category: "service",
		coordinates: FENGTAI_EXTENSION_POINTS.commercialZone,
		description: "商业区位于丰台校区西南侧生活区。",
		id: "fengtai-commercial-zone",
		mapFeatureRefs: [
			{ fid: 11, layer: "building", sourceId: "fengtai-campus" },
			{ fid: 12, layer: "building", sourceId: "fengtai-campus" },
		],
		tags: ["商业", "生活", "丰台"],
		title: "商业区",
	}),
	createFengtaiFeatureMapPlace({
		category: "service",
		coordinates: FENGTAI_EXTENSION_POINTS.womenBathhouse,
		description: "女生浴室位于丰台校区西南侧生活区。",
		id: "fengtai-women-bathhouse",
		mapFeatureRefs: [
			{ fid: 19, layer: "building", sourceId: "fengtai-campus" },
			{ fid: 20, layer: "building", sourceId: "fengtai-campus" },
		],
		tags: ["浴室", "生活", "丰台"],
		title: "女生浴室",
	}),
	createFengtaiFeatureMapPlace({
		category: "building",
		coordinates: FENGTAI_EXTENSION_POINTS.wisdomCenter,
		description: "智慧中心位于丰台校区中北侧。",
		id: "fengtai-wisdom-center",
		mapFeatureRefs: [{ fid: 5, layer: "building", sourceId: "fengtai-campus" }],
		tags: ["学习", "丰台"],
		title: "智慧中心",
	}),
	...createFengtaiJingyuanMapPlaces(),
	createFengtaiFeatureMapPlace({
		category: "gate",
		coordinates: FENGTAI_EXTENSION_POINTS.southGate,
		description: "丰台校区南门，位于校区南侧。",
		id: "fengtai-main-gate",
		mapFeatureRefs: [
			{ fid: 60, layer: "building", sourceId: "fengtai-campus" },
			{ fid: 61, layer: "building", sourceId: "fengtai-campus" },
		],
		tags: ["出入口", "丰台"],
		title: "丰台南门",
	}),
	createFengtaiFeatureMapPlace({
		category: "gate",
		coordinates: FENGTAI_EXTENSION_POINTS.northGate,
		description: "丰台校区北门，位于校区北侧。",
		id: "fengtai-north-gate",
		mapFeatureRefs: [
			{ fid: 57, layer: "building", sourceId: "fengtai-campus" },
			{ fid: 58, layer: "building", sourceId: "fengtai-campus" },
		],
		tags: ["出入口", "丰台"],
		title: "丰台北门",
	}),
];
