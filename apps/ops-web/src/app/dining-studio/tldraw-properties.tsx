import { DINING_WAYFINDING_CANVAS } from "@campus-agent/dining/floorplans";
import { Minus, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	type Editor,
	type TLShapeId,
	TldrawUiButton,
	TldrawUiButtonIcon,
	TldrawUiInput,
	TldrawUiSelect,
	TldrawUiSelectContent,
	TldrawUiSelectItem,
	TldrawUiSelectTrigger,
	TldrawUiSelectValue,
	useEditor,
	useValue,
} from "tldraw";

import {
	DINING_EDITOR_MIN_MARKER_DIMENSION,
	type DiningMarkerShape,
	type DiningPathShape,
	isDiningEditorShape,
} from "./tldraw-shapes";

export function DiningStylePanel() {
	const editor = useEditor();
	const shape = useValue("selected dining properties", () => editor.getOnlySelectedShape(), [
		editor,
	]);
	if (!(shape && isDiningEditorShape(shape))) {
		return null;
	}
	const restriction =
		shape.type === "dining-path" && shape.props.layer === "outline"
			? "外轮廓受保护，不能编辑"
			: shape.isLocked
				? "元素已锁定，解锁后可编辑"
				: null;
	return (
		<section aria-label="元素属性" className="dining-tldraw-properties" key={shape.id}>
			<div className="dining-tldraw-properties-heading">
				<strong>
					{shape.type === "dining-path"
						? pathLayerLabel(shape.props.layer)
						: markerKindLabel(shape)}
				</strong>
				<span>
					{shape.type === "dining-path"
						? `${shape.props.points.length} 个节点`
						: shape.props.label || "未命名窗口"}
				</span>
			</div>
			{restriction ? (
				<div className="dining-property-readonly">
					<strong>{restriction}</strong>
				</div>
			) : shape.type === "dining-path" ? (
				<PathProperties editor={editor} shape={shape} />
			) : (
				<MarkerProperties editor={editor} shape={shape} />
			)}
		</section>
	);
}

function MarkerProperties({ editor, shape }: { editor: Editor; shape: DiningMarkerShape }) {
	const update = (partial: { props?: Record<string, unknown>; x?: number; y?: number }) => {
		if (!editor.getShape(shape.id)) {
			return;
		}
		editor.updateShape({ id: shape.id, type: shape.type, ...partial } as never);
	};
	return (
		<div className="dining-property-grid">
			<TransactionalInput
				editor={editor}
				label="名称"
				onValue={(label) => {
					if (!label.trim()) {
						return false;
					}
					update({ props: { label } });
					return true;
				}}
				shapeId={shape.id}
				value={shape.props.label}
				wide
			/>
			<TransactionalNumber
				editor={editor}
				label="X"
				onValue={(x) => update({ x: clamp(x, 0, DINING_WAYFINDING_CANVAS.width - shape.props.w) })}
				shapeId={shape.id}
				value={shape.x}
			/>
			<TransactionalNumber
				editor={editor}
				label="Y"
				onValue={(y) => update({ y: clamp(y, 0, DINING_WAYFINDING_CANVAS.height - shape.props.h) })}
				shapeId={shape.id}
				value={shape.y}
			/>
			<TransactionalNumber
				editor={editor}
				label="宽"
				onValue={(w) => update({ props: { w: markerDimension(shape, "width", w) } })}
				shapeId={shape.id}
				value={shape.props.w}
			/>
			<TransactionalNumber
				editor={editor}
				label="高"
				onValue={(h) => update({ props: { h: markerDimension(shape, "height", h) } })}
				shapeId={shape.id}
				value={shape.props.h}
			/>
			{shape.type === "dining-region" ? (
				<PropertySelect
					id={`${shape.id}-icon`}
					label="图标"
					onValue={(iconKey) => updateOnce(editor, shape, { iconKey: iconKey || null })}
					options={[
						["", "无"],
						["utensils", "餐饮"],
						["coffee", "咖啡"],
						["armchair", "座位"],
						["stairs", "楼梯"],
						["door-open", "入口"],
					]}
					value={shape.props.iconKey ?? ""}
				/>
			) : null}
			{shape.type === "dining-entrance" ? (
				<PropertySelect
					id={`${shape.id}-side`}
					label="朝向"
					onValue={(side) => updateOnce(editor, shape, { side })}
					options={[
						["top", "上"],
						["right", "右"],
						["bottom", "下"],
						["left", "左"],
					]}
					value={shape.props.side}
				/>
			) : null}
		</div>
	);
}

