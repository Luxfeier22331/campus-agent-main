import {
	DINING_WAYFINDING_CANVAS,
	type DiningWayfindingIconKey,
} from "@campus-agent/dining/floorplans";
import type { ReactNode } from "react";
import {
	BaseBoxShapeUtil,
	getIndices,
	HTMLContainer,
	maybeSnapToGrid,
	Polygon2d,
	Polyline2d,
	type RecordProps,
	resizeBox,
	ShapeUtil,
	SVGContainer,
	T,
	type TLHandle,
	type TLHandleDragInfo,
	type TLResizeInfo,
	type TLShape,
	type TLShapePartial,
	Vec,
} from "tldraw";

export const DINING_EDITOR_PATH_LAYERS = ["outline", "partition", "structure"] as const;
export const DINING_EDITOR_MIN_MARKER_DIMENSION = 1;
export type DiningEditorPathLayer = (typeof DINING_EDITOR_PATH_LAYERS)[number];

export interface DiningPathShapeProps {
	closed: boolean;
	entityId: string;
	layer: DiningEditorPathLayer;
	points: Array<{ x: number; y: number }>;
}

export interface DiningWindowShapeProps {
	entityId: string;
	h: number;
	label: string;
	w: number;
}

export interface DiningRegionShapeProps extends DiningWindowShapeProps {
	iconKey: DiningWayfindingIconKey | null;
}

export interface DiningEntranceShapeProps extends DiningWindowShapeProps {
	side: "bottom" | "left" | "right" | "top";
}

export interface DiningLandmarkShapeProps extends DiningWindowShapeProps {
	landmarkKind: "seating" | "stairs";
}

declare module "@tldraw/tlschema" {
	interface TLGlobalShapePropsMap {
		"dining-entrance": DiningEntranceShapeProps;
		"dining-landmark": DiningLandmarkShapeProps;
		"dining-path": DiningPathShapeProps;
		"dining-region": DiningRegionShapeProps;
		"dining-window": DiningWindowShapeProps;
	}
}

export type DiningPathShape = TLShape<"dining-path">;
export type DiningWindowShape = TLShape<"dining-window">;
export type DiningRegionShape = TLShape<"dining-region">;
export type DiningEntranceShape = TLShape<"dining-entrance">;
export type DiningLandmarkShape = TLShape<"dining-landmark">;
export type DiningMarkerShape =
	| DiningEntranceShape
	| DiningLandmarkShape
	| DiningRegionShape
	| DiningWindowShape;
export type DiningEditorShape = DiningMarkerShape | DiningPathShape;

const pointValidator = T.object({ x: T.number, y: T.number });
const boxProps = {
	entityId: T.string,
	h: T.number,
	label: T.string,
	w: T.number,
} as const;

export class DiningPathShapeUtil extends ShapeUtil<DiningPathShape> {
	static override type = "dining-path" as const;
	static override props: RecordProps<DiningPathShape> = {
		closed: T.boolean,
		entityId: T.string,
		layer: T.literalEnum(...DINING_EDITOR_PATH_LAYERS),
		points: T.arrayOf(pointValidator),
	};

	override getDefaultProps(): DiningPathShape["props"] {
		return {
			closed: true,
			entityId: "structure-01",
			layer: "structure",
			points: [
				{ x: 0, y: 0 },
				{ x: 160, y: 0 },
				{ x: 160, y: 96 },
				{ x: 0, y: 96 },
			],
		};
	}

	override canBind(): boolean {
		return false;
	}

	override canEdit(): boolean {
		return false;
	}

	override canResize(shape: DiningPathShape): boolean {
		return shape.props.layer !== "outline";
	}

	override canBeLaidOut(shape: DiningPathShape): boolean {
		return shape.props.layer !== "outline";
	}

