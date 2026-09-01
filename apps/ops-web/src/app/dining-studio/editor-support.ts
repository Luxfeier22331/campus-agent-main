import {
	canonicalizeDiningFloorplanBundle,
	type DiningFloorplanBundleV1,
	type DiningWayfindingDiagnostic,
	type DiningWayfindingLayout,
} from "@campus-agent/dining/floorplans";
import { PageRecordType } from "@tldraw/tlschema";
import { Box, type Editor, type TLShape } from "tldraw";
import { layoutToTldrawRecords, tldrawRecordsToLayout } from "./tldraw-adapter";
import { isDiningEditorShape } from "./tldraw-shapes";

export function eventTargetElement(target: EventTarget | null): Element | null {
	return target instanceof Element ? target : null;
}

export function isTldrawCanvasTarget(target: EventTarget | null): boolean {
	return Boolean(eventTargetElement(target)?.closest(".tl-canvas"));
}

export function isTldrawKeyboardSurface(target: EventTarget | null): boolean {
	const element = eventTargetElement(target);
	return Boolean(
		element &&
			(element.closest(".tl-canvas") || element.closest('.tl-container[role="application"]')) &&
			!element.closest(
				'input, textarea, select, button, a, [contenteditable], [role="button"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="combobox"], [role="slider"]',
			),
	);
}

export function collectBundle(
	editor: Editor,
	base: DiningFloorplanBundleV1,
): DiningFloorplanBundleV1 {
	return canonicalizeDiningFloorplanBundle({
		...base,
		layouts: base.layouts.map((layout) =>
			tldrawRecordsToLayout(shapesForPage(editor, layout.floorId), layout),
		),
	});
}

export function shapesForPage(editor: Editor, floorId: string): TLShape[] {
	return [...editor.getPageShapeIds(pageIdForFloor(floorId))].flatMap((id) => {
		const shape = editor.getShape(id);
		return shape ? [shape] : [];
	});
}

export function hasDiningWindowAwaitingName(editor: Editor, floorId: string): boolean {
	return shapesForPage(editor, floorId).some(
		(shape) => shape.type === "dining-window" && shape.meta.diningNeedsName === true,
	);
}

export function loadDiningPages(
	editor: Editor,
	layouts: readonly DiningWayfindingLayout[],
	suppressRef: { current: boolean },
): void {
	const originalPages = editor.getPages();
	suppressRef.current = true;
	try {
		for (const layout of layouts) {
			const pageId = pageIdForFloor(layout.floorId);
			if (!editor.getPage(pageId)) {
				editor.run(() => editor.createPage({ id: pageId, name: layout.label }), {
					history: "ignore",
				});
				editor.setCurrentPage(pageId);
				editor.run(() => editor.createShapes(layoutToTldrawRecords(layout)), { history: "ignore" });
			}
		}
		const first = layouts[0];
		if (first) {
			editor.setCurrentPage(pageIdForFloor(first.floorId));
		}
		for (const page of originalPages) {
			if (!layouts.some((layout) => page.id === pageIdForFloor(layout.floorId))) {
				editor.run(() => editor.deletePage(page.id), { history: "ignore" });
			}
		}
		editor.clearHistory();
	} finally {
		suppressRef.current = false;
	}
}

export function markInvalidShapes(
	editor: Editor,
	floorId: string,
	diagnostics: readonly DiningWayfindingDiagnostic[],
	suppressRef: { current: boolean },
): void {
	const invalidIds = new Set(
		diagnostics.flatMap((diagnostic) => diagnostic.entities.map((entity) => entity.id)),
	);
	const updates = shapesForPage(editor, floorId)
		.filter(isDiningEditorShape)
		.flatMap((shape) => {
			const invalid = invalidIds.has(shape.props.entityId);
			return shape.meta.diningInvalid === invalid
				? []
				: [{ id: shape.id, meta: { ...shape.meta, diningInvalid: invalid }, type: shape.type }];
		});
	if (updates.length === 0) {
		return;
	}
	suppressRef.current = true;
	try {
		editor.run(() => editor.updateShapes(updates as never), { history: "ignore" });
	} finally {
		suppressRef.current = false;
	}
}

export function pageIdForFloor(floorId: string) {
	return PageRecordType.createId(`dining-${floorId}`);
}

export function zoomToDiningCanvas(editor: Editor): void {
	let attemptsRemaining = 12;
	const fitWhenReady = () => {
		const viewport = editor.getViewportScreenBounds();
		if ((viewport.width < 160 || viewport.height < 160) && attemptsRemaining > 0) {
			attemptsRemaining -= 1;
			requestAnimationFrame(fitWhenReady);
			return;
		}
		editor.zoomToBounds(new Box(0, 0, 1280, 760), {
			animation: { duration: 180 },
			inset: 40,
		});
	};
	requestAnimationFrame(fitWhenReady);
}

export function setMembership(current: Set<string>, value: string, included: boolean): Set<string> {
	const next = new Set(current);
	if (included) {
		next.add(value);
	} else {
		next.delete(value);
	}
	return next;
}
