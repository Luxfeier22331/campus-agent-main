import {
	BaseBoxShapeTool,
	createShapeId,
	maybeSnapToGrid,
	StateNode,
	type TLStateNodeConstructor,
} from "tldraw";

import { diningShapeEntityId } from "./tldraw-shapes";

export type DiningCreationKind =
	| "entrance"
	| "landmark"
	| "partition"
	| "region"
	| "structure"
	| "window";

export class DiningWindowTool extends BaseBoxShapeTool {
	static override id = "dining-window";
	shapeType = "dining-window" as const;
}

export class DiningRegionTool extends BaseBoxShapeTool {
	static override id = "dining-region";
	shapeType = "dining-region" as const;
}

export class DiningEntranceTool extends BaseBoxShapeTool {
	static override id = "dining-entrance";
	shapeType = "dining-entrance" as const;
}

export class DiningLandmarkTool extends BaseBoxShapeTool {
	static override id = "dining-landmark";
	shapeType = "dining-landmark" as const;
}

abstract class DiningPathTool extends StateNode {
	static override initial = "idle";

	static override children(): TLStateNodeConstructor[] {
		return [DiningPathIdle];
	}

	abstract readonly layer: "partition" | "structure";

	createAtCurrentPoint(): void {
		const point = maybeSnapToGrid(this.editor.inputs.getCurrentPagePoint(), this.editor);
		const id = nextEntityId(
			this.layer,
			this.editor.getCurrentPageShapes().flatMap((shape) => diningShapeEntityId(shape) ?? []),
		);
		const shapeId = createShapeId();
		this.editor.markHistoryStoppingPoint(`create:${id}`);
		this.editor.run(
			() => {
				this.editor.createShape({
					id: shapeId,
					props: {
						closed: this.layer === "structure",
						entityId: id,
						layer: this.layer,
						points:
							this.layer === "structure"
								? [
										{ x: 0, y: 0 },
										{ x: 160, y: 0 },
										{ x: 160, y: 96 },
										{ x: 0, y: 96 },
									]
								: [
										{ x: 0, y: 0 },
										{ x: 160, y: 0 },
									],
					},
					type: "dining-path",
					x: point.x,
					y: point.y,
				});
				this.editor.select(shapeId);
			},
			{ history: "record" },
		);
		if (this.editor.getInstanceState().isToolLocked) {
			this.transition("idle");
		} else {
			this.editor.setCurrentTool("select.idle");
		}
	}
}

class DiningPathIdle extends StateNode {
	static override id = "idle";

	override onEnter(): void {
		this.editor.setCursor({ rotation: 0, type: "cross" });
	}

	override onPointerDown(): void {
		(this.parent as DiningPathTool).createAtCurrentPoint();
	}

	override onCancel(): void {
		this.editor.setCurrentTool("select");
	}

	override onInterrupt(): void {
		this.editor.setCurrentTool("select");
	}
}

export class DiningStructureTool extends DiningPathTool {
	static override id = "dining-structure";
	readonly layer = "structure" as const;
}

export class DiningPartitionTool extends DiningPathTool {
	static override id = "dining-partition";
	readonly layer = "partition" as const;
}

export const DINING_EDITOR_TOOLS = [
	DiningWindowTool,
	DiningRegionTool,
	DiningEntranceTool,
	DiningLandmarkTool,
	DiningStructureTool,
	DiningPartitionTool,
];

export function toolIdForDiningCreation(kind: DiningCreationKind): string {
	return `dining-${kind}`;
}

export function nextEntityId(prefix: string, existing: readonly string[]): string {
	const used = new Set(existing);
	for (let number = 1; number < 10_000; number += 1) {
		const candidate = `${prefix}-${String(number).padStart(2, "0")}`;
		if (!used.has(candidate)) {
			return candidate;
		}
	}
	throw new Error(`无法为 ${prefix} 分配新标识`);
}