	override onTranslate(
		_initial: DiningPathShape,
		current: DiningPathShape,
	): TLShapePartial<DiningPathShape> {
		const bounds = pathBounds(current);
		return {
			id: current.id,
			type: current.type,
			x: clamp(current.x, -bounds.x, DINING_WAYFINDING_CANVAS.width - bounds.width - bounds.x),
			y: clamp(current.y, -bounds.y, DINING_WAYFINDING_CANVAS.height - bounds.height - bounds.y),
		};
	}

	override getGeometry(shape: DiningPathShape): Polygon2d | Polyline2d {
		const points = shape.props.points.map(Vec.From);
		return shape.props.closed
			? new Polygon2d({ isFilled: shape.props.layer !== "partition", points })
			: new Polyline2d({ points });
	}

	override getHandles(shape: DiningPathShape): TLHandle[] {
		const indices = getIndices(shape.props.points.length);
		return shape.props.points.map((point, index) => {
			const shapeIndex = indices[index];
			if (!shapeIndex) {
				throw new Error("tldraw did not generate an index for every dining path point.");
			}
			return {
				id: String(index),
				index: shapeIndex,
				snapType: "point",
				type: "vertex",
				x: point.x,
				y: point.y,
			};
		});
	}

	override onHandleDrag(
		shape: DiningPathShape,
		{ handle }: TLHandleDragInfo<DiningPathShape>,
	): DiningPathShape {
		const pointIndex = Number(handle.id);
		if (!(Number.isInteger(pointIndex) && shape.props.points[pointIndex])) {
			return shape;
		}
		const point = maybeSnapToGrid(new Vec(handle.x, handle.y), this.editor);
		const bounded = {
			x: clamp(point.x, -shape.x, DINING_WAYFINDING_CANVAS.width - shape.x),
			y: clamp(point.y, -shape.y, DINING_WAYFINDING_CANVAS.height - shape.y),
		};
		return {
			...shape,
			props: {
				...shape.props,
				points: shape.props.points.map((current, index) =>
					index === pointIndex ? bounded : current,
				),
			},
		};
	}

	override onResize(
		_shape: DiningPathShape,
		info: TLResizeInfo<DiningPathShape>,
	): Partial<DiningPathShape> {
		return {
			props: {
				...info.initialShape.props,
				points: info.initialShape.props.points.map((point) => ({
					x: point.x * info.scaleX,
					y: point.y * info.scaleY,
				})),
			},
		};
	}

	override hideRotateHandle(): boolean {
		return true;
	}

	override component(shape: DiningPathShape) {
		const style = pathLayerStyle(shape.props.layer);
		return (
			<SVGContainer
				className="dining-editor-path"
				data-dining-editor-entity-id={shape.props.entityId}
				data-dining-editor-points={JSON.stringify(shape.props.points)}
				data-dining-editor-x={shape.x}
				data-dining-editor-y={shape.y}
				data-invalid={shape.meta.diningInvalid === true ? "true" : undefined}
				style={{ overflow: "visible" }}
			>
				<path
					d={pointsToPath(shape.props.points, shape.props.closed)}
					fill={style.fill}
					stroke={style.stroke}
					strokeLinecap="round"
					strokeLinejoin="round"
					strokeWidth={style.strokeWidth}
					vectorEffect="non-scaling-stroke"
				/>
			</SVGContainer>
		);
	}

	override getIndicatorPath(shape: DiningPathShape): Path2D {
		return new Path2D(pointsToPath(shape.props.points, shape.props.closed));
	}

	override getAriaDescriptor(shape: DiningPathShape): string {
		return `${pathLayerLabel(shape.props.layer)} ${shape.props.entityId}`;
	}
}

abstract class DiningBoxShapeUtil<Shape extends DiningMarkerShape> extends BaseBoxShapeUtil<Shape> {
	override canBind(): boolean {
		return false;
	}

	override canEdit(): boolean {
		return false;
	}

	override canResize(): boolean {
		return true;
	}

