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
	Vec,
} from "tldraw";

import { DINING_WAYFINDING_MIN_WINDOW } from "../src/floorplans/wayfinding-layout";

export const DINING_EDITOR_PATH_LAYERS = ["outline", "partition", "structure"] as const;
export const DINING_EDITOR_MARKER_KINDS = ["entrance", "landmark", "region", "window"] as const;

export type DiningEditorPathLayer = (typeof DINING_EDITOR_PATH_LAYERS)[number];
export type DiningEditorMarkerKind = (typeof DINING_EDITOR_MARKER_KINDS)[number];

export interface DiningPathShapeProps {
	closed: boolean;
	entityId: string;
	layer: DiningEditorPathLayer;
	points: Array<{ x: number; y: number }>;
}

export interface DiningMarkerShapeProps {
	entityId: string;
	h: number;
	iconKey: "armchair" | "coffee" | "door-open" | "stairs" | "utensils" | null;
	label: string;
	landmarkKind: "seating" | "stairs" | null;
	markerKind: DiningEditorMarkerKind;
	side: "bottom" | "left" | "right" | "top" | null;
	w: number;
}

declare module "@tldraw/tlschema" {
	interface TLGlobalShapePropsMap {
		"dining-marker": DiningMarkerShapeProps;
		"dining-path": DiningPathShapeProps;
	}
}

export type DiningPathShape = TLShape<"dining-path">;
export type DiningMarkerShape = TLShape<"dining-marker">;
export type DiningEditorShape = DiningMarkerShape | DiningPathShape;

const pointValidator = T.object({ x: T.number, y: T.number });

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

	override getGeometry(shape: DiningPathShape): Polygon2d | Polyline2d {
		const points = shape.props.points.map(Vec.From);
		return shape.props.closed
			? new Polygon2d({ isFilled: shape.props.layer !== "partition", points })
			: new Polyline2d({ points });
	}

	override getHandles(shape: DiningPathShape): TLHandle[] {
		const indices = getIndices(shape.props.points.length);
		return shape.props.points.map((point, index) => ({
			canSnap: true,
			id: String(index),
			index: indices[index],
			type: "vertex",
			x: point.x,
			y: point.y,
		}));
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
		const points = shape.props.points.map((current, index) =>
			index === pointIndex ? { x: point.x, y: point.y } : current,
		);
		return { ...shape, props: { ...shape.props, points } };
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
			<SVGContainer className="dining-editor-path" style={{ overflow: "visible" }}>
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

export class DiningMarkerShapeUtil extends BaseBoxShapeUtil<DiningMarkerShape> {
	static override type = "dining-marker" as const;
	static override props: RecordProps<DiningMarkerShape> = {
		entityId: T.string,
		h: T.number,
		iconKey: T.literalEnum("armchair", "coffee", "door-open", "stairs", "utensils").nullable(),
		label: T.string,
		landmarkKind: T.literalEnum("seating", "stairs").nullable(),
		markerKind: T.literalEnum(...DINING_EDITOR_MARKER_KINDS),
		side: T.literalEnum("bottom", "left", "right", "top").nullable(),
		w: T.number,
	};

	override getDefaultProps(): DiningMarkerShape["props"] {
		return {
			entityId: "window-01",
			h: 72,
			iconKey: null,
			label: "一号窗口",
			landmarkKind: null,
			markerKind: "window",
			side: null,
			w: 104,
		};
	}

	override isAspectRatioLocked(): boolean {
		return false;
	}

	override canResize(): boolean {
		return true;
	}

	override onResize(shape: DiningMarkerShape, info: TLResizeInfo<DiningMarkerShape>) {
		const minimum =
			shape.props.markerKind === "window" ? DINING_WAYFINDING_MIN_WINDOW : { height: 1, width: 1 };
		return resizeBox(shape, info, {
			minHeight: minimum.height,
			minWidth: minimum.width,
		});
	}

	override hideRotateHandle(): boolean {
		return true;
	}

	override component(shape: DiningMarkerShape) {
		const { entityId, label, markerKind } = shape.props;
		return (
			<HTMLContainer
				className={`dining-editor-marker dining-editor-marker-${markerKind}`}
				data-dining-editor-entity-id={entityId}
				data-side={shape.props.side ?? undefined}
				style={{ pointerEvents: "none" }}
			>
				{markerKind === "entrance" ? <span className="entrance-line" /> : null}
				<span className="marker-label">{label}</span>
			</HTMLContainer>
		);
	}

	override getIndicatorPath(shape: DiningMarkerShape): Path2D {
		const path = new Path2D();
		path.rect(0, 0, shape.props.w, shape.props.h);
		return path;
	}

	override getAriaDescriptor(shape: DiningMarkerShape): string {
		return shape.props.label;
	}
}

export const DINING_EDITOR_SHAPE_UTILS = [DiningPathShapeUtil, DiningMarkerShapeUtil];

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
		return { fill: "rgba(255, 255, 255, 0.16)", stroke: "#94a3b8", strokeWidth: 4 };
	}
	if (layer === "partition") {
		return { fill: "none", stroke: "#c3ccd2", strokeWidth: 2 };
	}
	return { fill: "#e8edef", stroke: "#b8c3ca", strokeWidth: 2.5 };
}

function pathLayerLabel(layer: DiningEditorPathLayer): string {
	return { outline: "外轮廓", partition: "分隔线", structure: "结构" }[layer];
}
