import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
	AssetRecordType,
	Box,
	createShapeId,
	type Editor,
	type TLAssetId,
	type TLCreateShapePartial,
	type TLImageShape,
	type TLShape,
	Tldraw,
} from "tldraw";
import "tldraw/tldraw.css";
import "./styles.css";

import {
	type DiningWayfindingLayout,
	serializeDiningWayfindingLayout,
} from "../src/floorplans/wayfinding-layout";
import {
	applyDiningFloorplanEditorCommands,
	type DiningFloorplanEditorBridge,
	type DiningFloorplanEditorCommand,
} from "./editor-commands";
import {
	type DiningReferenceCalibration,
	getDiningReferenceCalibration,
} from "./reference-calibrations";
import {
	DINING_REFERENCE_SHAPE_META_KEY,
	isReferenceShape,
	layoutToTldrawRecords,
	tldrawRecordsToLayout,
} from "./tldraw-adapter";
import {
	DINING_EDITOR_SHAPE_UTILS,
	type DiningEditorMarkerKind,
	type DiningMarkerShape,
	type DiningPathShape,
} from "./tldraw-shapes";
import {
	cancelDiningCreateTool,
	configureDiningCreateTool,
	DINING_EDITOR_TOOLS,
	type DiningCreationKind,
	getDiningCreationKind,
} from "./tldraw-tools";

declare global {
	var __DINING_FLOORPLAN_EDITOR__: DiningFloorplanEditorBridge | undefined;
}

interface EditorStatus {
	kind: "error" | "generating" | "idle" | "saved" | "saving";
	message: string;
}

interface LayoutDocument {
	assetStatus: "current" | "stale";
	layout: DiningWayfindingLayout;
	revision: string;
}

const BLOCKED_TLDRAW_SHORTCUTS = new Set([
	"a",
	"b",
	"d",
	"e",
	"f",
	"h",
	"k",
	"l",
	"n",
	"o",
	"r",
	"t",
	"x",
]);

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) {
	throw new Error("Dining floorplan editor root is missing.");
}

createRoot(root).render(
	<StrictMode>
		<DiningFloorplanEditor />
	</StrictMode>,
);

