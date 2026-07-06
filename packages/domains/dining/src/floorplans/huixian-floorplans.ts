import type { DiningFloorplanManifestInput } from "./index";
import { renderStructuralFloorplan, type StructuralFloorplanShape } from "./structural-floorplan";

type HuixianFloorId = "fengtai-huixian-canteen-1f" | "fengtai-huixian-canteen-2f";

type HuixianFloorShape = StructuralFloorplanShape<HuixianFloorId>;

const HUIXIAN_FLOOR_SHAPES: Record<HuixianFloorId, HuixianFloorShape> = {
	"fengtai-huixian-canteen-1f": {
		circulation: ["M392 252V620H998", "M552 254V620", "M552 254H970V618"],
		entrances: [
			{ height: 24, label: "入口", width: 58, x: 370, y: 674 },
			{ height: 24, label: "入口", width: 58, x: 724, y: 674 },
			{ height: 24, label: "入口", width: 58, x: 1020, y: 282 },
		],
		floorId: "fengtai-huixian-canteen-1f",
		outerShell:
			"M310 132H522V92H626V132H780V106H900V132H1008V236H1078V306H1018V410H1072V620H998V686H652V654H506V686H306V594H272V442H306V330H270V210H310Z",
		rects: [
			{ className: "service", height: 78, width: 68, x: 312, y: 144 },
			{ className: "stair", height: 58, width: 78, x: 652, y: 106 },
			{ className: "service", height: 60, width: 78, x: 812, y: 126 },
			{ className: "service", height: 72, width: 70, x: 960, y: 318 },
			{ className: "stair", height: 62, width: 70, x: 952, y: 528 },
			{ className: "service", height: 86, width: 70, x: 310, y: 574 },
			{ className: "core", height: 206, width: 238, x: 562, y: 312 },
			{ className: "core", height: 176, width: 184, x: 806, y: 438 },
		],
		title: "荟贤食堂一层",
		walls: [
			"M380 132V330M306 330H522M522 132V330M900 132V236H1008",
			"M558 252H958M558 252V620M958 252V620",
			"M620 312V518M690 312V518M768 312V620M846 438V620M918 438V620",
			"M306 442H522M306 594H506M506 594V686M652 620V686",
			"M780 132V236M900 236H1078M1008 410H1072M998 528V686",
			"M386 574V686M452 594V686M560 520H958M560 620H998",
		],
		windows: [
			{ anchorId: "window-01", height: 42, label: "一号窗口", width: 96, x: 406, y: 150 },
			{ anchorId: "window-02", height: 42, label: "二号窗口", width: 96, x: 548, y: 150 },
			{ anchorId: "window-03", height: 42, label: "三号窗口", width: 96, x: 766, y: 150 },
			{ anchorId: "window-04", height: 44, label: "四号窗口", width: 92, x: 922, y: 244 },
			{ anchorId: "window-05", height: 44, label: "五号窗口", width: 92, x: 922, y: 374 },
			{ anchorId: "window-06", height: 44, label: "六号窗口", width: 96, x: 824, y: 626 },
			{ anchorId: "window-07", height: 44, label: "七号窗口", width: 96, x: 672, y: 626 },
			{ anchorId: "window-08", height: 44, label: "八号窗口", width: 96, x: 526, y: 626 },
			{ anchorId: "window-09", height: 44, label: "九号窗口", width: 96, x: 330, y: 494 },
			{ anchorId: "window-10", height: 44, label: "十号窗口", width: 96, x: 330, y: 238 },
		],
	},
	"fengtai-huixian-canteen-2f": {
		circulation: ["M386 286H548V640H972", "M548 286H982V640", "M548 446H982"],
		entrances: [
			{ height: 24, label: "入口", width: 58, x: 332, y: 674 },
			{ height: 24, label: "入口", width: 58, x: 756, y: 674 },
			{ height: 24, label: "入口", width: 58, x: 1018, y: 346 },
		],
		floorId: "fengtai-huixian-canteen-2f",
		outerShell:
			"M310 126H598V162H808V126H982V286H1052V376H982V456H1042V646H972V690H646V646H492V690H310V570H284V394H310Z",
		rects: [
			{ className: "service", height: 84, width: 70, x: 312, y: 142 },
			{ className: "service", height: 60, width: 78, x: 736, y: 126 },
			{ className: "service", height: 62, width: 70, x: 986, y: 300 },
			{ className: "stair", height: 66, width: 70, x: 954, y: 574 },
			{ className: "stair", height: 58, width: 70, x: 310, y: 596 },
			{ className: "core", height: 112, width: 318, x: 548, y: 304 },
			{ className: "core", height: 100, width: 236, x: 548, y: 470 },
			{ className: "core", height: 112, width: 170, x: 814, y: 468 },
		],
		title: "荟贤食堂二层",
		walls: [
			"M384 126V286M598 126V286M808 126V286M982 126V286",
			"M310 286H548M548 286V570M866 286V416M982 286H1052",
			"M548 304H866M548 416H866M626 304V416M704 304V416M782 304V416",
			"M548 470H984M548 570H646M646 570V690M784 470V646M814 580H984",
			"M310 394H548M310 570H492M492 570V690M970 456V690",
			"M980 376H1050M984 468V646M872 468V646",
		],
		windows: [
			{ anchorId: "window-01", height: 42, label: "一号窗口", width: 96, x: 420, y: 150 },
			{ anchorId: "window-02", height: 42, label: "二号窗口", width: 96, x: 624, y: 176 },
			{ anchorId: "window-03", height: 42, label: "三号窗口", width: 96, x: 838, y: 150 },
			{ anchorId: "window-04", height: 44, label: "四号窗口", width: 92, x: 932, y: 328 },
			{ anchorId: "window-05", height: 44, label: "五号窗口", width: 96, x: 824, y: 614 },
			{ anchorId: "window-06", height: 44, label: "六号窗口", width: 96, x: 670, y: 614 },
			{ anchorId: "window-07", height: 44, label: "七号窗口", width: 96, x: 516, y: 614 },
			{ anchorId: "window-08", height: 44, label: "八号窗口", width: 96, x: 336, y: 494 },
			{ anchorId: "window-09", height: 44, label: "九号窗口", width: 96, x: 336, y: 314 },
		],
	},
};

export function huixianFloorplanInput(input: {
	floorId: HuixianFloorId;
	label: string;
	sha256: `sha256:${string}`;
}): DiningFloorplanManifestInput {
	const shape = HUIXIAN_FLOOR_SHAPES[input.floorId];
	return {
		anchorInventory: shape.windows.map((window) => ({
			anchorId: window.anchorId,
			label: window.label,
			role: "window" as const,
		})),
		floorId: input.floorId,
		floorplanId: `floorplan:fengtai-huixian-canteen:${input.floorId}`,
		hallId: "fengtai-huixian-canteen",
		sha256: input.sha256,
		svgAssetUrl: `/assets/dining/fengtai-huixian-canteen-${input.floorId.endsWith("1f") ? "1f" : "2f"}.svg`,
		svgMarkup: renderStructuralFloorplan({ ...shape, title: input.label }),
	};
}