	override onResize(
		shape: Shape,
		info: TLResizeInfo<Shape>,
	): Omit<TLShapePartial<Shape>, "id" | "type"> {
		return clampBoxResize(
			resizeBox(shape, info, {
				minHeight: DINING_EDITOR_MIN_MARKER_DIMENSION,
				minWidth: DINING_EDITOR_MIN_MARKER_DIMENSION,
			}),
		);
	}

	override onTranslate(_initial: Shape, current: Shape): TLShapePartial<Shape> {
		return {
			id: current.id,
			type: current.type,
			x: clamp(current.x, 0, DINING_WAYFINDING_CANVAS.width - current.props.w),
			y: clamp(current.y, 0, DINING_WAYFINDING_CANVAS.height - current.props.h),
		} as TLShapePartial<Shape>;
	}

	override hideRotateHandle(): boolean {
		return true;
	}

	override getAriaDescriptor(shape: Shape): string {
		return shape.props.label;
	}

	override getIndicatorPath(shape: Shape): Path2D {
		const path = new Path2D();
		path.rect(0, 0, shape.props.w, shape.props.h);
		return path;
	}

	protected renderMarker(shape: Shape, kind: string, extra?: ReactNode) {
		return (
			<HTMLContainer
				className={`dining-editor-marker dining-editor-marker-${kind}`}
				data-dining-editor-entity-id={shape.props.entityId}
				data-dining-editor-height={shape.props.h}
				data-dining-editor-width={shape.props.w}
				data-dining-editor-x={shape.x}
				data-dining-editor-y={shape.y}
				data-invalid={shape.meta.diningInvalid === true ? "true" : undefined}
				style={{ pointerEvents: "none" }}
			>
				{extra}
				<span className="marker-label">{shape.props.label}</span>
			</HTMLContainer>
		);
	}
}

export class DiningWindowShapeUtil extends DiningBoxShapeUtil<DiningWindowShape> {
	static override type = "dining-window" as const;
	static override props: RecordProps<DiningWindowShape> = boxProps;

	override getDefaultProps(): DiningWindowShape["props"] {
		return { entityId: "", h: 72, label: "", w: 104 };
	}

	override component(shape: DiningWindowShape) {
		return this.renderMarker(shape, "window");
	}
}

