import {
	DINING_BOOTSTRAP_FLOORPLANS,
	DINING_WAYFINDING_CANVAS,
} from "@campus-agent/dining/floorplans";
import type { Editor, TLCreateShapePartial, TLPageId, TLShape, TLShapeId } from "tldraw";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	loadDiningPages,
	pageIdForFloor,
	replaceDiningPages,
	shapesForPage,
	zoomToDiningCanvas,
} from "../src/app/dining-studio/editor-support";
import {
	diningCanvasForEditor,
	diningCanvasForShape,
} from "../src/app/dining-studio/tldraw-canvas";

afterEach(() => vi.unstubAllGlobals());

function pageEditor() {
	interface Page {
		id: TLPageId;
		name: string;
		meta: Record<string, unknown>;
	}
	const pages = new Map<TLPageId, Page>();
	const shapes = new Map<TLPageId, Map<TLShapeId, TLShape>>();
	let currentPageId = "page:initial" as TLPageId;
	const api = {
		clearHistory: vi.fn(),
		createPage: vi.fn((page: Page) => pages.set(page.id, page)),
		createShapes: vi.fn((records: TLCreateShapePartial[]) => {
			const pageShapes = shapes.get(currentPageId) ?? new Map<TLShapeId, TLShape>();
			for (const record of records) {
				const shape = {
					...record,
					id: record.id,
					meta: record.meta ?? {},
					parentId: currentPageId,
					props: record.props ?? {},
					rotation: 0,
					x: record.x ?? 0,
					y: record.y ?? 0,
				} as unknown as TLShape;
				pageShapes.set(shape.id, shape);
			}
			shapes.set(currentPageId, pageShapes);
		}),
		deletePage: vi.fn((id: TLPageId) => pages.delete(id)),
		deleteShapes: vi.fn((ids: TLShapeId[]) => {
			for (const pageShapes of shapes.values()) {
				for (const id of ids) {
					pageShapes.delete(id);
				}
			}
		}),
		getAncestorPageId: vi.fn((shape: TLShape) => shape.parentId),
		getCurrentPageId: () => currentPageId,
		getPage: (id: TLPageId) => pages.get(id),
		getPages: () => [...pages.values()],
		getPageShapeIds: (id: TLPageId) => new Set(shapes.get(id)?.keys() ?? []),
		getShape: (id: TLShapeId) =>
			[...shapes.values()]
				.flatMap((pageShapes) => [...pageShapes.values()])
				.find((shape) => shape.id === id),
		getViewportScreenBounds: () => ({ width: 1000, height: 800 }),
		run: (callback: () => unknown) => callback(),
		setCurrentPage: (id: TLPageId) => {
			currentPageId = id;
		},
		updatePage: vi.fn((page: Page) => pages.set(page.id, { ...pages.get(page.id), ...page })),
		zoomToBounds: vi.fn(),
	};
	return { api, editor: api as unknown as Editor };
}

describe("Dining layout canvas bounds", () => {
	it("loads per-layout bounds and uses the shape's page even when another page is selected", () => {
		const enlarged = structuredClone(DINING_BOOTSTRAP_FLOORPLANS.layouts[0]);
		const normal = DINING_BOOTSTRAP_FLOORPLANS.layouts[1];
		if (!(enlarged && normal)) {
			throw new Error("Two bootstrap layouts are required");
		}
		enlarged.canvas = { width: 2560, height: 1520 };
		const { api, editor } = pageEditor();
		const suppressRef = { current: false };
		loadDiningPages(editor, [enlarged, normal], suppressRef);
		expect(suppressRef.current).toBe(false);
		expect(diningCanvasForEditor(editor)).toEqual(enlarged.canvas);
		api.setCurrentPage(pageIdForFloor(normal.floorId));
		expect(diningCanvasForEditor(editor)).toEqual(normal.canvas);
		expect(
			diningCanvasForShape(editor, { parentId: pageIdForFloor(enlarged.floorId) } as TLShape),
		).toEqual(enlarged.canvas);
		expect(api.createShapes).toHaveBeenCalledTimes(2);
	});

	it("updates bounds on existing pages without recreating their shapes", () => {
		const layout = structuredClone(DINING_BOOTSTRAP_FLOORPLANS.layouts[0]);
		if (!layout) {
			throw new Error("A bootstrap layout is required");
		}
		const { api, editor } = pageEditor();
		loadDiningPages(editor, [layout], { current: false });
		layout.canvas = { width: 2560, height: 1520 };
		loadDiningPages(editor, [layout], { current: false });
		expect(diningCanvasForEditor(editor)).toEqual(layout.canvas);
		expect(api.createShapes).toHaveBeenCalledTimes(1);
	});

	it("replaces every imported page and shape while removing pages outside the bundle", () => {
		const originalLayouts = DINING_BOOTSTRAP_FLOORPLANS.layouts.slice(0, 3);
		const importedLayouts = originalLayouts.slice(0, 2).map((layout, index) => {
			const replacement = structuredClone(layout);
			const importedWindow = replacement.windows[0];
			if (!importedWindow) {
				throw new Error("Dining bootstrap needs a layout with a window.");
			}
			importedWindow.label = `导入窗口 ${index + 1}`;
			return replacement;
		});
		if (originalLayouts.length !== 3 || importedLayouts.length !== 2) {
			throw new Error("Dining bootstrap needs three layouts.");
		}
		const { api, editor } = pageEditor();
		const suppressRef = { current: false };
		loadDiningPages(editor, originalLayouts, suppressRef);

		replaceDiningPages(editor, importedLayouts, suppressRef);

		expect(api.getPages().map((page) => page.id)).toEqual(
			importedLayouts.map((layout) => pageIdForFloor(layout.floorId)),
		);
		for (const [index, layout] of importedLayouts.entries()) {
			expect(shapesForPage(editor, layout.floorId)).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						props: expect.objectContaining({ label: `导入窗口 ${index + 1}` }),
					}),
				]),
			);
		}
		expect(suppressRef.current).toBe(false);
		expect(api.clearHistory).toHaveBeenCalledTimes(2);
	});

	it("keeps the default bounds for a page without layout metadata", () => {
		const { editor } = pageEditor();
		expect(diningCanvasForEditor(editor)).toEqual(DINING_WAYFINDING_CANVAS);
	});

	it("fits the active layout's full enlarged canvas", () => {
		const layout = structuredClone(DINING_BOOTSTRAP_FLOORPLANS.layouts[0]);
		if (!layout) {
			throw new Error("A bootstrap layout is required");
		}
		layout.canvas = { width: 2560, height: 1520 };
		const { api, editor } = pageEditor();
		loadDiningPages(editor, [layout], { current: false });
		vi.stubGlobal("requestAnimationFrame", (callback: () => void) => callback());
		zoomToDiningCanvas(editor);
		expect(api.zoomToBounds).toHaveBeenCalledWith(
			expect.objectContaining({ x: 0, y: 0, w: 2560, h: 1520 }),
			expect.objectContaining({ inset: 40 }),
		);
	});
});