function DiningFloorplanEditor() {
	const [layouts, setLayouts] = useState<DiningWayfindingLayout[]>([]);
	const [activeFloorId, setActiveFloorId] = useState("");
	const [editor, setEditor] = useState<Editor | null>(null);
	const [dirtyFloorIds, setDirtyFloorIds] = useState<Set<string>>(() => new Set());
	const [assetStatuses, setAssetStatuses] = useState<Map<string, "current" | "stale">>(
		() => new Map(),
	);
	const [status, setStatus] = useState<EditorStatus>({ kind: "idle", message: "读取中" });
	const activeFloorIdRef = useRef("");
	const floorShapesRef = useRef(new Map<string, TLShape[]>());
	const initializedRef = useRef(false);
	const layoutsRef = useRef<DiningWayfindingLayout[]>([]);
	const layoutRevisionsRef = useRef(new Map<string, string>());
	const savedLayoutsRef = useRef(new Map<string, string>());
	const suppressStoreEventsRef = useRef(false);

	useEffect(() => {
		layoutsRef.current = layouts;
	}, [layouts]);

	useEffect(() => {
		const controller = new AbortController();
		void loadLayouts(controller.signal)
			.then((documents) => {
				const loaded = documents.map((document) => document.layout);
				setLayouts(loaded);
				layoutsRef.current = loaded;
				layoutRevisionsRef.current = new Map(
					documents.map((document) => [document.layout.floorId, document.revision]),
				);
				setAssetStatuses(
					new Map(documents.map((document) => [document.layout.floorId, document.assetStatus])),
				);
				savedLayoutsRef.current = new Map(
					loaded.map((layout) => [layout.floorId, serializeDiningWayfindingLayout(layout)]),
				);
				const firstFloorId = loaded[0]?.floorId ?? "";
				activeFloorIdRef.current = firstFloorId;
				setActiveFloorId(firstFloorId);
				setStatus({
					kind: "idle",
					message: documents[0]?.assetStatus === "stale" ? "静态地图待生成" : "",
				});
			})
			.catch((error: unknown) => {
				if (!controller.signal.aborted) {
					setEditorError(error, setStatus);
				}
			});
		return () => controller.abort();
	}, []);

	useEffect(() => {
		const preventDefaultShapeShortcuts = (event: KeyboardEvent) => {
			const target = event.target;
			if (
				(target instanceof HTMLElement &&
					(target.matches("input, textarea, select") || target.isContentEditable)) ||
				event.metaKey ||
				event.ctrlKey ||
				event.altKey
			) {
				return;
			}
			if (BLOCKED_TLDRAW_SHORTCUTS.has(event.key.toLowerCase())) {
				event.preventDefault();
				event.stopImmediatePropagation();
			}
		};
		window.addEventListener("keydown", preventDefaultShapeShortcuts, true);
		return () => window.removeEventListener("keydown", preventDefaultShapeShortcuts, true);
	}, []);

	useEffect(() => {
		if (!(editor && layouts.length > 0) || initializedRef.current) {
			return;
		}
		initializedRef.current = true;
		editor.updateDocumentSettings({ gridSize: 8 });
		editor.updateInstanceState({ isGridMode: true });
		loadFloorIntoEditor(editor, layouts[0], undefined, suppressStoreEventsRef);
		zoomToDiningCanvas(editor);
	}, [editor, layouts]);

	useEffect(() => {
		if (!editor) {
			return;
		}
		return editor.store.listen(
			() => {
				if (suppressStoreEventsRef.current || !initializedRef.current) {
					return;
				}
				const floorId = activeFloorIdRef.current;
				const baseLayout = layoutsRef.current.find((layout) => layout.floorId === floorId);
				if (!baseLayout) {
					return;
				}
				const unsupportedShapes = editor
					.getCurrentPageShapes()
					.filter((shape) => !(isReferenceShape(shape) || isDiningEditorShape(shape)));
				if (unsupportedShapes.length > 0) {
					suppressStoreEventsRef.current = true;
					try {
						editor.run(() => editor.deleteShapes(unsupportedShapes.map((shape) => shape.id)), {
							history: "ignore",
						});
						editor.setCurrentTool("select");
					} finally {
						suppressStoreEventsRef.current = false;
					}
					let dirty = false;
					try {
						const current = tldrawRecordsToLayout(editor.getCurrentPageShapes(), baseLayout);
						dirty =
							serializeDiningWayfindingLayout(current) !== savedLayoutsRef.current.get(floorId);
					} catch {
						dirty = true;
					}
					setDirtyFloorIds((current) => setMembership(current, floorId, dirty));
					setStatus({
						kind: "idle",
						message: dirty ? "未保存" : "已移除不支持的元素",
					});
					return;
				}
				let dirty = true;
				let validationError: string | null = null;
				try {
					const current = tldrawRecordsToLayout(editor.getCurrentPageShapes(), baseLayout);
					dirty = serializeDiningWayfindingLayout(current) !== savedLayoutsRef.current.get(floorId);
				} catch (error) {
					dirty = true;
					validationError = error instanceof Error ? error.message : "平面图校验失败";
				}
				setDirtyFloorIds((current) => setMembership(current, floorId, dirty));
				setStatus((current) =>
					current.kind === "saving" || current.kind === "generating"
						? current
						: validationError
							? { kind: "error", message: validationError }
							: { kind: "idle", message: dirty ? "未保存" : "" },
				);
			},
			{ scope: "document", source: "user" },
		);
	}, [editor]);

	useEffect(() => {
		const beforeUnload = (event: BeforeUnloadEvent) => {
			if (dirtyFloorIds.size > 0) {
				event.preventDefault();
			}
		};
		window.addEventListener("beforeunload", beforeUnload);
		return () => window.removeEventListener("beforeunload", beforeUnload);
	}, [dirtyFloorIds]);

	const activeLayout = layouts.find((layout) => layout.floorId === activeFloorId) ?? null;

	const readCurrentLayout = useCallback((): DiningWayfindingLayout => {
		if (!(editor && activeLayout)) {
			throw new Error("没有可编辑的食堂平面图");
		}
		return tldrawRecordsToLayout(editor.getCurrentPageShapes(), activeLayout);
	}, [activeLayout, editor]);

	const applyCommands = useCallback(
		(commands: DiningFloorplanEditorCommand[]): DiningWayfindingLayout => {
			if (!(editor && activeLayout)) {
				throw new Error("没有可编辑的食堂平面图");
			}
			try {
				const layout = applyDiningFloorplanEditorCommands({
					baseLayout: activeLayout,
					commands,
					editor,
				});
				setStatus({ kind: "idle", message: "未保存" });
				return layout;
			} catch (error) {
				setEditorError(error, setStatus);
				throw error;
			}
		},
		[activeLayout, editor],
	);

	const saveActiveLayout = useCallback(async (): Promise<DiningWayfindingLayout> => {
		if (!(editor && activeLayout)) {
			throw new Error("没有可编辑的食堂平面图");
		}
		setStatus({ kind: "saving", message: "保存中" });
		try {
			const layout = readCurrentLayout();
			const response = await fetch(
				`/__dining-floorplan-editor/layouts/${encodeURIComponent(layout.floorId)}`,
				{
					body: JSON.stringify({
						baseRevision: layoutRevisionsRef.current.get(layout.floorId),
						layout,
					}),
					headers: {
						"content-type": "application/json",
						"x-dining-floorplan-editor": "1",
					},
					method: "PUT",
				},
			);
			const payload = (await response.json()) as {
				assetStatus?: "current" | "stale";
				code?: string;
				error?: string;
				layout?: DiningWayfindingLayout;
				revision?: string;
			};
			if (!(response.ok && payload.layout && payload.revision && payload.assetStatus)) {
				throw new Error(
					payload.code === "layout_conflict"
						? "地图已在其他窗口修改，请刷新后重试"
						: (payload.error ?? "平面图保存失败"),
				);
			}
			const savedLayout = payload.layout;
			layoutRevisionsRef.current.set(savedLayout.floorId, payload.revision);
			setAssetStatuses((current) =>
				new Map(current).set(savedLayout.floorId, payload.assetStatus ?? "stale"),
			);
			setLayouts((current) =>
				current.map((item) => (item.floorId === savedLayout.floorId ? savedLayout : item)),
			);
			savedLayoutsRef.current.set(
				savedLayout.floorId,
				serializeDiningWayfindingLayout(savedLayout),
			);
			let changedDuringSave = true;
			try {
				const current = tldrawRecordsToLayout(editor.getCurrentPageShapes(), savedLayout);
				changedDuringSave =
					serializeDiningWayfindingLayout(current) !== serializeDiningWayfindingLayout(savedLayout);
			} catch {
				changedDuringSave = true;
			}
			setDirtyFloorIds((current) => setMembership(current, savedLayout.floorId, changedDuringSave));
			setStatus({
				kind: changedDuringSave ? "idle" : "saved",
				message: changedDuringSave
					? "未保存"
					: payload.assetStatus === "stale"
						? "已保存，静态地图待生成"
						: "已保存",
			});
			return savedLayout;
		} catch (error) {
			setEditorError(error, setStatus);
			throw error;
		}
	}, [activeLayout, editor, readCurrentLayout]);

	const generateStaticAssets = useCallback(async (): Promise<void> => {
		setStatus({ kind: "generating", message: "生成中" });
		try {
			const response = await fetch("/__dining-floorplan-editor/assets/generate", {
				headers: { "x-dining-floorplan-editor": "1" },
				method: "POST",
			});
			const payload = (await response.json()) as {
				assets?: Array<{ floorId: string }>;
				error?: string;
				removedUntrackedAssets?: string[];
			};
			if (!(response.ok && payload.assets)) {
				throw new Error(payload.error ?? "静态地图生成失败");
			}
			setAssetStatuses(new Map(payload.assets.map((asset) => [asset.floorId, "current"] as const)));
			setStatus({
				kind: "saved",
				message:
					payload.removedUntrackedAssets && payload.removedUntrackedAssets.length > 0
						? `已生成，并清理 ${payload.removedUntrackedAssets.length} 个中间文件`
						: "静态地图已生成",
			});
		} catch (error) {
			setEditorError(error, setStatus);
			throw error;
		}
	}, []);

	useEffect(() => {
		if (!(editor && activeLayout)) {
			return;
		}
		const bridge: DiningFloorplanEditorBridge = {
			applyCommands,
			readLayout: readCurrentLayout,
			save: saveActiveLayout,
			validate: readCurrentLayout,
		};
		globalThis.__DINING_FLOORPLAN_EDITOR__ = bridge;
		return () => {
			if (globalThis.__DINING_FLOORPLAN_EDITOR__ === bridge) {
				globalThis.__DINING_FLOORPLAN_EDITOR__ = undefined;
			}
		};
	}, [activeLayout, applyCommands, editor, readCurrentLayout, saveActiveLayout]);

	function switchFloor(nextFloorId: string): void {
		const nextLayout = layoutsRef.current.find((layout) => layout.floorId === nextFloorId);
		if (!nextLayout) {
			return;
		}
		if (!editor) {
			activeFloorIdRef.current = nextFloorId;
			setActiveFloorId(nextFloorId);
			return;
		}
		const currentFloorId = activeFloorIdRef.current;
		if (currentFloorId) {
			floorShapesRef.current.set(currentFloorId, structuredClone(editor.getCurrentPageShapes()));
		}
		activeFloorIdRef.current = nextFloorId;
		loadFloorIntoEditor(
			editor,
			nextLayout,
			floorShapesRef.current.get(nextFloorId),
			suppressStoreEventsRef,
		);
		setActiveFloorId(nextFloorId);
		setStatus({
			kind: "idle",
			message: dirtyFloorIds.has(nextFloorId)
				? "未保存"
				: assetStatuses.get(nextFloorId) === "stale"
					? "静态地图待生成"
					: "",
		});
		zoomToDiningCanvas(editor);
	}

	function runUiCommand(commands: DiningFloorplanEditorCommand[], selectedId?: string): void {
		try {
			applyCommands(commands);
			if (editor && selectedId) {
				selectEntity(editor, selectedId);
			}
		} catch {
			// The nearby status surface owns the error message.
		}
	}

	return (
		<main className="editor-shell">
			<header className="editor-toolbar">
				<h1>食堂平面图</h1>
				<select
					aria-label="选择地图"
					disabled={
						layouts.length === 0 || status.kind === "saving" || status.kind === "generating"
					}
					onChange={(event) => switchFloor(event.target.value)}
					value={activeFloorId}
				>
					{layouts.map((layout) => (
						<option key={layout.floorId} value={layout.floorId}>
							{layout.label}
						</option>
					))}
				</select>
				{editor && activeLayout ? (
					<EditorToolbar
						activeLayout={activeLayout}
						editor={editor}
						onCommand={runUiCommand}
						onError={(error) => setEditorError(error, setStatus)}
						onReferenceImported={() => setStatus({ kind: "idle", message: "" })}
					/>
				) : null}
				<span className={`editor-status ${status.kind === "error" ? "error" : ""}`} role="status">
					{status.message}
				</span>
				<button
					className="generate"
					disabled={
						status.kind === "error" ||
						status.kind === "saving" ||
						status.kind === "generating" ||
						dirtyFloorIds.size > 0 ||
						![...assetStatuses.values()].some((value) => value === "stale")
					}
					onClick={() => void generateStaticAssets().catch(() => undefined)}
					type="button"
				>
					生成静态地图
				</button>
				<button
					className="save"
					disabled={
						!activeFloorId ||
						status.kind === "error" ||
						status.kind === "saving" ||
						status.kind === "generating" ||
						!dirtyFloorIds.has(activeFloorId)
					}
					onClick={() => void saveActiveLayout().catch(() => undefined)}
					type="button"
				>
					保存
				</button>
			</header>
			<div className="editor-body">
				<aside className="editor-sidebar" aria-label="地图元素">
					<h2 className="panel-heading">图层与元素</h2>
					{editor ? <ElementSidebar editor={editor} /> : null}
				</aside>
				<section
					className="editor-stage-wrap"
					aria-label="平面图画布"
					onKeyDownCapture={(event) => {
						if (
							!(event.metaKey || event.ctrlKey || event.altKey) &&
							BLOCKED_TLDRAW_SHORTCUTS.has(event.key.toLowerCase())
						) {
							event.preventDefault();
							event.stopPropagation();
						}
					}}
				>
					<div className="editor-stage">
						<Tldraw
							hideUi
							onMount={setEditor}
							shapeUtils={DINING_EDITOR_SHAPE_UTILS}
							tools={DINING_EDITOR_TOOLS}
						/>
					</div>
				</section>
				<aside className="editor-properties" aria-label="元素属性">
					<h2 className="panel-heading">元素属性</h2>
					{editor ? (
						<PropertiesPanel editor={editor} onCommand={runUiCommand} />
					) : (
						<p className="empty-properties">未选择元素</p>
					)}
				</aside>
			</div>
		</main>
	);
}