function PathProperties({ editor, shape }: { editor: Editor; shape: DiningPathShape }) {
	const absolutePoints = shape.props.points.map((point) => ({
		x: shape.x + point.x,
		y: shape.y + point.y,
	}));
	const minimum = shape.props.closed ? 3 : 2;
	const updatePoints = (points: Array<{ x: number; y: number }>) => {
		editor.markHistoryStoppingPoint(`update-points:${shape.props.entityId}`);
		editor.updateShape({
			id: shape.id,
			props: {
				points: points.map((point) => ({
					x: clamp(point.x, 0, DINING_WAYFINDING_CANVAS.width),
					y: clamp(point.y, 0, DINING_WAYFINDING_CANVAS.height),
				})),
			},
			type: shape.type,
			x: 0,
			y: 0,
		});
	};
	return (
		<div className="dining-path-properties">
			<div className="dining-property-readonly">
				<span>图层</span>
				<strong>{pathLayerLabel(shape.props.layer)}</strong>
			</div>
			<div className="dining-path-node-heading">
				<span>{absolutePoints.length} 个节点</span>
				<TldrawUiButton
					disabled={absolutePoints.length < 2}
					onClick={() => {
						const last = absolutePoints.at(-1);
						const previous = absolutePoints.at(-2);
						if (last && previous) {
							updatePoints([
								...absolutePoints,
								{ x: last.x + last.x - previous.x, y: last.y + last.y - previous.y },
							]);
						}
					}}
					title="添加节点"
					type="icon"
				>
					<TldrawUiButtonIcon icon={<Plus aria-hidden="true" size={16} />} />
				</TldrawUiButton>
			</div>
			<div className="dining-path-node-list">
				{absolutePoints.map((point, index) => (
					<div className="dining-path-node" key={`${point.x}:${point.y}`}>
						<span>{index + 1}</span>
						<code>{`${Math.round(point.x)}, ${Math.round(point.y)}`}</code>
						<TldrawUiButton
							disabled={absolutePoints.length <= minimum}
							onClick={() =>
								updatePoints(absolutePoints.filter((_, pointIndex) => pointIndex !== index))
							}
							title={`删除节点 ${index + 1}`}
							type="icon"
						>
							<TldrawUiButtonIcon icon={<Minus aria-hidden="true" size={14} />} />
						</TldrawUiButton>
					</div>
				))}
			</div>
		</div>
	);
}

