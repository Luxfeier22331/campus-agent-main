import type { DiningFloorplanManifestInput } from "./index";
import { renderStructuralFloorplan, type StructuralFloorplanShape } from "./structural-floorplan";

type HaidianErSiFloorId = "haidian-canteen-2" | "haidian-canteen-4";

type HaidianErSiFloorShape = StructuralFloorplanShape<HaidianErSiFloorId>;

const TOP_LINE_WINDOWS = [
	{ x: 420, y: 92 },
	{ x: 494, y: 92 },
	{ x: 568, y: 92 },
	{ x: 642, y: 92 },
	{ x: 716, y: 92 },
	{ x: 790, y: 92 },
	{ x: 864, y: 92 },
	{ x: 938, y: 92 },
] as const;

const HAIDIAN_ER_SI_FLOOR_SHAPES: Record<HaidianErSiFloorId, HaidianErSiFloorShape> = {
	"haidian-canteen-2": {
		circulation: ["M166 424H1128", "M360 226V520", "M1048 222V548"],
		entrances: [
			{ height: 22, label: "西侧", width: 62, x: 172, y: 622 },
			{ height: 22, label: "中间", width: 62, x: 610, y: 622 },
			{ height: 22, label: "东侧", width: 62, x: 1038, y: 622 },
		],
		floorId: "haidian-canteen-2",
		outerShell:
			"M156 232H346C392 232 420 188 448 120H1036C1054 184 1088 230 1130 232H1190V556C1190 610 1148 650 1094 650H1010V528H434V650H214C180 650 156 626 156 592Z",
		rects: [
			{ className: "service", height: 48, width: 44, x: 334, y: 358 },
			{ className: "service", height: 48, width: 44, x: 1030, y: 358 },
			{ className: "core", height: 228, width: 560, x: 434, y: 302 },
		],
		title: "海淀二食堂",
		walls: [
			"M346 232V650M434 302H994M434 528H994M994 302V650",
			"M226 232V520M282 232V520M1036 232V560M1092 232V560M1148 280V560",
			"M494 120V302M568 120V302M642 120V302M716 120V302M790 120V302M864 120V302M938 120V302",
			"M420 120V302M1012 120V302",
			"M156 424H346M994 424H1190",
		],
		windows: [
			...leftStackWindows(1, 148, 560),
			{ anchorId: "window-05", height: 42, label: "五号窗口", width: 88, x: 206, y: 178 },
			{ anchorId: "window-06", height: 42, label: "六号窗口", width: 88, x: 272, y: 178 },
			{ anchorId: "window-07", height: 42, label: "七号窗口", width: 88, x: 334, y: 178 },
			{ anchorId: "window-08", height: 42, label: "八号窗口", width: 88, x: 384, y: 248 },
			{ anchorId: "window-09", height: 42, label: "九号窗口", width: 88, x: 398, y: 346 },
			...topLineWindows(10, TOP_LINE_WINDOWS),
			{ anchorId: "window-18", height: 42, label: "十八号窗口", width: 88, x: 1010, y: 248 },
			{ anchorId: "window-19", height: 42, label: "十九号窗口", width: 88, x: 1070, y: 248 },
			{ anchorId: "window-20", height: 42, label: "二十号窗口", width: 88, x: 1130, y: 248 },
			{ anchorId: "window-21", height: 42, label: "二十一号窗口", width: 88, x: 1094, y: 334 },
			{ anchorId: "window-22", height: 42, label: "二十二号窗口", width: 88, x: 1114, y: 428 },
			{ anchorId: "window-23", height: 42, label: "二十三号窗口", width: 88, x: 1114, y: 492 },
			{ anchorId: "window-24", height: 42, label: "二十四号窗口", width: 88, x: 1114, y: 556 },
			{ anchorId: "window-25", height: 42, label: "二十五号窗口", width: 88, x: 1114, y: 620 },
		],
	},
	"haidian-canteen-4": {
		circulation: ["M160 392H1130", "M358 212V506", "M1048 210V532"],
		entrances: [
			{ height: 22, label: "西侧", width: 62, x: 210, y: 622 },
			{ height: 22, label: "中间", width: 62, x: 610, y: 622 },
			{ height: 22, label: "东侧", width: 62, x: 1040, y: 622 },
		],
		floorId: "haidian-canteen-4",
		outerShell:
			"M156 228H344C390 228 420 188 448 120H1036C1054 184 1088 226 1130 228H1190V520C1190 586 1142 632 1078 632H1010V500H434V632H214C180 632 156 608 156 574Z",
		rects: [
			{ className: "service", height: 48, width: 44, x: 332, y: 340 },
			{ className: "service", height: 48, width: 44, x: 1030, y: 340 },
			{ className: "core", height: 198, width: 560, x: 434, y: 302 },
		],
		title: "海淀四食堂",
		walls: [
			"M344 228V632M434 302H994M434 500H994M994 302V632",
			"M226 228V472M282 228V472M1036 228V532M1092 228V532M1148 280V532",
			"M494 120V302M568 120V302M642 120V302M716 120V302M790 120V302M864 120V302M938 120V302",
			"M420 120V302M1012 120V302",
			"M156 392H344M994 392H1190",
		],
		windows: [
			{ anchorId: "window-01", height: 42, label: "一号窗口", width: 88, x: 92, y: 498 },
			{ anchorId: "window-02", height: 42, label: "二号窗口", width: 88, x: 92, y: 382 },
			{ anchorId: "window-03", height: 42, label: "三号窗口", width: 88, x: 206, y: 178 },
			{ anchorId: "window-04", height: 42, label: "四号窗口", width: 88, x: 272, y: 178 },
			{ anchorId: "window-05", height: 42, label: "五号窗口", width: 88, x: 334, y: 178 },
			...topLineWindows(6, TOP_LINE_WINDOWS),
			{ anchorId: "window-14", height: 42, label: "十四号窗口", width: 88, x: 1020, y: 248 },
			{ anchorId: "window-15", height: 42, label: "十五号窗口", width: 88, x: 1080, y: 248 },
			{ anchorId: "window-16", height: 42, label: "十六号窗口", width: 88, x: 1140, y: 248 },
			{ anchorId: "window-17", height: 42, label: "十七号窗口", width: 88, x: 1120, y: 334 },
			{ anchorId: "window-18", height: 42, label: "十八号窗口", width: 88, x: 1120, y: 430 },
			{ anchorId: "window-19", height: 42, label: "十九号窗口", width: 88, x: 1120, y: 518 },
		],
	},
};

