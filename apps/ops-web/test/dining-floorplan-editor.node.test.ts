// @vitest-environment node

import {
	assertDiningWayfindingLayout,
	canonicalizeDiningWayfindingLayout,
	DINING_BOOTSTRAP_FLOORPLANS,
	diagnoseDiningWayfindingLayout,
	serializeDiningWayfindingLayout,
} from "@campus-agent/dining/floorplans";
import { renderToStaticMarkup } from "react-dom/server";
import {
	Box,
	type Editor,
	type TLContent,
	type TLCreateShapePartial,
	type TLShape,
	Vec,
} from "tldraw";
import { describe, expect, it } from "vitest";
import {
	layoutToTldrawRecords,
	tldrawRecordsToLayout,
} from "../src/app/dining-studio/tldraw-adapter";
import { prepareDiningContent } from "../src/app/dining-studio/tldraw-policy";
import {
	type DiningPathShape,
	DiningPathShapeUtil,
	type DiningWindowShape,
	DiningWindowShapeUtil,
} from "../src/app/dining-studio/tldraw-shapes";

describe("Dining tldraw adapter", () => {
	it("round-trips every bootstrap layout without changing domain data", () => {
		for (const layout of DINING_BOOTSTRAP_FLOORPLANS.layouts) {
			const records = materializeShapes(layoutToTldrawRecords(layout));
			const roundTrip = tldrawRecordsToLayout(records, layout);
			expect(serializeDiningWayfindingLayout(roundTrip)).toBe(
				serializeDiningWayfindingLayout(layout),
			);
		}
	});

	it("round-trips small positive window geometry exactly", () => {
		const layout = structuredClone(DINING_BOOTSTRAP_FLOORPLANS.layouts[0]);
		const window = layout?.windows[0];
		if (!(layout && window)) {
			throw new Error("Dining bootstrap needs one window.");
		}
		window.width = 12.5;
		window.height = 8.25;
		const roundTrip = tldrawRecordsToLayout(
			materializeShapes(layoutToTldrawRecords(layout)),
			layout,
		);
		expect(roundTrip.windows[0]).toMatchObject({ height: 8.25, width: 12.5 });
	});

	it("rejects unsupported or rotated canvas shapes", () => {
		const layout = DINING_BOOTSTRAP_FLOORPLANS.layouts[0];
		if (!layout) {
			throw new Error("Dining bootstrap needs one layout.");
		}
		const records = materializeShapes(layoutToTldrawRecords(layout));
		expect(() =>
			tldrawRecordsToLayout(
				[
					...records,
					{
						id: "shape:rogue",
						meta: {},
						props: {},
						rotation: 0,
						type: "geo",
						x: 0,
						y: 0,
					} as unknown as TLShape,
				],
				layout,
			),
		).toThrow(/Unsupported shape/);
		const rotated = structuredClone(records);
		if (!rotated[0]) {
			throw new Error("Dining outline is missing.");
		}
		rotated[0].rotation = 0.5;
		expect(() => tldrawRecordsToLayout(rotated, layout)).toThrow(/must not be rotated/);
	});
});

