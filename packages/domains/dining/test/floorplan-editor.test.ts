import { renderToStaticMarkup } from "react-dom/server";
import { Box, type TLCreateShapePartial, type TLShape, Vec } from "tldraw";
import { describe, expect, it } from "vitest";

import { applyDiningFloorplanCommands } from "../editor/editor-commands";
import { DINING_REFERENCE_CALIBRATIONS } from "../editor/reference-calibrations";
import {
	DINING_REFERENCE_SHAPE_META_KEY,
	layoutToTldrawRecords,
	tldrawRecordsToLayout,
} from "../editor/tldraw-adapter";
import { type DiningMarkerShape, DiningMarkerShapeUtil } from "../editor/tldraw-shapes";
import {
	assertDiningWayfindingLayout,
	canonicalizeDiningWayfindingLayout,
	DINING_WAYFINDING_LAYOUTS,
	serializeDiningWayfindingLayout,
} from "../src/floorplans";

describe("dining tldraw adapter", () => {
	it("round-trips every canonical layout without changing domain truth", () => {
		for (const layout of DINING_WAYFINDING_LAYOUTS) {
			const records = materializeShapes(layoutToTldrawRecords(layout));
			const roundTrip = tldrawRecordsToLayout(records, layout);
			expect(serializeDiningWayfindingLayout(roundTrip)).toBe(
				serializeDiningWayfindingLayout(layout),
			);
		}
	});

	it("uses stable semantic shape ids", () => {
		const layout = DINING_WAYFINDING_LAYOUTS.find(
			(item) => item.floorId === "fengtai-juya-canteen-1f",
		);
		if (!layout) {
			throw new Error("Dining editor test layout is missing.");
		}
		const records = layoutToTldrawRecords(layout);
		expect(records.some((shape) => shape.id === "shape:path-outline")).toBe(true);
		expect(records.some((shape) => shape.id === "shape:window-window-01")).toBe(true);
		expect(records.some((shape) => shape.id === "shape:region-seating-main")).toBe(true);
	});

	it("excludes a locked local reference image from canonical JSON", () => {
		const layout = DINING_WAYFINDING_LAYOUTS[0];
		if (!layout) {
			throw new Error("Dining editor test layout is missing.");
		}
		const records = materializeShapes(layoutToTldrawRecords(layout));
		records.unshift({
			id: "shape:reference-test",
			meta: { [DINING_REFERENCE_SHAPE_META_KEY]: true },
			props: {},
			rotation: 0,
			type: "image",
			x: 0,
			y: 0,
		} as unknown as TLShape);
		expect(serializeDiningWayfindingLayout(tldrawRecordsToLayout(records, layout))).toBe(
			serializeDiningWayfindingLayout(layout),
		);
	});

	it("fails closed for default canvas shapes and rotation", () => {
		const layout = DINING_WAYFINDING_LAYOUTS[0];
		if (!layout) {
			throw new Error("Dining editor test layout is missing.");
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
			throw new Error("Dining editor outline record is missing.");
		}
		rotated[0].rotation = 0.5;
		expect(() => tldrawRecordsToLayout(rotated, layout)).toThrow(/must not be rotated/);
	});
});

describe("dining tldraw marker", () => {
	it("renders the authored window label instead of its internal anchor id", () => {
		const shape = diningWindowShape({ entityId: "window-02", label: "广式风味" });
		const markup = renderToStaticMarkup(DiningMarkerShapeUtil.prototype.component(shape));
		expect(markup).toContain("广式风味");
		expect(markup).not.toContain(">02<");
	});

	it("prevents windows from being resized below the domain minimum", () => {
		const shape = diningWindowShape();
		const resized = DiningMarkerShapeUtil.prototype.onResize(shape, {
			handle: "bottom_right",
			initialBounds: new Box(0, 0, shape.props.w, shape.props.h),
			initialShape: shape,
			mode: "resize_bounds",
			newPoint: new Vec(0, 0),
			scaleX: 0.1,
			scaleY: 0.1,
		});
		expect(resized.props).toMatchObject({ h: 72, w: 88 });
	});
});

describe("dining reference calibration", () => {
	it("maps every Fengtai source crop onto the authored layout footprint", () => {
		expect(DINING_REFERENCE_CALIBRATIONS).toHaveLength(4);
		for (const calibration of DINING_REFERENCE_CALIBRATIONS) {
			expect(calibration.sourceSha256).toMatch(/^sha256:[0-9a-f]{64}$/);
			const layout = DINING_WAYFINDING_LAYOUTS.find((item) => item.floorId === calibration.floorId);
			if (!layout) {
				throw new Error(`Dining calibration layout is missing: ${calibration.floorId}`);
			}
			const xs = layout.outline.points.map((point) => point.x);
			const ys = layout.outline.points.map((point) => point.y);
			expect(calibration.layoutBounds).toEqual({
				height: Math.max(...ys) - Math.min(...ys),
				width: Math.max(...xs) - Math.min(...xs),
				x: Math.min(...xs),
				y: Math.min(...ys),
			});
			expect(calibration.sourceCrop.x + calibration.sourceCrop.width).toBeLessThanOrEqual(
				calibration.sourceSize.width,
			);
			expect(calibration.sourceCrop.y + calibration.sourceCrop.height).toBeLessThanOrEqual(
				calibration.sourceSize.height,
			);
		}
	});
});