function clampBoxResize<Shape extends DiningMarkerShape>(
	partial: Shape,
): Omit<TLShapePartial<Shape>, "id" | "type"> {
	const props = partial.props as Partial<{ h: number; w: number }> | undefined;
	const width = Math.min(
		props?.w ?? DINING_WAYFINDING_CANVAS.width,
		DINING_WAYFINDING_CANVAS.width,
	);
	const height = Math.min(
		props?.h ?? DINING_WAYFINDING_CANVAS.height,
		DINING_WAYFINDING_CANVAS.height,
	);
	return {
		...partial,
		x: clamp(partial.x ?? 0, 0, DINING_WAYFINDING_CANVAS.width - width),
		y: clamp(partial.y ?? 0, 0, DINING_WAYFINDING_CANVAS.height - height),
		props: { ...partial.props, w: width, h: height } as Shape["props"],
	} as unknown as Omit<TLShapePartial<Shape>, "id" | "type">;
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function pathBounds(shape: DiningPathShape): {
	height: number;
	width: number;
	x: number;
	y: number;
} {
	const xs = shape.props.points.map((point) => point.x);
	const ys = shape.props.points.map((point) => point.y);
	const x = Math.min(...xs);
	const y = Math.min(...ys);
	return {
		height: Math.max(...ys) - y,
		width: Math.max(...xs) - x,
		x,
		y,
	};
}

export class DiningRegionShapeUtil extends DiningBoxShapeUtil<DiningRegionShape> {
	static override type = "dining-region" as const;
	static override props: RecordProps<DiningRegionShape> = {
		...boxProps,
		iconKey: T.literalEnum("armchair", "coffee", "door-open", "stairs", "utensils").nullable(),
	};

	override getDefaultProps(): DiningRegionShape["props"] {
		return { entityId: "", h: 144, iconKey: "utensils", label: "就餐区", w: 240 };
	}

	override component(shape: DiningRegionShape) {
		return this.renderMarker(shape, "region");
	}
}

export class DiningEntranceShapeUtil extends DiningBoxShapeUtil<DiningEntranceShape> {
	static override type = "dining-entrance" as const;
	static override props: RecordProps<DiningEntranceShape> = {
		...boxProps,
		side: T.literalEnum("bottom", "left", "right", "top"),
	};

	override getDefaultProps(): DiningEntranceShape["props"] {
		return { entityId: "", h: 32, label: "入口", side: "bottom", w: 88 };
	}

	override component(shape: DiningEntranceShape) {
		return (
			<HTMLContainer
				className="dining-editor-marker dining-editor-marker-entrance"
				data-dining-editor-entity-id={shape.props.entityId}
				data-dining-editor-height={shape.props.h}
				data-dining-editor-width={shape.props.w}
				data-dining-editor-x={shape.x}
				data-dining-editor-y={shape.y}
				data-invalid={shape.meta.diningInvalid === true ? "true" : undefined}
				data-side={shape.props.side}
				style={{ pointerEvents: "none" }}
			>
				<span className="entrance-line" />
				<span className="marker-label">{shape.props.label}</span>
			</HTMLContainer>
		);
	}
}

export class DiningLandmarkShapeUtil extends DiningBoxShapeUtil<DiningLandmarkShape> {
	static override type = "dining-landmark" as const;
	static override props: RecordProps<DiningLandmarkShape> = {
		...boxProps,
		landmarkKind: T.literalEnum("seating", "stairs"),
	};

	override getDefaultProps(): DiningLandmarkShape["props"] {
		return { entityId: "", h: 72, label: "楼梯", landmarkKind: "stairs", w: 96 };
	}

	override component(shape: DiningLandmarkShape) {
		return this.renderMarker(shape, "landmark");
	}
}

export const DINING_EDITOR_SHAPE_UTILS = [
	DiningPathShapeUtil,
	DiningWindowShapeUtil,
	DiningRegionShapeUtil,
	DiningEntranceShapeUtil,
	DiningLandmarkShapeUtil,
];

export function isDiningEditorShape(shape: TLShape): shape is DiningEditorShape {
	return (
		shape.type === "dining-entrance" ||
		shape.type === "dining-landmark" ||
		shape.type === "dining-path" ||
		shape.type === "dining-region" ||
		shape.type === "dining-window"
	);
}

export function diningShapeEntityId(shape: TLShape): string | null {
	if (
		shape.type === "dining-entrance" ||
		shape.type === "dining-landmark" ||
		shape.type === "dining-path" ||
		shape.type === "dining-region" ||
		shape.type === "dining-window"
	) {
		return shape.props.entityId;
	}
	return null;
}

function pointsToPath(points: Array<{ x: number; y: number }>, closed: boolean): string {
	const [first, ...rest] = points;
	if (!first) {
		return "";
	}
	return `M${first.x} ${first.y}${rest.map((point) => `L${point.x} ${point.y}`).join("")}${closed ? "Z" : ""}`;
}

function pathLayerStyle(layer: DiningEditorPathLayer): {
	fill: string;
	stroke: string;
	strokeWidth: number;
} {
	if (layer === "outline") {
		return {
			fill: "var(--dining-editor-outline-fill)",
			stroke: "var(--dining-editor-path-stroke)",
			strokeWidth: 4,
		};
	}
	if (layer === "partition") {
		return { fill: "none", stroke: "var(--dining-editor-border)", strokeWidth: 2 };
	}
	return {
		fill: "var(--dining-editor-path-fill)",
		stroke: "var(--dining-editor-path-stroke)",
		strokeWidth: 2.5,
	};
}

function pathLayerLabel(layer: DiningEditorPathLayer): string {
	return { outline: "外轮廓", partition: "分隔线", structure: "结构" }[layer];
}