describe("Dining outline editing", () => {
	it("resizes and moves outline nodes through the saved layout adapter", () => {
		const layout = structuredClone(DINING_BOOTSTRAP_FLOORPLANS.layouts[0]);
		if (!layout) {
			throw new Error("Dining bootstrap needs one layout.");
		}
		layout.outline.points = [
			{ x: 20, y: 20 },
			{ x: 1200, y: 20 },
			{ x: 1200, y: 680 },
			{ x: 20, y: 680 },
		];
		const records = materializeShapes(layoutToTldrawRecords(layout));
		const outline = records.find(
			(shape): shape is DiningPathShape =>
				shape.type === "dining-path" && shape.props.layer === "outline",
		);
		if (!outline) {
			throw new Error("Dining outline is missing.");
		}
		const util = new DiningPathShapeUtil(shapeEditor());
		expect(util.canResize()).toBe(true);
		expect(util.canBeLaidOut(outline)).toBe(false);
		const resized = {
			...outline,
			...util.onResize(outline, {
				handle: "bottom_right",
				initialBounds: new Box(20, 20, 1180, 660),
				initialShape: outline,
				mode: "resize_bounds",
				newPoint: new Vec(20, 20),
				scaleX: 0.95,
				scaleY: 1,
			}),
		} as DiningPathShape;
		const handle = util.getHandles(resized)[0];
		if (!handle) {
			throw new Error("Dining outline needs one handle.");
		}
		const edited = util.onHandleDrag(resized, {
			handle: { ...handle, x: 10, y: 15 },
			initial: resized,
			isCreatingShape: false,
			isPrecise: true,
		});
		const saved = tldrawRecordsToLayout(
			records.map((shape) => (shape.id === outline.id ? edited : shape)),
			layout,
		);
		expect(saved.outline.points).toEqual([
			{ x: 30, y: 35 },
			{ x: 1141, y: 20 },
			{ x: 1141, y: 680 },
			{ x: 20, y: 680 },
		]);
		expect({ ...saved, outline: layout.outline }).toEqual(layout);
		expect(
			serializeDiningWayfindingLayout(
				tldrawRecordsToLayout(materializeShapes(layoutToTldrawRecords(saved)), saved),
			),
		).toBe(serializeDiningWayfindingLayout(saved));
	});
});

describe("Dining partition editing", () => {
	it("moves an inserted vertex with shape offsets, clamps it to the canvas, and round-trips", () => {
		const layout = structuredClone(DINING_BOOTSTRAP_FLOORPLANS.layouts[0]);
		if (!layout) {
			throw new Error("Dining bootstrap needs one layout.");
		}
		layout.partitions = [
			{
				id: "partition-node-test",
				points: [
					{ x: 100, y: 140 },
					{ x: 530, y: 300 },
				],
			},
		];
		const records = materializeShapes(layoutToTldrawRecords(layout));
		const partition = records.find(
			(shape): shape is DiningPathShape =>
				shape.type === "dining-path" &&
				shape.props.layer === "partition" &&
				shape.props.entityId === "partition-node-test",
		);
		if (!partition) {
			throw new Error("Dining partition is missing.");
		}

		const util = new DiningPathShapeUtil(shapeEditor());
		expect(partition.props.closed).toBe(false);
		expect(partition.x).toBe(100);
		expect(partition.y).toBe(140);
		const withInsertedVertex: DiningPathShape = {
			...partition,
			props: {
				...partition.props,
				points: [
					{ x: 0, y: 0 },
					{ x: 215, y: 80 },
					{ x: 430, y: 160 },
				],
			},
		};
		expect(util.getHandles(withInsertedVertex)).toHaveLength(3);

		const vertex = util.getHandles(withInsertedVertex).find((handle) => handle.id === "1");
		if (!vertex) {
			throw new Error("Dining partition needs a middle vertex.");
		}
		const edited = util.onHandleDrag(withInsertedVertex, {
			handle: { ...vertex, x: 9999, y: -9999 },
			initial: withInsertedVertex,
			isCreatingShape: false,
			isPrecise: true,
		});
		expect(edited.props.points).toEqual([
			{ x: 0, y: 0 },
			{ x: 1180, y: -140 },
			{ x: 430, y: 160 },
		]);

		const saved = tldrawRecordsToLayout(
			records.map((shape) => (shape.id === partition.id ? edited : shape)),
			layout,
		);
		expect(saved.partitions).toEqual([
			{
				id: "partition-node-test",
				points: [
					{ x: 100, y: 140 },
					{ x: 1280, y: 0 },
					{ x: 530, y: 300 },
				],
			},
		]);
		expect(
			serializeDiningWayfindingLayout(
				tldrawRecordsToLayout(materializeShapes(layoutToTldrawRecords(saved)), saved),
			),
		).toBe(serializeDiningWayfindingLayout(saved));
	});

	it("keeps vertex drags inside an enlarged layout canvas", () => {
		const layout = structuredClone(DINING_BOOTSTRAP_FLOORPLANS.layouts[0]);
		if (!layout) {
			throw new Error("Dining bootstrap needs one layout.");
		}
		layout.canvas = { height: 1520, width: 2560 };
		layout.partitions = [
			{
				id: "partition-scale-test",
				points: [
					{ x: 1500, y: 100 },
					{ x: 1800, y: 100 },
				],
			},
		];
		const records = materializeShapes(layoutToTldrawRecords(layout));
		const partition = records.find(
			(shape): shape is DiningPathShape =>
				shape.type === "dining-path" && shape.props.entityId === "partition-scale-test",
		);
		if (!partition) {
			throw new Error("Dining partition is missing.");
		}
		const util = new DiningPathShapeUtil(shapeEditor(layout.canvas));
		const handle = util.getHandles(partition)[1];
		if (!handle) {
			throw new Error("Dining partition needs an endpoint.");
		}
		const edited = util.onHandleDrag(partition, {
			handle: { ...handle, x: 3000, y: 1700 },
			initial: partition,
			isCreatingShape: false,
			isPrecise: true,
		});
		const saved = tldrawRecordsToLayout(
			records.map((shape) => (shape.id === partition.id ? edited : shape)),
			layout,
		);
		expect(saved.partitions[0]?.points).toEqual([
			{ x: 1500, y: 100 },
			{ x: 2560, y: 1520 },
		]);
	});
});