function EditorToolbar(props: {
	activeLayout: DiningWayfindingLayout;
	editor: Editor;
	onCommand: (commands: DiningFloorplanEditorCommand[], selectedId?: string) => void;
	onError: (error: unknown) => void;
	onReferenceImported: () => void;
}) {
	const revision = useEditorRevision(props.editor);
	void revision;
	const selectedIds = props.editor.getSelectedShapeIds();
	const selectedShapes = selectedIds
		.map((id) => props.editor.getShape(id))
		.filter((shape): shape is TLShape => Boolean(shape && !isReferenceShape(shape)));

	function create(kind: DiningCreationKind) {
		configureDiningCreateTool(kind, (point) => {
			const command = createDefaultCommand(props.editor, props.activeLayout, kind, point);
			props.onCommand([command], command.entity.id);
		});
		props.editor.setCurrentTool("dining-create");
	}

	async function importReference(file: File | undefined) {
		if (!file) {
			return;
		}
		try {
			await addReferenceImage(props.editor, props.activeLayout.floorId, file);
			props.onReferenceImported();
		} catch (error) {
			props.onError(error);
		}
	}

	return (
		<>
			<fieldset className="toolbar-group">
				<legend className="visually-hidden">历史操作</legend>
				<button
					aria-label="撤销"
					disabled={!props.editor.getCanUndo()}
					onClick={() => props.editor.undo()}
					title="撤销"
					type="button"
				>
					&#8630;
				</button>
				<button
					aria-label="重做"
					disabled={!props.editor.getCanRedo()}
					onClick={() => props.editor.redo()}
					title="重做"
					type="button"
				>
					&#8631;
				</button>
			</fieldset>
			<fieldset className="toolbar-group create-tools">
				<legend className="visually-hidden">新增元素</legend>
				{(
					[
						["window", "档口"],
						["region", "区域"],
						["entrance", "入口"],
						["landmark", "楼梯"],
						["structure", "结构"],
						["partition", "分隔线"],
					] as const
				).map(([kind, label]) => (
					<button
						aria-pressed={
							props.editor.getCurrentToolId() === "dining-create" &&
							getDiningCreationKind() === kind
						}
						key={kind}
						onClick={() => create(kind)}
						type="button"
					>
						{label}
					</button>
				))}
			</fieldset>
			<fieldset className="toolbar-group">
				<legend className="visually-hidden">排列元素</legend>
				<select
					aria-label="对齐"
					disabled={selectedShapes.length < 2}
					onChange={(event) => {
						const value = event.target.value as Parameters<Editor["alignShapes"]>[1];
						if (value) {
							props.editor.alignShapes(selectedShapes, value);
						}
						event.target.value = "";
					}}
					value=""
				>
					<option value="">对齐</option>
					<option value="left">左对齐</option>
					<option value="center-horizontal">水平居中</option>
					<option value="right">右对齐</option>
					<option value="top">顶部对齐</option>
					<option value="center-vertical">垂直居中</option>
					<option value="bottom">底部对齐</option>
				</select>
				<select
					aria-label="均匀分布"
					disabled={selectedShapes.length < 3}
					onChange={(event) => {
						const value = event.target.value as "horizontal" | "vertical";
						if (value) {
							props.editor.distributeShapes(selectedShapes, value);
						}
						event.target.value = "";
					}}
					value=""
				>
					<option value="">分布</option>
					<option value="horizontal">水平分布</option>
					<option value="vertical">垂直分布</option>
				</select>
			</fieldset>
			<button
				disabled={selectedShapes.length === 0}
				onClick={() => {
					const unknownIds = selectedShapes
						.filter((shape) => shape.type !== "dining-marker" && shape.type !== "dining-path")
						.map((shape) => shape.id);
					if (unknownIds.length > 0) {
						props.editor.deleteShapes(unknownIds);
					}
					const ids = selectedShapes
						.map(shapeEntityId)
						.filter((id): id is string => Boolean(id && id !== "outline"));
					if (ids.length > 0) {
						props.onCommand([{ ids, op: "delete" }]);
					}
				}}
				type="button"
			>
				删除
			</button>
			<button onClick={() => props.onCommand([{ op: "renumber" }])} type="button">
				档口编号
			</button>
			<label className="file-button">
				参考图
				<input
					accept="image/jpeg,image/png,image/webp"
					onChange={(event) => void importReference(event.target.files?.[0])}
					type="file"
				/>
			</label>
			<label className="snap-toggle">
				<input
					checked={props.editor.getInstanceState().isGridMode}
					onChange={(event) =>
						props.editor.updateInstanceState({ isGridMode: event.target.checked })
					}
					type="checkbox"
				/>
				网格
			</label>
		</>
	);
}

