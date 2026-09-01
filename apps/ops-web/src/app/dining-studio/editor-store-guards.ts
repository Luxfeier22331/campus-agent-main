import type { Editor } from "tldraw";
import type { EditorStatus } from "./editor-types";
import { type DiningEditorShape, diningShapeEntityId, isDiningEditorShape } from "./tldraw-shapes";
import { nextEntityId } from "./tldraw-tools";

export function installDiningStoreGuards(
	editor: Editor,
	setStatus: (status: EditorStatus) => void,
	onNeedsWindowName: (shapeId: string) => void,
): void {
	editor.sideEffects.registerBeforeCreateHandler("shape", (shape) => {
		if (!isDiningEditorShape(shape)) {
			return shape;
		}
		if (shape.type === "dining-path" && shape.props.layer === "outline") {
			return shape;
		}
		const prefix =
			shape.type === "dining-path" ? shape.props.layer : shape.type.slice("dining-".length);
		const existing = editor
			.getCurrentPageShapes()
			.flatMap((candidate) => diningShapeEntityId(candidate) ?? []);
		if (shape.props.entityId && !existing.includes(shape.props.entityId)) {
			return shape;
		}
		const entityId = nextEntityId(prefix, existing);
		return prepareDiningShapeForCreation(shape, entityId);
	});
	editor.sideEffects.registerBeforeDeleteHandler("shape", (shape) => {
		if (shape.type === "dining-path" && shape.props.layer === "outline") {
			setStatus({ kind: "error", message: "外轮廓不能删除" });
			return false;
		}
		if (shape.type === "dining-window") {
			const windows = editor
				.getCurrentPageShapes()
				.filter((candidate) => candidate.type === "dining-window");
			const selectedWindows = windows.filter((candidate) =>
				editor.getSelectedShapeIds().includes(candidate.id),
			);
			if (windows.length - Math.max(1, selectedWindows.length) < 1) {
				setStatus({ kind: "error", message: "地图至少需要保留一个窗口" });
				return false;
			}
		}
		return;
	});
	editor.sideEffects.registerAfterCreateHandler("shape", (shape) => {
		if (shape.type === "dining-window" && shape.meta.diningNeedsName === true) {
			onNeedsWindowName(shape.id);
			return;
		}
		if (isDiningEditorShape(shape)) {
			return;
		}
		editor.run(() => editor.deleteShape(shape.id), { history: "ignore" });
		setStatus({ kind: "error", message: "该元素不属于食堂地图，已移除" });
	});
}

function prepareDiningShapeForCreation(
	shape: DiningEditorShape,
	entityId: string,
): DiningEditorShape {
	switch (shape.type) {
		case "dining-window":
			return {
				...shape,
				meta: { ...shape.meta, diningNeedsName: true },
				props: { ...shape.props, entityId, label: "" },
			};
		case "dining-entrance":
			return { ...shape, props: { ...shape.props, entityId } };
		case "dining-landmark":
			return { ...shape, props: { ...shape.props, entityId } };
		case "dining-region":
			return { ...shape, props: { ...shape.props, entityId } };
		case "dining-path":
			return { ...shape, props: { ...shape.props, entityId } };
		default:
			return shape;
	}
}
