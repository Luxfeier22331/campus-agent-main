import type { TLShapeId } from "tldraw";

export interface EditorStatus {
	kind: "error" | "idle" | "saved" | "saving";
	message: string;
}

export interface PendingWindowName {
	shapeId: TLShapeId;
	value: string;
}