function ElementSidebar({ editor }: { editor: Editor }) {
	const revision = useEditorRevision(editor);
	void revision;
	const selected = new Set(editor.getSelectedShapeIds());
	const shapes = editor.getCurrentPageShapes().filter((shape) => !isReferenceShape(shape));
	const groups = [
		{ key: "window", label: "档口", shapes: markerShapes(shapes, "window") },
		{ key: "region", label: "区域", shapes: markerShapes(shapes, "region") },
		{ key: "entrance", label: "入口", shapes: markerShapes(shapes, "entrance") },
		{ key: "landmark", label: "地标", shapes: markerShapes(shapes, "landmark") },
		{ key: "structure", label: "结构", shapes: pathShapes(shapes, "structure") },
		{ key: "partition", label: "分隔线", shapes: pathShapes(shapes, "partition") },
		{ key: "outline", label: "外轮廓", shapes: pathShapes(shapes, "outline") },
	];
	return (
		<div className="element-sections">
			{groups.map((group) => {
				if (group.shapes.length === 0) {
					return null;
				}
				const allLocked = group.shapes.every((shape) => shape.isLocked);
				return (
					<section className="element-section" key={group.key}>
						<div className="element-section-heading">
							<h3>{group.label}</h3>
							<button
								aria-label={`${allLocked ? "解锁" : "锁定"}${group.label}`}
								onClick={() => toggleShapeLocks(editor, group.shapes, !allLocked)}
								title={allLocked ? "解锁图层" : "锁定图层"}
								type="button"
							>
								{allLocked ? "开" : "锁"}
							</button>
						</div>
						<div className="element-list">
							{group.shapes.map((shape) => (
								<button
									aria-pressed={selected.has(shape.id)}
									key={shape.id}
									onClick={() => editor.select(shape.id)}
									type="button"
								>
									{shapeLabel(shape)}
								</button>
							))}
						</div>
					</section>
				);
			})}
		</div>
	);
}

