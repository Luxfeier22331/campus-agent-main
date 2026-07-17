import type { Editor, TLShape } from "tldraw";

import {
	assertDiningWayfindingLayout,
	canonicalizeDiningWayfindingLayout,
	type DiningWayfindingIconKey,
	type DiningWayfindingLayout,
	type DiningWayfindingPoint,
} from "../src/floorplans/wayfinding-layout";
import { isReferenceShape, layoutToTldrawRecords, tldrawRecordsToLayout } from "./tldraw-adapter";

type CreateEntity =
	| {
			id: string;
			kind: "partition" | "structure";
			points: DiningWayfindingPoint[];
	  }
	| {
			height: number;
			id: string;
			kind: "entrance";
			label: string;
			side: "bottom" | "left" | "right" | "top";
			width: number;
			x: number;
			y: number;
	  }
	| {
			height: number;
			id: string;
			kind: "landmark";
			label: string;
			landmarkKind: "seating" | "stairs";
			width: number;
			x: number;
			y: number;
	  }
	| {
			height: number;
			iconKey: DiningWayfindingIconKey | null;
			id: string;
			kind: "region";
			label: string;
			width: number;
			x: number;
			y: number;
	  }
	| {
			height: number;
			id: string;
			kind: "window";
			label: string;
			width: number;
			x: number;
			y: number;
	  };

export type DiningFloorplanEditorCommand =
	| { entity: CreateEntity; op: "create" }
	| { ids: string[]; op: "delete" }
	| {
			ids: string[];
			op: "align";
			position: "bottom" | "center-horizontal" | "center-vertical" | "left" | "right" | "top";
	  }
	| { axis: "horizontal" | "vertical"; ids: string[]; op: "distribute" }
	| { id: string; label: string; op: "setLabel" }
	| { iconKey: DiningWayfindingIconKey | null; id: string; op: "setIcon" }
	| { op: "renumber" }
	| {
			id: string;
			op: "update";
			patch: Partial<{
				height: number;
				id: string;
				label: string;
				points: DiningWayfindingPoint[];
				side: "bottom" | "left" | "right" | "top";
				width: number;
				x: number;
				y: number;
			}>;
	  };

export interface DiningFloorplanEditorBridge {
	applyCommands(commands: DiningFloorplanEditorCommand[]): DiningWayfindingLayout;
	readLayout(): DiningWayfindingLayout;
	save(): Promise<DiningWayfindingLayout>;
	validate(): DiningWayfindingLayout;
}

export function applyDiningFloorplanEditorCommands(input: {
	baseLayout: DiningWayfindingLayout;
	commands: DiningFloorplanEditorCommand[];
	editor: Editor;
}): DiningWayfindingLayout {
	const current = tldrawRecordsToLayout(input.editor.getCurrentPageShapes(), input.baseLayout);
	const canonical = applyDiningFloorplanCommands(current, input.commands);
	const mark = input.editor.markHistoryStoppingPoint("dining-command-batch");
	try {
		input.editor.run(() => replaceCanonicalShapes(input.editor, canonical));
	} catch (error) {
		input.editor.bailToMark(mark);
		throw error;
	}
	return canonical;
}

export function applyDiningFloorplanCommands(
	baseLayout: DiningWayfindingLayout,
	commands: DiningFloorplanEditorCommand[],
): DiningWayfindingLayout {
	let layout = canonicalizeDiningWayfindingLayout(baseLayout);
	for (const command of commands) {
		layout = applyCommand(layout, command);
	}
	layout.windows.sort((left, right) => left.anchorId.localeCompare(right.anchorId));
	assertDiningWayfindingLayout(layout);
	return canonicalizeDiningWayfindingLayout(layout);
}

export function replaceCanonicalShapes(editor: Editor, layout: DiningWayfindingLayout): void {
	const canonicalShapes = editor.getCurrentPageShapes().filter((shape) => !isReferenceShape(shape));
	const localStateByEntityId = new Map(
		canonicalShapes.flatMap((shape) => {
			const entityId = shapeEntityId(shape);
			return entityId ? [[entityId, { isLocked: shape.isLocked, opacity: shape.opacity }]] : [];
		}),
	);
	const canonicalIds = canonicalShapes.map((shape) => shape.id);
	if (canonicalIds.length > 0) {
		editor.deleteShapes(canonicalIds);
	}
	editor.createShapes(
		layoutToTldrawRecords(layout).map((record) => {
			const entityId = record.props?.entityId;
			const localState = entityId ? localStateByEntityId.get(entityId) : undefined;
			return localState ? { ...record, ...localState } : record;
		}),
	);
}

