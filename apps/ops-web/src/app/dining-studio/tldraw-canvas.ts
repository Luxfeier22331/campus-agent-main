import {
	DINING_WAYFINDING_CANVAS,
	type DiningWayfindingCanvas,
} from "@campus-agent/dining/floorplans";
import type { Editor, TLPageId, TLShape } from "tldraw";

export function diningCanvasForEditor(editor: Editor): DiningWayfindingCanvas {
	return diningCanvasForPage(editor, editor.getCurrentPageId());
}

export function diningCanvasForShape(editor: Editor, shape: TLShape): DiningWayfindingCanvas {
	return diningCanvasForPage(editor, editor.getAncestorPageId(shape));
}

function diningCanvasForPage(editor: Editor, pageId: TLPageId | undefined): DiningWayfindingCanvas {
	const value = pageId ? editor.getPage(pageId)?.meta.diningCanvas : undefined;
	if (
		value &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		typeof value.width === "number" &&
		typeof value.height === "number" &&
		Number.isFinite(value.width) &&
		Number.isFinite(value.height) &&
		value.width > 0 &&
		value.height > 0
	) {
		return { width: value.width, height: value.height };
	}
	return DINING_WAYFINDING_CANVAS;
}