function PropertiesPanel(props: {
	editor: Editor;
	onCommand: (commands: DiningFloorplanEditorCommand[], selectedId?: string) => void;
}) {
	const revision = useEditorRevision(props.editor);
	void revision;
	const shape = props.editor.getOnlySelectedShape();
	if (!shape || isReferenceShape(shape)) {
		return <p className="empty-properties">未选择元素</p>;
	}
	if (shape.type === "dining-marker") {
		return <MarkerProperties key={shape.id} shape={shape} onCommand={props.onCommand} />;
	}
	if (shape.type === "dining-path") {
		return <PathProperties key={shape.id} shape={shape} onCommand={props.onCommand} />;
	}
	return <p className="empty-properties">不支持的元素</p>;
}

function MarkerProperties(props: {
	shape: DiningMarkerShape;
	onCommand: (commands: DiningFloorplanEditorCommand[], selectedId?: string) => void;
}) {
	const { entityId, markerKind } = props.shape.props;
	const update = (patch: Extract<DiningFloorplanEditorCommand, { op: "update" }>["patch"]) => {
		props.onCommand([{ id: entityId, op: "update", patch }], patch.id ?? entityId);
	};
	return (
		<form className="property-form" onSubmit={(event) => event.preventDefault()}>
			<PropertyInput
				label="标识"
				value={entityId}
				onCommit={(value) => update({ id: value })}
				wide
			/>
			<PropertyInput
				label="名称"
				value={props.shape.props.label}
				onCommit={(value) =>
					props.onCommand([{ id: entityId, label: value, op: "setLabel" }], entityId)
				}
				wide
			/>
			<NumberProperty label="X" value={props.shape.x} onCommit={(value) => update({ x: value })} />
			<NumberProperty label="Y" value={props.shape.y} onCommit={(value) => update({ y: value })} />
			<NumberProperty
				label="宽"
				value={props.shape.props.w}
				onCommit={(value) => update({ width: value })}
			/>
			<NumberProperty
				label="高"
				value={props.shape.props.h}
				onCommit={(value) => update({ height: value })}
			/>
			{markerKind === "region" ? (
				<label className="wide">
					图标
					<select
						onChange={(event) =>
							props.onCommand(
								[
									{
										iconKey: (event.target.value || null) as DiningMarkerShape["props"]["iconKey"],
										id: entityId,
										op: "setIcon",
									},
								],
								entityId,
							)
						}
						value={props.shape.props.iconKey ?? ""}
					>
						<option value="">无</option>
						<option value="utensils">餐饮</option>
						<option value="coffee">咖啡</option>
						<option value="armchair">座位</option>
						<option value="stairs">楼梯</option>
						<option value="door-open">入口</option>
					</select>
				</label>
			) : null}
			{markerKind === "entrance" ? (
				<label className="wide">
					朝向
					<select
						onChange={(event) =>
							update({ side: event.target.value as "bottom" | "left" | "right" | "top" })
						}
						value={props.shape.props.side ?? "bottom"}
					>
						<option value="top">上</option>
						<option value="right">右</option>
						<option value="bottom">下</option>
						<option value="left">左</option>
					</select>
				</label>
			) : null}
		</form>
	);
}

