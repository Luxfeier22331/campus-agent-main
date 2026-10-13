import type { TLContent } from "@tldraw/editor";
import {
	createShapeId,
	defaultOverlayUtils,
	type Editor,
	HandTool,
	SelectTool,
	type TLShape,
	type TldrawOptions,
	ZoomTool,
} from "tldraw";

import {
	DINING_EDITOR_SHAPE_UTILS,
	diningShapeEntityId,
	isDiningEditorShape,
} from "./tldraw-shapes";
import { DINING_EDITOR_TOOLS, nextEntityId } from "./tldraw-tools";

export const DINING_TLDRAW_ASSET_UTILS = [] as const;
export const DINING_TLDRAW_OVERLAY_UTILS = defaultOverlayUtils;
export const DINING_TLDRAW_SHAPE_UTILS = DINING_EDITOR_SHAPE_UTILS;
export const DINING_TLDRAW_TOOLS = [
	SelectTool,
	HandTool,
	ZoomTool,
	...DINING_EDITOR_TOOLS,
] as const;

export const DINING_ALLOWED_ACTION_IDS = new Set([
	"align-bottom",
	"align-center-horizontal",
	"align-center-vertical",
	"align-left",
	"align-right",
	"align-top",
	"back-to-content",
	"copy",
	"cut",
	"delete",
	"distribute-horizontal",
	"distribute-vertical",
	"duplicate",
	"paste",
	"redo",
	"select-zoom-tool",
	"select-all",
	"select-none",
	"toggle-grid",
	"toggle-lock",
	"toggle-snap-mode",
	"toggle-tool-lock",
	"undo",
	"zoom-in",
	"zoom-out",
	"zoom-to-100",
	"zoom-to-fit",
	"zoom-to-selection",
]);

export function createDiningTldrawOptions(
	onRejectedContent: (message: string) => void,
): Partial<TldrawOptions> {
	return {
		actionShortcutsLocation: "toolbar",
		createTextOnCanvasDoubleClick: false,
		experimental__onDropOnCanvas: () => {
			onRejectedContent("食堂地图不接受拖入的外部内容");
			return true;
		},
		onBeforeCopyToClipboard: ({ content, operation }) => {
			const shapes = content.shapes.filter(isDuplicableDiningShape);
			if (operation === "cut" && shapes.length !== content.shapes.length) {
				onRejectedContent("外轮廓和参考图不能剪切");
				return false;
			}
			if (shapes.length === 0) {
				onRejectedContent("所选元素不能复制");
				return false;
			}
			const allowedIds = new Set(shapes.map((shape) => shape.id));
			return {
				...content,
				assets: [],
				bindings: [],
				rootShapeIds: content.rootShapeIds.filter((id) => allowedIds.has(id)),
				shapes,
				users: [],
			};
		},
		onBeforePasteFromClipboard: ({ content }) => {
			if (content.type !== "tldraw" || !isPrepariableDiningContent(content.content)) {
				onRejectedContent("只能粘贴从当前食堂地图复制的元素");
				return false;
			}
			return content;
		},
	};
}

export function installDiningExternalContentHandlers(
	editor: Editor,
	onRejectedContent: (message: string) => void,
): void {
	const reject = () => {
		onRejectedContent("只能粘贴从当前食堂地图复制的元素");
	};
	editor.registerExternalContentHandler("tldraw", async (externalContent) => {
		const prepared = prepareDiningContent(editor, externalContent.content);
		if (!prepared) {
			reject();
			return;
		}
		editor.markHistoryStoppingPoint("paste-dining-elements");
		editor.putContentOntoCurrentPage(prepared, {
			...(externalContent.point ? { point: externalContent.point } : {}),
			preserveIds: true,
			select: true,
		});
	});
	editor.registerExternalContentHandler("embed", reject);
	editor.registerExternalContentHandler("excalidraw", reject);
	editor.registerExternalContentHandler("file-replace", reject);
	editor.registerExternalContentHandler("files", reject);
	editor.registerExternalContentHandler("svg-text", reject);
	editor.registerExternalContentHandler("text", reject);
	editor.registerExternalContentHandler("url", reject);
}