function shapeEntityId(shape: TLShape): string | null {
	return shape.type === "dining-marker" || shape.type === "dining-path"
		? shape.props.entityId
		: null;
}

function applyCommand(
	layout: DiningWayfindingLayout,
	command: DiningFloorplanEditorCommand,
): DiningWayfindingLayout {
	const next = structuredClone(layout);
	switch (command.op) {
		case "create":
			createEntity(next, command.entity);
			break;
		case "delete":
			for (const id of command.ids) {
				deleteEntity(next, id);
			}
			break;
		case "align":
			alignEntities(next, command.ids, command.position);
			break;
		case "distribute":
			distributeEntities(next, command.ids, command.axis);
			break;
		case "renumber":
			renumberWindows(next);
			break;
		case "setIcon": {
			const region = next.regions.find((item) => item.id === command.id);
			if (!region) {
				throw new Error(`Dining region not found: ${command.id}`);
			}
			region.iconKey = command.iconKey;
			break;
		}
		case "setLabel": {
			const entity = findRect(next, command.id);
			if (!entity) {
				throw new Error(`Dining marker not found: ${command.id}`);
			}
			entity.label = command.label;
			break;
		}
		case "update":
			updateEntity(next, command.id, command.patch);
			break;
		default: {
			const exhaustive: never = command;
			throw new Error(`Unsupported dining editor command: ${JSON.stringify(exhaustive)}`);
		}
	}
	return next;
}

function createEntity(layout: DiningWayfindingLayout, entity: CreateEntity): void {
	if (findEntity(layout, entity.id)) {
		throw new Error(`Dining entity already exists: ${entity.id}`);
	}
	if ("points" in entity) {
		layout[`${entity.kind}s`].push({ id: entity.id, points: entity.points });
		return;
	}
	const rect = {
		height: entity.height,
		label: entity.label,
		width: entity.width,
		x: entity.x,
		y: entity.y,
	};
	if (entity.kind === "window") {
		layout.windows.push({ anchorId: entity.id, ...rect });
	} else if (entity.kind === "region") {
		layout.regions.push({ iconKey: entity.iconKey, id: entity.id, ...rect });
	} else if (entity.kind === "landmark") {
		layout.landmarks.push({ id: entity.id, kind: entity.landmarkKind, ...rect });
	} else if (entity.kind === "entrance") {
		layout.entrances.push({ id: entity.id, side: entity.side, ...rect });
	}
}

function deleteEntity(layout: DiningWayfindingLayout, id: string): void {
	if (id === "outline") {
		throw new Error("Dining outline cannot be deleted.");
	}
	const before = entityCount(layout);
	layout.entrances = layout.entrances.filter((item) => item.id !== id);
	layout.landmarks = layout.landmarks.filter((item) => item.id !== id);
	layout.partitions = layout.partitions.filter((item) => item.id !== id);
	layout.regions = layout.regions.filter((item) => item.id !== id);
	layout.structures = layout.structures.filter((item) => item.id !== id);
	layout.windows = layout.windows.filter((item) => item.anchorId !== id);
	if (before === entityCount(layout)) {
		throw new Error(`Dining entity not found: ${id}`);
	}
}

function updateEntity(
	layout: DiningWayfindingLayout,
	id: string,
	patch: Extract<DiningFloorplanEditorCommand, { op: "update" }>["patch"],
): void {
	if (id === "outline") {
		if (!patch.points) {
			throw new Error("Dining outline update requires points.");
		}
		layout.outline.points = patch.points;
		return;
	}
	const path = [...layout.structures, ...layout.partitions].find((item) => item.id === id);
	if (path) {
		if (patch.points) {
			path.points = patch.points;
		}
		if (patch.id) {
			path.id = patch.id;
		}
		return;
	}
	const rect = findRect(layout, id);
	if (!rect) {
		throw new Error(`Dining entity not found: ${id}`);
	}
	for (const key of ["height", "label", "width", "x", "y"] as const) {
		if (patch[key] !== undefined) {
			Object.assign(rect, { [key]: patch[key] });
		}
	}
	if (patch.id) {
		if ("anchorId" in rect) {
			rect.anchorId = patch.id;
		} else {
			rect.id = patch.id;
		}
	}
	if (patch.side !== undefined) {
		const entrance = layout.entrances.find((item) => item === rect);
		if (!entrance) {
			throw new Error(`Dining entity is not an entrance: ${id}`);
		}
		entrance.side = patch.side;
	}
}