describe("Dining window shape", () => {
	it("renders the authored label", () => {
		const shape = diningWindowShape({ entityId: "window-02", label: "广式风味" });
		const markup = renderToStaticMarkup(new DiningWindowShapeUtil(shapeEditor()).component(shape));
		expect(markup).toContain("广式风味");
	});

	it("allows precise resize while keeping the authored default", () => {
		const shape = diningWindowShape();
		const util = new DiningWindowShapeUtil(shapeEditor());
		const resized = util.onResize(shape, {
			handle: "bottom_right",
			initialBounds: new Box(0, 0, shape.props.w, shape.props.h),
			initialShape: shape,
			mode: "resize_bounds",
			newPoint: new Vec(0, 0),
			scaleX: 0.001,
			scaleY: 0.001,
		});
		expect(resized.props).toMatchObject({ h: 1, w: 1 });
		expect(util.getDefaultProps()).toMatchObject({ h: 72, w: 104 });
	});

	it("keeps all window labels the same size across names and box sizes", () => {
		const enlarged = new DiningWindowShapeUtil(shapeEditor({ height: 1520, width: 2560 }));
		const normal = new DiningWindowShapeUtil(shapeEditor());
		for (const props of [
			{ h: 94, label: "冒烤鸭", w: 76 },
			{ h: 94, label: "云南沾水菜", w: 82 },
			{ h: 92, label: "新疆炒米粉", w: 62 },
			{ h: 92, label: "麻辣烫/麻辣香锅", w: 86 },
			{ h: 72, label: "麻辣烫/麻辣香锅", w: 104 },
		]) {
			const shape = diningWindowShape(props);
			const original = structuredClone(shape);
			const markup = renderToStaticMarkup(enlarged.component(shape));
			expect(markup).toContain("font-size:25px");
			expect(markup).toContain(props.label);
			expect(renderToStaticMarkup(normal.component(shape))).toContain("font-size:18px");
			expect(shape).toEqual(original);
		}
	});
});

describe("Dining tldraw clipboard policy", () => {
	it("reidentifies pasted windows and requires new names", () => {
		const first = diningWindowShape({ entityId: "window-01", label: "四川风味" });
		const second = {
			...diningWindowShape({ entityId: "window-02", label: "苏州风味" }),
			id: "shape:source-window-02",
			x: 160,
		} as DiningWindowShape;
		const prepared = prepareDiningContent(
			fakeEditor([diningWindowShape({ entityId: "window-01" })]),
			clipboardContent([first, second]),
		);
		expect(prepared?.shapes.map((shape) => shape.props)).toEqual([
			expect.objectContaining({ entityId: "window-02", label: "" }),
			expect.objectContaining({ entityId: "window-03", label: "" }),
		]);
		expect(prepared?.shapes.map((shape) => shape.meta.diningNeedsName)).toEqual([true, true]);
	});

	it("rejects non-Dining shapes and assets", () => {
		const editor = fakeEditor([]);
		const rogue = { ...diningWindowShape(), type: "text" } as unknown as TLShape;
		expect(prepareDiningContent(editor, clipboardContent([rogue]))).toBeNull();
		expect(
			prepareDiningContent(editor, {
				...clipboardContent([diningWindowShape()]),
				assets: [{} as TLContent["assets"][number]],
			}),
		).toBeNull();
	});
});