export function duplicateDiningSelection(editor: Editor): boolean {
	const selected = editor.getSelectedShapes();
	if (selected.length === 0 || selected.some((shape) => !isDuplicableDiningShape(shape))) {
		return false;
	}
	const content = editor.getContentFromCurrentPage(selected);
	if (!content) {
		return false;
	}
	const prepared = prepareDiningContent(editor, content);
	if (!prepared) {
		return false;
	}
	editor.markHistoryStoppingPoint("duplicate-dining-elements");
	editor.putContentOntoCurrentPage(prepared, { preserveIds: true, select: true });
	return true;
}

export function runDiningHistoryAction(
	editor: Editor,
	direction: "redo" | "undo",
	firstAction?: () => void,
): boolean {
	const before = diningDocumentFingerprint(editor);
	firstAction?.();
	if (!firstAction) {
		editor[direction]();
	}
	// Mobile tldraw UI can record focus-only history entries while closing a popover.
	for (let attempts = 0; attempts < 32; attempts += 1) {
		if (diningDocumentFingerprint(editor) !== before) {
			return true;
		}
		const canContinue = direction === "undo" ? editor.getCanUndo() : editor.getCanRedo();
		if (!canContinue) {
			return false;
		}
		editor[direction]();
	}
	return diningDocumentFingerprint(editor) !== before;
}

export function prepareDiningContent(editor: Editor, content: TLContent): TLContent | null {
	if (!isPrepariableDiningContent(content)) {
		return null;
	}

	const idMap = new Map(content.shapes.map((shape) => [shape.id, createShapeId()]));
	const usedEntityIds = editor
		.getCurrentPageShapes()
		.flatMap((shape) => diningShapeEntityId(shape) ?? []);
	const shapes = content.shapes.map((shape) => {
		const next = reidentifyDiningShape(shape, usedEntityIds);
		return { ...next, id: requiredMappedShapeId(idMap, shape.id) };
	});
	return {
		...content,
		assets: [],
		bindings: [],
		rootShapeIds: content.rootShapeIds.map((id) => requiredMappedShapeId(idMap, id)),
		shapes,
		users: [],
	};
}

function isPrepariableDiningContent(content: TLContent): boolean {
	if (
		content.shapes.length === 0 ||
		content.assets.length > 0 ||
		(content.bindings?.length ?? 0) > 0 ||
		(content.users?.length ?? 0) > 0 ||
		content.shapes.some((shape) => !isDuplicableDiningShape(shape))
	) {
		return false;
	}
	const sourceIds = new Set(content.shapes.map((shape) => shape.id));
	return (
		sourceIds.size === content.shapes.length &&
		content.rootShapeIds.length === content.shapes.length &&
		content.rootShapeIds.every((id) => sourceIds.has(id)) &&
		content.shapes.every((shape) => !sourceIds.has(shape.parentId as TLShape["id"]))
	);
}

function diningDocumentFingerprint(editor: Editor): string {
	return editor
		.getCurrentPageShapes()
		.map((shape) => JSON.stringify(shape))
		.sort()
		.join("\n");
}

function requiredMappedShapeId(
	idMap: Map<TLShape["id"], TLShape["id"]>,
	sourceId: TLShape["id"],
): TLShape["id"] {
	const id = idMap.get(sourceId);
	if (!id) {
		throw new Error(`Dining clipboard shape id is not mapped: ${sourceId}`);
	}
	return id;
}

export function isDuplicableDiningShape(shape: TLShape): boolean {
	return (
		isDiningEditorShape(shape) && !(shape.type === "dining-path" && shape.props.layer === "outline")
	);
}

function reidentifyDiningShape(shape: TLShape, usedEntityIds: string[]): TLShape {
	if (!isDiningEditorShape(shape)) {
		return shape;
	}
	const prefix =
		shape.type === "dining-path" ? shape.props.layer : shape.type.slice("dining-".length);
	const entityId = nextEntityId(prefix, usedEntityIds);
	usedEntityIds.push(entityId);
	if (shape.type === "dining-path") {
		return { ...shape, props: { ...shape.props, entityId } };
	}
	return {
		...shape,
		props: {
			...shape.props,
			entityId,
			...(shape.type === "dining-window" ? { label: "" } : {}),
		},
		meta: { ...shape.meta, diningNeedsName: shape.type === "dining-window" },
	} as TLShape;
}