export function haidianErSiFloorplanInput(input: {
	floorId: HaidianErSiFloorId;
	sha256: `sha256:${string}`;
}): DiningFloorplanManifestInput {
	const shape = HAIDIAN_ER_SI_FLOOR_SHAPES[input.floorId];
	return {
		anchorInventory: shape.windows.map((window) => ({
			anchorId: window.anchorId,
			label: window.label,
			role: "window" as const,
		})),
		floorId: input.floorId,
		floorplanId: `floorplan:${input.floorId}:${input.floorId}`,
		hallId: input.floorId,
		sha256: input.sha256,
		svgAssetUrl: `/assets/dining/${input.floorId}.svg`,
		svgMarkup: renderStructuralFloorplan(shape),
	};
}

function leftStackWindows(
	start: number,
	x: number,
	bottomY: number,
): Array<{ anchorId: string; height: number; label: string; width: number; x: number; y: number }> {
	return Array.from({ length: 4 }, (_, index) => {
		const number = start + index;
		return {
			anchorId: `window-${String(number).padStart(2, "0")}`,
			height: 42,
			label: `${toChineseWindowNumber(number)}号窗口`,
			width: 88,
			x,
			y: bottomY - index * 66,
		};
	});
}

function topLineWindows(
	start: number,
	points: ReadonlyArray<{ x: number; y: number }>,
): Array<{ anchorId: string; height: number; label: string; width: number; x: number; y: number }> {
	return points.map((point, index) => {
		const number = start + index;
		return {
			anchorId: `window-${String(number).padStart(2, "0")}`,
			height: 42,
			label: `${toChineseWindowNumber(number)}号窗口`,
			width: 88,
			x: point.x,
			y: point.y,
		};
	});
}

function toChineseWindowNumber(value: number): string {
	const labels = [
		"一",
		"二",
		"三",
		"四",
		"五",
		"六",
		"七",
		"八",
		"九",
		"十",
		"十一",
		"十二",
		"十三",
		"十四",
		"十五",
		"十六",
		"十七",
		"十八",
		"十九",
		"二十",
		"二十一",
		"二十二",
		"二十三",
		"二十四",
		"二十五",
	] as const;
	return labels[value - 1] ?? String(value);
}