function PathProperties(props: {
	shape: DiningPathShape;
	onCommand: (commands: DiningFloorplanEditorCommand[], selectedId?: string) => void;
}) {
	const { entityId, layer, points } = props.shape.props;
	const absolutePoints = points.map((point) => ({
		x: props.shape.x + point.x,
		y: props.shape.y + point.y,
	}));
	function updatePoints(nextPoints: Array<{ x: number; y: number }>) {
		props.onCommand(
			[
				{
					id: layer === "outline" ? "outline" : entityId,
					op: "update",
					patch: { points: nextPoints },
				},
			],
			entityId,
		);
	}
	return (
		<form className="property-form" onSubmit={(event) => event.preventDefault()}>
			<PropertyInput
				disabled={layer === "outline"}
				label="标识"
				onCommit={(value) =>
					props.onCommand([{ id: entityId, op: "update", patch: { id: value } }], value)
				}
				value={entityId}
				wide
			/>
			<label className="wide">
				图层
				<input disabled value={pathLayerLabel(layer)} />
			</label>
			<div className="path-node-summary wide">{points.length} 个节点</div>
			<button
				className="wide"
				onClick={() => {
					const last = absolutePoints.at(-1);
					const first = absolutePoints[0];
					const previous = absolutePoints.at(-2);
					if (!(last && first && previous)) {
						return;
					}
					const next = props.shape.props.closed
						? { x: Math.round((last.x + first.x) / 2), y: Math.round((last.y + first.y) / 2) }
						: { x: last.x + (last.x - previous.x), y: last.y + (last.y - previous.y) };
					updatePoints([...absolutePoints, next]);
				}}
				type="button"
			>
				添加节点
			</button>
			<button
				className="wide"
				disabled={points.length <= (props.shape.props.closed ? 3 : 2)}
				onClick={() => updatePoints(absolutePoints.slice(0, -1))}
				type="button"
			>
				移除末端节点
			</button>
		</form>
	);
}

function PropertyInput(props: {
	disabled?: boolean;
	label: string;
	onCommit: (value: string) => void;
	value: string;
	wide?: boolean;
}) {
	return (
		<label className={props.wide ? "wide" : undefined}>
			{props.label}
			<input
				defaultValue={props.value}
				disabled={props.disabled}
				onBlur={(event) => {
					const value = event.target.value.trim();
					if (value && value !== props.value) {
						props.onCommit(value);
					}
				}}
			/>
		</label>
	);
}

function NumberProperty(props: {
	label: string;
	onCommit: (value: number) => void;
	value: number;
}) {
	return (
		<label>
			{props.label}
			<input
				defaultValue={props.value}
				onBlur={(event) => {
					const value = Number(event.target.value);
					if (Number.isFinite(value) && value !== props.value) {
						props.onCommit(value);
					}
				}}
				step="1"
				type="number"
			/>
		</label>
	);
}

function useEditorRevision(editor: Editor): number {
	const [revision, setRevision] = useState(0);
	useEffect(() => {
		let sessionSignature = editorSessionSignature(editor);
		const removeDocumentListener = editor.store.listen(
			() => setRevision((current) => current + 1),
			{ scope: "document" },
		);
		const removeSessionListener = editor.store.listen(
			() => {
				const nextSignature = editorSessionSignature(editor);
				if (sessionSignature !== nextSignature) {
					sessionSignature = nextSignature;
					setRevision((current) => current + 1);
				}
			},
			{ scope: "session" },
		);
		return () => {
			removeDocumentListener();
			removeSessionListener();
		};
	}, [editor]);
	return revision;
}

function editorSessionSignature(editor: Editor): string {
	return `${editor.getCurrentToolId()}|${editor.getSelectedShapeIds().join("|")}`;
}

async function loadLayouts(signal: AbortSignal): Promise<LayoutDocument[]> {
	const response = await fetch("/__dining-floorplan-editor/layouts", {
		headers: { accept: "application/json" },
		signal,
	});
	if (!response.ok) {
		throw new Error("平面图读取失败");
	}
	const payload = (await response.json()) as { documents: LayoutDocument[] };
	if (!Array.isArray(payload.documents) || payload.documents.length === 0) {
		throw new Error("没有可编辑的食堂平面图");
	}
	return payload.documents;
}

