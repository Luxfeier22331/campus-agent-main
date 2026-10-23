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

import { diningCanvasForShape } from "./tldraw-canvas";
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
	const restriction = shape.isLocked ? "元素已锁定，解锁后可编辑" : null;
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
	const canvas = diningCanvasForShape(editor, shape);
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
				onValue={(x) => update({ x: clamp(x, 0, canvas.width - shape.props.w) })}
				shapeId={shape.id}
				value={shape.x}
			/>
			<TransactionalNumber
				editor={editor}
				label="Y"
				onValue={(y) => update({ y: clamp(y, 0, canvas.height - shape.props.h) })}
				shapeId={shape.id}
				value={shape.y}
			/>
			<TransactionalNumber
				editor={editor}
				label="宽"
				onValue={(w) => update({ props: { w: markerDimension(canvas.width - shape.x, w) } })}
				shapeId={shape.id}
				value={shape.props.w}
			/>
			<TransactionalNumber
				editor={editor}
				label="高"
				onValue={(h) => update({ props: { h: markerDimension(canvas.height - shape.y, h) } })}
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
	const canvas = diningCanvasForShape(editor, shape);
	const absolutePoints = shape.props.points.map((point) => ({
		x: shape.x + point.x,
		y: shape.y + point.y,
	}));
	const minimum = shape.props.closed ? 3 : 2;
	const updatePoints = (points: Array<{ x: number; y: number }>) => {
		editor.updateShape({
			id: shape.id,
			props: {
				points: points.map((point) => ({
					x: clamp(point.x, 0, canvas.width),
					y: clamp(point.y, 0, canvas.height),
				})),
			},
			type: shape.type,
			x: 0,
			y: 0,
		});
	};
	const insertPointAfter = (index: number) => {
		const point = absolutePoints[index];
		const next = absolutePoints[index + 1] ?? (shape.props.closed ? absolutePoints[0] : null);
		if (!(point && next)) {
			return;
		}
		editor.markHistoryStoppingPoint(`insert-point:${shape.props.entityId}`);
		updatePoints([
			...absolutePoints.slice(0, index + 1),
			{ x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 },
			...absolutePoints.slice(index + 1),
		]);
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
					onClick={() => insertPointAfter(absolutePoints.length - (shape.props.closed ? 1 : 2))}
					title="添加节点"
					type="icon"
				>
					<TldrawUiButtonIcon icon={<Plus aria-hidden="true" size={16} />} />
				</TldrawUiButton>
			</div>
			<div className="dining-path-node-list">
				{absolutePoints.map((point, index) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: Path nodes are addressed by position; coordinate edits must preserve the focused input.
					<div className="dining-path-node" key={index}>
						<div className="dining-path-node-heading">
							<span>节点 {index + 1}</span>
							<div className="dining-path-node-actions">
								<TldrawUiButton
									disabled={!shape.props.closed && index === absolutePoints.length - 1}
									onClick={() => insertPointAfter(index)}
									title={`在节点 ${index + 1} 后插入节点`}
									type="icon"
								>
									<TldrawUiButtonIcon icon={<Plus aria-hidden="true" size={14} />} />
								</TldrawUiButton>
								<TldrawUiButton
									disabled={absolutePoints.length <= minimum}
									onClick={() => {
										editor.markHistoryStoppingPoint(`delete-point:${shape.props.entityId}`);
										updatePoints(absolutePoints.filter((_, pointIndex) => pointIndex !== index));
									}}
									title={`删除节点 ${index + 1}`}
									type="icon"
								>
									<TldrawUiButtonIcon icon={<Minus aria-hidden="true" size={14} />} />
								</TldrawUiButton>
							</div>
						</div>
						<div className="dining-property-grid">
							{(["x", "y"] as const).map((axis) => (
								<TransactionalNumber
									ariaLabel={`节点 ${index + 1} ${axis.toUpperCase()}`}
									editor={editor}
									key={axis}
									label={axis.toUpperCase()}
									maximum={canvas[axis === "x" ? "width" : "height"]}
									minimum={0}
									onValue={(value) =>
										updatePoints(
											absolutePoints.map((current, pointIndex) =>
												pointIndex === index ? { ...current, [axis]: value } : current,
											),
										)
									}
									shapeId={shape.id}
									value={point[axis]}
								/>
							))}
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

function TransactionalInput(props: {
	ariaLabel?: string;
	editor: Editor;
	label: string;
	onValue: (value: string) => boolean | string;
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
		const result = onValueRef.current(value);
		if (result === false) {
			props.editor.bailToMark(mark);
			setError(props.label === "名称" ? "请输入名称" : "请输入有效数字");
			window.setTimeout(() => inputRef.current?.focus(), 0);
			return;
		}
		const committedValue = typeof result === "string" ? result : value;
		initialValueRef.current = committedValue;
		draftRef.current = committedValue;
		setDraft(committedValue);
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
				aria-label={props.ariaLabel ?? props.label}
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
	ariaLabel?: string;
	editor: Editor;
	label: string;
	maximum?: number;
	minimum?: number;
	onValue: (value: number) => void;
	shapeId: string;
	value: number;
}) {
	return (
		<TransactionalInput
			ariaLabel={props.ariaLabel ?? props.label}
			editor={props.editor}
			label={props.label}
			onValue={(raw) => {
				const value = Number(raw);
				if (raw.trim() && Number.isFinite(value)) {
					const bounded = clamp(
						value,
						props.minimum ?? Number.NEGATIVE_INFINITY,
						props.maximum ?? Number.POSITIVE_INFINITY,
					);
					props.onValue(bounded);
					return String(Math.round(bounded * 100) / 100);
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

function markerDimension(maximum: number, value: number): number {
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
