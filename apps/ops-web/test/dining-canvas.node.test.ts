import {
	DINING_BOOTSTRAP_FLOORPLANS,
	DINING_WAYFINDING_CANVAS,
} from "@campus-agent/dining/floorplans";
import type { Editor, TLPageId, TLShape } from "tldraw";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	loadDiningPages,
	pageIdForFloor,
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
	let currentPageId = "page:initial" as TLPageId;
	const api = {
		clearHistory: vi.fn(),
		createPage: vi.fn((page: Page) => pages.set(page.id, page)),
		createShapes: vi.fn(),
		deletePage: vi.fn((id: TLPageId) => pages.delete(id)),
		getAncestorPageId: vi.fn((shape: TLShape) => shape.parentId),
		getCurrentPageId: () => currentPageId,
		getPage: (id: TLPageId) => pages.get(id),
		getPages: () => [...pages.values()],
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
