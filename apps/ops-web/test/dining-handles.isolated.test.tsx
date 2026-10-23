import { createShapeId, createTLStore, Editor } from "@tldraw/editor";
import { describe, expect, it, vi } from "vitest";
import {
	DINING_TLDRAW_OVERLAY_UTILS,
	DINING_TLDRAW_SHAPE_UTILS,
	DINING_TLDRAW_TOOLS,
} from "../src/app/dining-studio/tldraw-policy";

vi.hoisted(() => {
	window.matchMedia = vi.fn().mockReturnValue({
		addEventListener: vi.fn(),
		matches: false,
		removeEventListener: vi.fn(),
	});
});

describe("Dining canvas node handles", () => {
	it("exposes and hit-tests every selected partition node through the editor overlays", () => {
		const container = document.createElement("div");
		document.body.appendChild(container);
		const editor = new Editor({
			bindingUtils: [],
			getContainer: () => container,
			initialState: "select",
			overlayUtils: DINING_TLDRAW_OVERLAY_UTILS,
			shapeUtils: DINING_TLDRAW_SHAPE_UTILS,
			store: createTLStore({ bindingUtils: [], shapeUtils: DINING_TLDRAW_SHAPE_UTILS }),
			tools: DINING_TLDRAW_TOOLS,
		});
		try {
			const id = createShapeId("partition-with-bend");
			editor.createShape({
				id,
				props: {
					closed: false,
					entityId: "partition-01",
					layer: "partition",
					points: [
						{ x: 0, y: 0 },
						{ x: 100, y: 80 },
						{ x: 240, y: 0 },
					],
				},
				type: "dining-path",
				x: 100,
				y: 140,
			});
			editor.select(id);
			const handleOverlay = editor.overlays.getOverlayUtil("shape_handle");
			expect(handleOverlay.isActive()).toBe(true);
			expect(handleOverlay.getOverlays()).toHaveLength(3);
			for (const [index, point] of [
				{ x: 100, y: 140 },
				{ x: 200, y: 220 },
				{ x: 340, y: 140 },
			].entries()) {
				expect(editor.overlays.getOverlayAtPoint(point)).toMatchObject({
					type: "shape_handle",
					props: { shapeId: id, handle: { id: String(index), type: "vertex" } },
				});
			}
			editor.selectNone();
			expect(handleOverlay.isActive()).toBe(false);
			expect(editor.overlays.getOverlayAtPoint({ x: 200, y: 220 })).toBeNull();
		} finally {
			editor.dispose();
			container.remove();
		}
	});
});
