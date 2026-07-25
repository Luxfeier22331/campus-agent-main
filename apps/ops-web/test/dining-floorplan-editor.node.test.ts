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

describe("Dining window shape", () => {
	it("renders the authored label", () => {
		const shape = diningWindowShape({ entityId: "window-02", label: "广式风味" });
		const markup = renderToStaticMarkup(DiningWindowShapeUtil.prototype.component(shape));
		expect(markup).toContain("广式风味");
	});

	it("allows precise resize while keeping the authored default", () => {
		const shape = diningWindowShape();
		const resized = DiningWindowShapeUtil.prototype.onResize(shape, {
			handle: "bottom_right",
			initialBounds: new Box(0, 0, shape.props.w, shape.props.h),
			initialShape: shape,
			mode: "resize_bounds",
			newPoint: new Vec(0, 0),
			scaleX: 0.001,
			scaleY: 0.001,
		});
		expect(resized.props).toMatchObject({ h: 1, w: 1 });
		expect(DiningWindowShapeUtil.prototype.getDefaultProps()).toMatchObject({ h: 72, w: 104 });
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