function TransactionalInput(props: {
	editor: Editor;
	label: string;
	onValue: (value: string) => boolean;
	shapeId: string;
	value: string;
	wide?: boolean;
}) {
	const [draft, setDraft] = useState(props.value);
	const [error, setError] = useState<string | null>(null);
	const canceledRef = useRef(false);
	const editingRef = useRef(false);
	const editingShapeIdRef = useRef(props.shapeId);
	const draftRef = useRef(props.value);
	const initialValueRef = useRef(props.value);
	const inputRef = useRef<HTMLInputElement>(null);
	const onValueRef = useRef(props.onValue);
	onValueRef.current = props.onValue;
	const beginEditing = () => {
		editingRef.current = true;
		editingShapeIdRef.current = props.shapeId;
		initialValueRef.current = props.value;
		draftRef.current = props.value;
		setDraft(props.value);
		canceledRef.current = false;
		setError(null);
	};
	const commitDraft = () => {
		if (canceledRef.current) {
			canceledRef.current = false;
			return;
		}
		const value = draftRef.current;
		if (value === initialValueRef.current) {
			editingRef.current = false;
			return;
		}
		if (!props.editor.getShape(props.shapeId as TLShapeId)) {
			return;
		}
		const mark = props.editor.markHistoryStoppingPoint(`update:${props.shapeId}`);
		if (!onValueRef.current(value)) {
			props.editor.bailToMark(mark);
			setError(props.label === "名称" ? "请输入名称" : "请输入有效数字");
			window.setTimeout(() => inputRef.current?.focus(), 0);
			return;
		}
		initialValueRef.current = value;
		setError(null);
		editingRef.current = false;
	};
	const cancelDraft = () => {
		const initialValue = initialValueRef.current;
		draftRef.current = initialValue;
		setDraft(initialValue);
		setError(null);
		editingRef.current = false;
	};
	const commitDraftRef = useRef(commitDraft);
	commitDraftRef.current = commitDraft;
	useEffect(() => {
		if (editingRef.current && editingShapeIdRef.current !== props.shapeId) {
			const initialValue = initialValueRef.current;
			draftRef.current = initialValue;
			setDraft(initialValue);
			setError(null);
			editingRef.current = false;
		}
		if (editingRef.current) {
			return;
		}
		draftRef.current = props.value;
		setDraft(props.value);
		editingShapeIdRef.current = props.shapeId;
	}, [props.shapeId, props.value]);
	useEffect(() => {
		const document = props.editor.getContainer().ownerDocument;
		const handleEnter = (event: KeyboardEvent) => {
			if (event.key === "Enter" && event.target === inputRef.current) {
				event.preventDefault();
				commitDraftRef.current();
				inputRef.current?.blur();
			}
		};
		const handleEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape" && event.target === inputRef.current) {
				const initialValue = initialValueRef.current;
				draftRef.current = initialValue;
				setDraft(initialValue);
				canceledRef.current = true;
			}
		};
		document.addEventListener("keydown", handleEnter, true);
		document.addEventListener("keydown", handleEscape, true);
		return () => {
			document.removeEventListener("keydown", handleEnter, true);
			document.removeEventListener("keydown", handleEscape, true);
		};
	}, [props.editor]);
	return (
		<div className={props.wide ? "wide" : undefined}>
			<span>{props.label}</span>
			<TldrawUiInput
				aria-label={props.label}
				aria-invalid={error ? true : undefined}
				ref={inputRef}
				onBlur={commitDraft}
				onCancel={() => {
					cancelDraft();
					canceledRef.current = true;
				}}
				onFocus={beginEditing}
				onValueChange={(value) => {
					draftRef.current = value;
					setDraft(value);
					setError(null);
				}}
				value={draft}
			/>
			{error ? <small className="dining-property-error">{error}</small> : null}
		</div>
	);
}

function TransactionalNumber(props: {
	editor: Editor;
	label: string;
	onValue: (value: number) => void;
	shapeId: string;
	value: number;
}) {
	return (
		<TransactionalInput
			editor={props.editor}
			label={props.label}
			onValue={(raw) => {
				const value = Number(raw);
				if (raw.trim() && Number.isFinite(value)) {
					props.onValue(value);
					return true;
				}
				return false;
			}}
			shapeId={props.shapeId}
			value={String(Math.round(props.value * 100) / 100)}
		/>
	);
}

function PropertySelect(props: {
	id: string;
	label: string;
	onValue: (value: string) => void;
	options: ReadonlyArray<readonly [string, string]>;
	value: string;
}) {
	return (
		<div className="wide">
			<span>{props.label}</span>
			<TldrawUiSelect
				aria-label={props.label}
				id={props.id}
				onValueChange={props.onValue}
				value={props.value}
			>
				<TldrawUiSelectTrigger>
					<TldrawUiSelectValue />
				</TldrawUiSelectTrigger>
				<TldrawUiSelectContent>
					{props.options.map(([value, label]) => (
						<TldrawUiSelectItem key={value} label={label} value={value} />
					))}
				</TldrawUiSelectContent>
			</TldrawUiSelect>
		</div>
	);
}

function updateOnce(
	editor: Editor,
	shape: DiningMarkerShape,
	props: Record<string, unknown>,
): void {
	editor.markHistoryStoppingPoint(`update:${shape.id}`);
	editor.updateShape({ id: shape.id, type: shape.type, props } as never);
}

function pathLayerLabel(layer: DiningPathShape["props"]["layer"]): string {
	return { outline: "外轮廓", partition: "分隔线", structure: "结构" }[layer];
}

function markerDimension(
	shape: DiningMarkerShape,
	dimension: "height" | "width",
	value: number,
): number {
	const maximum =
		dimension === "width"
			? DINING_WAYFINDING_CANVAS.width - shape.x
			: DINING_WAYFINDING_CANVAS.height - shape.y;
	return Math.min(Math.max(DINING_EDITOR_MIN_MARKER_DIMENSION, value), maximum);
}

function markerKindLabel(shape: DiningMarkerShape): string {
	return {
		"dining-entrance": "入口",
		"dining-landmark": "地标",
		"dining-region": "区域",
		"dining-window": "窗口",
	}[shape.type];
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}