describe("Dining map geometry", () => {
	it("rejects self-intersecting outlines and duplicate semantic ids", () => {
		const layout = structuredClone(DINING_BOOTSTRAP_FLOORPLANS.layouts[0]);
		if (!layout) {
			throw new Error("Dining bootstrap needs one layout.");
		}
		layout.outline.points = [
			{ x: 100, y: 100 },
			{ x: 300, y: 300 },
			{ x: 100, y: 300 },
			{ x: 300, y: 100 },
		];
		expect(() => assertDiningWayfindingLayout(layout)).toThrow(/must not self-intersect/);

		const duplicate = structuredClone(DINING_BOOTSTRAP_FLOORPLANS.layouts[0]);
		const region = duplicate?.regions[0];
		const entrance = duplicate?.entrances[0];
		if (!(duplicate && region && entrance)) {
			throw new Error("Dining bootstrap semantic layers are missing.");
		}
		region.id = entrance.id;
		expect(() => assertDiningWayfindingLayout(duplicate)).toThrow(
			/Duplicate dining wayfinding entity id/,
		);
	});

	it("revalidates rounded coordinates and diagnoses overlapping windows", () => {
		const rounded = structuredClone(DINING_BOOTSTRAP_FLOORPLANS.layouts[0]);
		const firstPoint = rounded?.outline.points[0];
		if (!(rounded && firstPoint)) {
			throw new Error("Dining bootstrap outline is missing.");
		}
		rounded.outline.points[1] = { x: firstPoint.x + 0.000_4, y: firstPoint.y };
		expect(() => canonicalizeDiningWayfindingLayout(rounded)).toThrow(
			/consecutive duplicate points/,
		);

		const overlapping = structuredClone(DINING_BOOTSTRAP_FLOORPLANS.layouts[0]);
		const firstWindow = overlapping?.windows[0];
		const secondWindow = overlapping?.windows[1];
		if (!(overlapping && firstWindow && secondWindow)) {
			throw new Error("Dining bootstrap needs two windows.");
		}
		secondWindow.x = firstWindow.x;
		secondWindow.y = firstWindow.y;
		expect(diagnoseDiningWayfindingLayout(overlapping)).toEqual([
			expect.objectContaining({ code: "window_overlap" }),
		]);
	});
});

function materializeShapes(records: TLCreateShapePartial[]): TLShape[] {
	return records.map(
		(record) =>
			({
				...record,
				meta: record.meta ?? {},
				props: record.props ?? {},
				rotation: 0,
				x: record.x ?? 0,
				y: record.y ?? 0,
			}) as unknown as TLShape,
	);
}

function diningWindowShape(props: Partial<DiningWindowShape["props"]> = {}): DiningWindowShape {
	return {
		id: "shape:window-window-02",
		index: "a1",
		isLocked: false,
		meta: {},
		opacity: 1,
		parentId: "page:page",
		props: { entityId: "window-02", h: 72, label: "测试窗口", w: 104, ...props },
		rotation: 0,
		type: "dining-window",
		typeName: "shape",
		x: 0,
		y: 0,
	} as DiningWindowShape;
}

function clipboardContent(shapes: TLShape[]): TLContent {
	return {
		assets: [],
		bindings: undefined,
		rootShapeIds: shapes.map((shape) => shape.id),
		schema: { schemaVersion: 2, sequences: {} },
		shapes,
	};
}

function fakeEditor(shapes: TLShape[]): Editor {
	return { getCurrentPageShapes: () => shapes } as unknown as Editor;
}

function shapeEditor(canvas = { height: 760, width: 1280 }): Editor {
	return {
		getAncestorPageId: () => "page:page",
		getDocumentSettings: () => ({ gridSize: 10 }),
		getInstanceState: () => ({ isGridMode: false }),
		getPage: () => ({ meta: { diningCanvas: canvas } }),
	} as unknown as Editor;
}
