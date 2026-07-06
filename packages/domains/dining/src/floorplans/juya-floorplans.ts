import type { DiningFloorplanManifestInput } from "./index";
import { renderStructuralFloorplan, type StructuralFloorplanShape } from "./structural-floorplan";

type JuyaFloorId = "fengtai-juya-canteen-1f" | "fengtai-juya-canteen-2f";

type JuyaFloorShape = StructuralFloorplanShape<JuyaFloorId>;

const JUYA_FLOOR_SHAPES: Record<JuyaFloorId, JuyaFloorShape> = {
	"fengtai-juya-canteen-1f": {
		circulation: ["M450 198H1062V400H942V622H325", "M450 326H942", "M450 470H788V622"],
		entrances: [
			{ height: 24, label: "入口", width: 58, x: 292, y: 674 },
			{ height: 24, label: "入口", width: 58, x: 746, y: 674 },
			{ height: 24, label: "入口", width: 58, x: 1048, y: 274 },
		],
		floorId: "fengtai-juya-canteen-1f",
		outerShell:
			"M450 116H1062V198H1104V304H1036V400H942V512H992V622H788V670H325V610H246V470H304V326H450Z",
		rects: [
			{ className: "core", height: 70, width: 92, x: 624, y: 204 },
			{ className: "core", height: 70, width: 98, x: 754, y: 330 },
			{ className: "service", height: 104, width: 84, x: 948, y: 242 },
			{ className: "service", height: 84, width: 98, x: 314, y: 412 },
			{ className: "stair", height: 58, width: 86, x: 362, y: 616 },
			{ className: "stair", height: 58, width: 98, x: 894, y: 512 },
			{ className: "stair", height: 55, width: 84, x: 904, y: 612 },
		],
		title: "聚雅食堂一层",
		walls: [
			"M450 198H606V294H786V198H1062",
			"M527 116V198M624 116V198M727 116V198M852 116V198M965 116V198",
			"M304 326H450M304 470H450M325 610H502M788 622V670M942 400V622",
			"M498 328H690V446H858V328H942M503 446H668V540H788V446",
			"M412 540H612M670 540H788M502 622V670M641 622V670",
		],
		windows: [
			{ anchorId: "window-01", height: 48, label: "一号窗口", width: 104, x: 627, y: 152 },
			{ anchorId: "window-02", height: 48, label: "二号窗口", width: 104, x: 795, y: 152 },
			{ anchorId: "window-03", height: 50, label: "三号窗口", width: 94, x: 945, y: 224 },
			{ anchorId: "window-04", height: 50, label: "四号窗口", width: 100, x: 348, y: 570 },
			{ anchorId: "window-05", height: 52, label: "五号窗口", width: 104, x: 836, y: 556 },
			{ anchorId: "window-06", height: 48, label: "六号窗口", width: 104, x: 494, y: 152 },
			{ anchorId: "window-07", height: 50, label: "七号窗口", width: 96, x: 948, y: 336 },
			{ anchorId: "window-08", height: 52, label: "八号窗口", width: 104, x: 520, y: 614 },
		],
	},
	"fengtai-juya-canteen-2f": {
		circulation: ["M452 170H884V324H798V624", "M378 320H798", "M378 404H798"],
		entrances: [
			{ height: 24, label: "入口", width: 58, x: 348, y: 624 },
			{ height: 24, label: "入口", width: 58, x: 742, y: 624 },
			{ height: 24, label: "入口", width: 58, x: 934, y: 294 },
		],
		floorId: "fengtai-juya-canteen-2f",
		outerShell: "M452 112H884V170H984V324H880V432H798V624H378V404H320V320H378V160H452Z",
		rects: [
			{ className: "stair", height: 65, width: 72, x: 580, y: 112 },
			{ className: "service", height: 62, width: 58, x: 672, y: 112 },
			{ className: "stair", height: 58, width: 77, x: 320, y: 315 },
			{ className: "stair", height: 65, width: 79, x: 810, y: 410 },
			{ className: "stair", height: 65, width: 79, x: 810, y: 530 },
			{ className: "service", height: 67, width: 65, x: 920, y: 245 },
		],
		title: "聚雅食堂二层",
		walls: [
			"M452 170H572V266H754V170H884",
			"M519 112V170M672 112V266M754 112V266M850 112V170",
			"M378 160V404M378 404H517V624M798 432V624M880 324H798V432",
			"M436 344H602V284H762V378H798M436 498H602V624",
			"M604 432H748M604 532H798M884 170V324",
		],
		windows: [
			{ anchorId: "window-01", height: 48, label: "一号窗口", width: 100, x: 470, y: 136 },
			{ anchorId: "window-02", height: 50, label: "二号窗口", width: 104, x: 632, y: 140 },
			{ anchorId: "window-03", height: 50, label: "三号窗口", width: 100, x: 790, y: 140 },
			{ anchorId: "window-04", height: 52, label: "四号窗口", width: 104, x: 404, y: 512 },
			{ anchorId: "window-05", height: 52, label: "五号窗口", width: 104, x: 674, y: 545 },
			{ anchorId: "window-06", height: 50, label: "六号窗口", width: 104, x: 424, y: 250 },
			{ anchorId: "window-07", height: 50, label: "七号窗口", width: 104, x: 630, y: 260 },
			{ anchorId: "window-08", height: 52, label: "八号窗口", width: 104, x: 404, y: 405 },
			{ anchorId: "window-09", height: 52, label: "九号窗口", width: 104, x: 674, y: 432 },
		],
	},
};

export function juyaFloorplanInput(input: {
	floorId: JuyaFloorId;
	label: string;
	sha256: `sha256:${string}`;
}): DiningFloorplanManifestInput {
	const shape = JUYA_FLOOR_SHAPES[input.floorId];
	return {
		anchorInventory: shape.windows.map((window) => ({
			anchorId: window.anchorId,
			label: window.label,
			role: "window" as const,
		})),
		floorId: input.floorId,
		floorplanId: `floorplan:fengtai-juya-canteen:${input.floorId}`,
		hallId: "fengtai-juya-canteen",
		sha256: input.sha256,
		svgAssetUrl: `/assets/dining/fengtai-juya-canteen-${input.floorId.endsWith("1f") ? "1f" : "2f"}.svg`,
		svgMarkup: renderStructuralFloorplan({ ...shape, title: input.label }),
	};
}