function loadFloorIntoEditor(
	editor: Editor,
	layout: DiningWayfindingLayout,
	snapshot: TLShape[] | undefined,
	suppressRef: { current: boolean },
): void {
	cancelDiningCreateTool();
	editor.setCurrentTool("select");
	suppressRef.current = true;
	try {
		editor.run(
			() => {
				const currentIds = editor.getCurrentPageShapeIds();
				if (currentIds.size > 0) {
					editor.deleteShapes([...currentIds]);
				}
				editor.createShapes((snapshot ?? layoutToTldrawRecords(layout)) as TLCreateShapePartial[]);
				editor.selectNone();
			},
			{ history: "ignore", ignoreShapeLock: true },
		);
		editor.clearHistory();
	} finally {
		suppressRef.current = false;
	}
}

function zoomToDiningCanvas(editor: Editor): void {
	requestAnimationFrame(() => {
		editor.zoomToBounds(new Box(0, 0, 1280, 760), { immediate: true, inset: 40 });
	});
}

function createDefaultCommand(
	editor: Editor,
	layout: DiningWayfindingLayout,
	kind: DiningCreationKind,
	point: { x: number; y: number },
): Extract<DiningFloorplanEditorCommand, { op: "create" }> {
	const current = tldrawRecordsToLayout(editor.getCurrentPageShapes(), layout);
	if (kind === "structure" || kind === "partition") {
		const id = nextEntityId(kind, entityIds(current));
		const x = clamp(point.x, 0, 1120);
		const y = clamp(point.y, 0, 664);
		return {
			entity: {
				id,
				kind,
				points:
					kind === "structure"
						? [
								{ x, y },
								{ x: x + 160, y },
								{ x: x + 160, y: y + 96 },
								{ x, y: y + 96 },
							]
						: [
								{ x, y },
								{ x: x + 160, y },
							],
			},
			op: "create",
		};
	}
	if (kind === "window") {
		const id = nextWindowId(current.windows.map((window) => window.anchorId));
		const number = Number(id.slice("window-".length));
		return {
			entity: {
				height: 72,
				id,
				kind,
				label: `${toChineseNumber(number)}号窗口`,
				width: 104,
				x: clamp(point.x - 52, 0, 1176),
				y: clamp(point.y - 36, 0, 688),
			},
			op: "create",
		};
	}
	const id = nextEntityId(kind, entityIds(current));
	if (kind === "region") {
		return {
			entity: {
				height: 144,
				iconKey: "utensils",
				id,
				kind,
				label: "就餐区",
				width: 240,
				x: clamp(point.x - 120, 0, 1040),
				y: clamp(point.y - 72, 0, 616),
			},
			op: "create",
		};
	}
	if (kind === "landmark") {
		return {
			entity: {
				height: 72,
				id,
				kind,
				label: "楼梯",
				landmarkKind: "stairs",
				width: 96,
				x: clamp(point.x - 48, 0, 1184),
				y: clamp(point.y - 36, 0, 688),
			},
			op: "create",
		};
	}
	return {
		entity: {
			height: 32,
			id,
			kind: "entrance",
			label: "入口",
			side: "bottom",
			width: 88,
			x: clamp(point.x - 44, 0, 1192),
			y: clamp(point.y - 16, 0, 728),
		},
		op: "create",
	};
}

async function addReferenceImage(editor: Editor, floorId: string, file: File): Promise<void> {
	const uploadedSource = await fileToDataUrl(file);
	const image = await readImage(uploadedSource);
	const calibration = getDiningReferenceCalibration(floorId);
	if (calibration) {
		await assertReferenceFile(file, calibration);
	}
	const normalized = calibration
		? calibrateReferenceImage(image, calibration)
		: fitReferenceImage(uploadedSource, image, file.type);
	const assetId = AssetRecordType.createId(`dining-reference-${floorId}`);
	const shapeId = createShapeId(`reference-${floorId}`);
	const existing = editor.getShape(shapeId);
	editor.run(
		() => {
			if (existing) {
				editor.deleteShape(existing.id);
			}
			if (editor.getAsset(assetId)) {
				editor.deleteAssets([assetId]);
			}
			editor.createAssets([
				AssetRecordType.create({
					id: assetId,
					props: {
						h: normalized.height,
						isAnimated: false,
						mimeType: normalized.mimeType,
						name: calibration ? `${calibration.referenceId}.png` : file.name,
						src: normalized.source,
						w: normalized.width,
					},
					type: "image",
				}),
			]);
			editor.createShape<TLImageShape>({
				id: shapeId,
				isLocked: true,
				meta: { [DINING_REFERENCE_SHAPE_META_KEY]: true },
				opacity: 0.32,
				props: {
					altText: "本地参考图",
					assetId: assetId as TLAssetId,
					h: normalized.height,
					w: normalized.width,
				},
				type: "image",
				x: normalized.x,
				y: normalized.y,
			});
			editor.sendToBack([shapeId]);
		},
		{ ignoreShapeLock: true },
	);
}

async function assertReferenceFile(
	file: File,
	calibration: DiningReferenceCalibration,
): Promise<void> {
	const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
	const sha256 = `sha256:${Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("")}`;
	if (sha256 !== calibration.sourceSha256) {
		throw new Error(`参考图与 ${calibration.referenceId} 不一致`);
	}
}

function fileToDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () => reject(new Error("参考图读取失败"));
		reader.onload = () => resolve(String(reader.result));
		reader.readAsDataURL(file);
	});
}

function readImage(source: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onerror = () => reject(new Error("参考图格式无法读取"));
		image.onload = () => resolve(image);
		image.src = source;
	});
}

function calibrateReferenceImage(
	image: HTMLImageElement,
	calibration: DiningReferenceCalibration,
): { height: number; mimeType: "image/png"; source: string; width: number; x: number; y: number } {
	if (
		image.naturalWidth !== calibration.sourceSize.width ||
		image.naturalHeight !== calibration.sourceSize.height
	) {
		throw new Error(
			`参考图尺寸与 ${calibration.referenceId} 不一致，应为 ${calibration.sourceSize.width}x${calibration.sourceSize.height}`,
		);
	}
	const canvas = document.createElement("canvas");
	canvas.width = 1280;
	canvas.height = 760;
	const context = canvas.getContext("2d");
	if (!context) {
		throw new Error("浏览器无法校准参考图");
	}
	const source = calibration.sourceCrop;
	const target = calibration.layoutBounds;
	context.drawImage(
		image,
		source.x,
		source.y,
		source.width,
		source.height,
		target.x,
		target.y,
		target.width,
		target.height,
	);
	return {
		height: canvas.height,
		mimeType: "image/png",
		source: canvas.toDataURL("image/png"),
		width: canvas.width,
		x: 0,
		y: 0,
	};
}

function fitReferenceImage(
	source: string,
	image: HTMLImageElement,
	mimeType: string,
): { height: number; mimeType: string; source: string; width: number; x: number; y: number } {
	const scale = Math.min(1280 / image.naturalWidth, 760 / image.naturalHeight);
	const width = image.naturalWidth * scale;
	const height = image.naturalHeight * scale;
	return {
		height,
		mimeType: mimeType || "image/jpeg",
		source,
		width,
		x: (1280 - width) / 2,
		y: (760 - height) / 2,
	};
}

function toggleShapeLocks(editor: Editor, shapes: TLShape[], locked: boolean): void {
	editor.run(
		() =>
			editor.updateShapes(
				shapes.map((shape) => ({ id: shape.id, isLocked: locked, type: shape.type })),
			),
		{ ignoreShapeLock: true },
	);
}

function selectEntity(editor: Editor, entityId: string): void {
	const shape = editor
		.getCurrentPageShapes()
		.find((candidate) => shapeEntityId(candidate) === entityId);
	if (shape) {
		editor.select(shape.id);
	}
}

function markerShapes(shapes: TLShape[], kind: DiningEditorMarkerKind): DiningMarkerShape[] {
	return shapes
		.filter(
			(shape): shape is DiningMarkerShape =>
				shape.type === "dining-marker" && shape.props.markerKind === kind,
		)
		.sort((left, right) => left.props.entityId.localeCompare(right.props.entityId));
}

function pathShapes(
	shapes: TLShape[],
	layer: DiningPathShape["props"]["layer"],
): DiningPathShape[] {
	return shapes
		.filter(
			(shape): shape is DiningPathShape =>
				shape.type === "dining-path" && shape.props.layer === layer,
		)
		.sort((left, right) => left.props.entityId.localeCompare(right.props.entityId));
}

function shapeEntityId(shape: TLShape): string | null {
	return shape.type === "dining-marker" || shape.type === "dining-path"
		? shape.props.entityId
		: null;
}

function shapeLabel(shape: DiningMarkerShape | DiningPathShape): string {
	return shape.type === "dining-marker" ? shape.props.label : shape.props.entityId;
}

function pathLayerLabel(layer: DiningPathShape["props"]["layer"]): string {
	return { outline: "外轮廓", partition: "分隔线", structure: "结构" }[layer];
}

function entityIds(layout: DiningWayfindingLayout): string[] {
	return [
		...layout.entrances.map((item) => item.id),
		...layout.landmarks.map((item) => item.id),
		...layout.partitions.map((item) => item.id),
		...layout.regions.map((item) => item.id),
		...layout.structures.map((item) => item.id),
		...layout.windows.map((item) => item.anchorId),
	];
}

function nextEntityId(prefix: string, existing: string[]): string {
	const used = new Set(existing);
	for (let number = 1; number < 10_000; number += 1) {
		const candidate = `${prefix}-${String(number).padStart(2, "0")}`;
		if (!used.has(candidate)) {
			return candidate;
		}
	}
	throw new Error(`无法为 ${prefix} 分配新标识`);
}

function nextWindowId(existing: string[]): string {
	return nextEntityId("window", existing);
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, value));
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

function setMembership(current: Set<string>, value: string, included: boolean): Set<string> {
	if (current.has(value) === included) {
		return current;
	}
	const next = new Set(current);
	if (included) {
		next.add(value);
	} else {
		next.delete(value);
	}
	return next;
}

function setEditorError(error: unknown, setStatus: (status: EditorStatus) => void): void {
	setStatus({
		kind: "error",
		message: error instanceof Error ? error.message : "操作失败",
	});
}

function isDiningEditorShape(shape: TLShape): boolean {
	return shape.type === "dining-marker" || shape.type === "dining-path";
}