describe("dining point geometry contract", () => {
	it("rejects self-intersecting canonical polygons", () => {
		const layout = structuredClone(DINING_WAYFINDING_LAYOUTS[0]);
		if (!layout) {
			throw new Error("Dining editor test layout is missing.");
		}
		layout.outline.points = [
			{ x: 100, y: 100 },
			{ x: 300, y: 300 },
			{ x: 100, y: 300 },
			{ x: 300, y: 100 },
		];
		expect(() => assertDiningWayfindingLayout(layout)).toThrow(/must not self-intersect/);
	});

	it("requires entity ids to be unique across semantic layers", () => {
		const layout = structuredClone(DINING_WAYFINDING_LAYOUTS[0]);
		if (!layout) {
			throw new Error("Dining editor test layout is missing.");
		}
		const region = layout.regions[0];
		const entrance = layout.entrances[0];
		if (!(region && entrance)) {
			throw new Error("Dining editor semantic layers are missing.");
		}
		region.id = entrance.id;
		expect(() => assertDiningWayfindingLayout(layout)).toThrow(
			/Duplicate dining wayfinding entity id/,
		);
	});

	it("revalidates geometry after canonical coordinate rounding", () => {
		const layout = structuredClone(DINING_WAYFINDING_LAYOUTS[0]);
		if (!layout) {
			throw new Error("Dining editor test layout is missing.");
		}
		const firstPoint = layout.outline.points[0];
		if (!firstPoint) {
			throw new Error("Dining editor outline is missing.");
		}
		layout.outline.points[1] = {
			x: firstPoint.x + 0.000_4,
			y: firstPoint.y,
		};
		expect(() => canonicalizeDiningWayfindingLayout(layout)).toThrow(
			/consecutive duplicate points/,
		);
	});

	it("rejects overlapping interactive window areas", () => {
		const layout = structuredClone(DINING_WAYFINDING_LAYOUTS[0]);
		const firstWindow = layout?.windows[0];
		const secondWindow = layout?.windows[1];
		if (!(layout && firstWindow && secondWindow)) {
			throw new Error("Dining editor window fixtures are missing.");
		}
		secondWindow.x = firstWindow.x;
		secondWindow.y = firstWindow.y;
		expect(() => assertDiningWayfindingLayout(layout)).toThrow(/overlaps another interactive area/);
	});
});

describe("dining editor commands", () => {
	it("applies a command batch to a clone and validates only the final layout", () => {
		const layout = DINING_WAYFINDING_LAYOUTS[0];
		if (!layout) {
			throw new Error("Dining editor test layout is missing.");
		}
		const sourceWindow = layout.windows[0];
		if (!sourceWindow) {
			throw new Error("Dining editor window fixture is missing.");
		}
		const result = applyDiningFloorplanCommands(layout, [
			{ ids: layout.windows.map((window) => window.anchorId), op: "delete" },
			{
				entity: {
					height: sourceWindow.height,
					id: "window-01",
					kind: "window",
					label: "一号窗口",
					width: sourceWindow.width,
					x: sourceWindow.x,
					y: sourceWindow.y,
				},
				op: "create",
			},
		]);
		expect(result.windows).toHaveLength(1);
		expect(layout.windows.length).toBeGreaterThan(1);
	});

	it("does not mutate source truth when a command batch is invalid", () => {
		const layout = DINING_WAYFINDING_LAYOUTS[0];
		if (!layout) {
			throw new Error("Dining editor test layout is missing.");
		}
		const before = serializeDiningWayfindingLayout(layout);
		expect(() =>
			applyDiningFloorplanCommands(layout, [
				{ ids: layout.windows.map((window) => window.anchorId), op: "delete" },
			]),
		).toThrow(/non-empty array/);
		expect(serializeDiningWayfindingLayout(layout)).toBe(before);
	});

	it("applies semantic marker edits without depending on canvas coordinates", () => {
		const layout = DINING_WAYFINDING_LAYOUTS[0];
		if (!layout) {
			throw new Error("Dining editor test layout is missing.");
		}
		const firstWindow = layout.windows[0];
		const secondWindow = layout.windows[3];
		const region = layout.regions[0];
		if (!(firstWindow && secondWindow && region)) {
			throw new Error("Dining editor marker fixtures are missing.");
		}
		const result = applyDiningFloorplanCommands(layout, [
			{
				ids: [firstWindow.anchorId, secondWindow.anchorId],
				op: "align",
				position: "left",
			},
			{ iconKey: "coffee", id: region.id, op: "setIcon" },
			{ id: firstWindow.anchorId, label: "测试窗口", op: "setLabel" },
		]);
		expect(result.windows.find((window) => window.anchorId === firstWindow.anchorId)?.x).toBe(
			result.windows.find((window) => window.anchorId === secondWindow.anchorId)?.x,
		);
		expect(result.windows[0]?.label).toBe("测试窗口");
		expect(result.regions[0]?.iconKey).toBe("coffee");
	});

	it("keeps renamed window ids in canonical order", () => {
		const layout = DINING_WAYFINDING_LAYOUTS[0];
		const firstWindow = layout?.windows[0];
		if (!(layout && firstWindow)) {
			throw new Error("Dining editor window fixture is missing.");
		}
		const result = applyDiningFloorplanCommands(layout, [
			{ id: firstWindow.anchorId, op: "update", patch: { id: "window-99" } },
		]);
		expect(result.windows.at(-1)?.anchorId).toBe("window-99");
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

function diningWindowShape(props: Partial<DiningMarkerShape["props"]> = {}): DiningMarkerShape {
	return {
		id: "shape:window-window-02",
		index: "a1",
		isLocked: false,
		meta: {},
		opacity: 1,
		parentId: "page:page",
		props: {
			entityId: "window-02",
			h: 72,
			iconKey: null,
			label: "二号窗口",
			landmarkKind: null,
			markerKind: "window",
			side: null,
			w: 104,
			...props,
		},
		rotation: 0,
		type: "dining-marker",
		typeName: "shape",
		x: 0,
		y: 0,
	} as DiningMarkerShape;
}
