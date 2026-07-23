import { maybeSnapToGrid, StateNode, type TLStateNodeConstructor, type VecModel } from "tldraw";

export type DiningCreationKind =
	| "entrance"
	| "landmark"
	| "partition"
	| "region"
	| "structure"
	| "window";

type PlacementHandler = (point: VecModel) => void;

let placementHandler: PlacementHandler | null = null;
let pendingKind: DiningCreationKind | null = null;

export function configureDiningCreateTool(
	kind: DiningCreationKind,
	handler: PlacementHandler,
): void {
	pendingKind = kind;
	placementHandler = handler;
}

export function cancelDiningCreateTool(): void {
	pendingKind = null;
	placementHandler = null;
}

export function getDiningCreationKind(): DiningCreationKind | null {
	return pendingKind;
}

class DiningCreateIdle extends StateNode {
	static override id = "idle";

	override onEnter(): void {
		this.editor.setCursor({ rotation: 0, type: "cross" });
	}

	override onPointerDown(): void {
		const handler = placementHandler;
		const point = maybeSnapToGrid(this.editor.inputs.getCurrentPagePoint(), this.editor);
		cancelDiningCreateTool();
		if (handler) {
			handler(point);
		}
		this.editor.setCurrentTool("select");
	}

	override onCancel(): void {
		cancelDiningCreateTool();
		this.editor.setCurrentTool("select");
	}

	override onInterrupt(): void {
		cancelDiningCreateTool();
		this.editor.setCurrentTool("select");
	}
}

export class DiningCreateTool extends StateNode {
	static override id = "dining-create";
	static override initial = "idle";

	static override children(): TLStateNodeConstructor[] {
		return [DiningCreateIdle];
	}
}

export const DINING_EDITOR_TOOLS = [DiningCreateTool];