function alignEntities(
	layout: DiningWayfindingLayout,
	ids: string[],
	position: Extract<DiningFloorplanEditorCommand, { op: "align" }>["position"],
): void {
	const entities = ids.map((id) => requireRect(layout, id));
	if (entities.length < 2) {
		throw new Error("Dining align requires at least two markers.");
	}
	const left = Math.min(...entities.map((item) => item.x));
	const right = Math.max(...entities.map((item) => item.x + item.width));
	const top = Math.min(...entities.map((item) => item.y));
	const bottom = Math.max(...entities.map((item) => item.y + item.height));
	for (const entity of entities) {
		if (position === "left") {
			entity.x = left;
		} else if (position === "right") {
			entity.x = right - entity.width;
		} else if (position === "center-horizontal") {
			entity.x = (left + right - entity.width) / 2;
		} else if (position === "top") {
			entity.y = top;
		} else if (position === "bottom") {
			entity.y = bottom - entity.height;
		} else {
			entity.y = (top + bottom - entity.height) / 2;
		}
	}
}

function distributeEntities(
	layout: DiningWayfindingLayout,
	ids: string[],
	axis: "horizontal" | "vertical",
): void {
	const entities = ids.map((id) => requireRect(layout, id));
	if (entities.length < 3) {
		throw new Error("Dining distribute requires at least three markers.");
	}
	const horizontal = axis === "horizontal";
	entities.sort((left, right) => (horizontal ? left.x - right.x : left.y - right.y));
	const first = entities[0];
	const last = entities.at(-1);
	if (!(first && last)) {
		return;
	}
	const start = horizontal ? first.x : first.y;
	const end = horizontal ? last.x + last.width : last.y + last.height;
	const occupied = entities.reduce(
		(total, entity) => total + (horizontal ? entity.width : entity.height),
		0,
	);
	const gap = (end - start - occupied) / (entities.length - 1);
	let cursor = start;
	for (const entity of entities) {
		if (horizontal) {
			entity.x = cursor;
		} else {
			entity.y = cursor;
		}
		cursor += (horizontal ? entity.width : entity.height) + gap;
	}
}

function renumberWindows(layout: DiningWayfindingLayout): void {
	const ordered = [...layout.windows].sort(
		(left, right) =>
			left.y - right.y || left.x - right.x || left.anchorId.localeCompare(right.anchorId),
	);
	for (const [index, window] of ordered.entries()) {
		const number = index + 1;
		window.anchorId = `window-${String(number).padStart(2, "0")}`;
		window.label = `${toChineseNumber(number)}号窗口`;
	}
	layout.windows = ordered.sort((left, right) => left.anchorId.localeCompare(right.anchorId));
}

type RectEntity =
	| DiningWayfindingLayout["entrances"][number]
	| DiningWayfindingLayout["landmarks"][number]
	| DiningWayfindingLayout["regions"][number]
	| DiningWayfindingLayout["windows"][number];

function findRect(layout: DiningWayfindingLayout, id: string): RectEntity | undefined {
	return (
		layout.windows.find((item) => item.anchorId === id) ??
		layout.regions.find((item) => item.id === id) ??
		layout.entrances.find((item) => item.id === id) ??
		layout.landmarks.find((item) => item.id === id)
	);
}

function requireRect(layout: DiningWayfindingLayout, id: string): RectEntity {
	const entity = findRect(layout, id);
	if (!entity) {
		throw new Error(`Dining marker not found: ${id}`);
	}
	return entity;
}

function findEntity(layout: DiningWayfindingLayout, id: string): boolean {
	return Boolean(
		id === "outline" ||
			findRect(layout, id) ||
			layout.structures.some((item) => item.id === id) ||
			layout.partitions.some((item) => item.id === id),
	);
}

function entityCount(layout: DiningWayfindingLayout): number {
	return (
		layout.entrances.length +
		layout.landmarks.length +
		layout.partitions.length +
		layout.regions.length +
		layout.structures.length +
		layout.windows.length
	);
}

function toChineseNumber(value: number): string {
	const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
	if (value < 10) {
		return digits[value] ?? String(value);
	}
	if (value < 20) {
		return `十${value === 10 ? "" : digits[value - 10]}`;
	}
	if (value < 100) {
		const ones = value % 10;
		return `${digits[Math.floor(value / 10)]}十${ones === 0 ? "" : digits[ones]}`;
	}
	return String(value);
}
