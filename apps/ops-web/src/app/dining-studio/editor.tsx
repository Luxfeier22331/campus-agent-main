import type { DiningMapDraft } from "@campus-agent/dining/domain";
import {
	canonicalizeDiningFloorplanBundle,
	type DiningFloorplanBundleV1,
	type DiningWayfindingDiagnostic,
	type DiningWayfindingLayout,
	diagnoseDiningWayfindingLayout,
	isDiningWayfindingPlaceholderWindowLabel,
	serializeDiningWayfindingLayout,
} from "@campus-agent/dining/floorplans";
import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Input,
	NativeSelect,
	useTheme,
} from "@campus-agent/ui";
import { getAssetUrlsByImport } from "@tldraw/assets/imports.vite";
import zhCnTldrawMessages from "@tldraw/assets/translations/zh-cn.json?raw";
import {
	defaultUserPreferences,
	type TLUserPreferences,
	TldrawEditor,
	useTldrawCurrentUser,
} from "@tldraw/editor";
import { PageRecordType } from "@tldraw/tlschema";
import { Save } from "lucide-react";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	type MouseEvent as ReactMouseEvent,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Box, type Editor, type TLShape, type TLShapeId, TldrawUi } from "tldraw";
import "tldraw/tldraw.css";
import "./editor.css";

import {
	layoutToTldrawRecords,
	tldrawRecordsToDraft,
	tldrawRecordsToLayout,
} from "./tldraw-adapter";
import {
	createDiningTldrawOptions,
	DINING_TLDRAW_ASSET_UTILS,
	DINING_TLDRAW_SHAPE_UTILS,
	DINING_TLDRAW_TOOLS,
	installDiningExternalContentHandlers,
} from "./tldraw-policy";
import { type DiningEditorShape, diningShapeEntityId, isDiningEditorShape } from "./tldraw-shapes";
import { nextEntityId } from "./tldraw-tools";
import {
	createDiningTldrawUiComponents,
	DINING_TLDRAW_UI_OVERRIDES,
	DINING_ZH_CN_TLDRAW_MESSAGES,
	DiningContextMenu,
	DiningEditorErrorFallback,
	type DiningEditorFeedback,
	DiningEditorFeedbackToast,
	DiningElementList,
} from "./tldraw-ui";

interface EditorStatus {
	kind: "error" | "idle" | "saved" | "saving";
	message: string;
}

const DINING_TLDRAW_EDITOR_COMPONENTS = { ErrorFallback: DiningEditorErrorFallback } as const;
// tldraw validates this public client key; replace it when the trial expires or a hobby key is issued.
const TLDRAW_LICENSE_KEY =
	"tldraw-2026-08-24/WyJRWklfLVFXdyIsWyIqIl0sMTYsIjIwMjYtMDgtMjQiXQ.oo8JPqluVXSWKx9zHIYE+RgBNZuwQN5/E2uv3Lhg0zNloaEacs08XeyRY6ToucR6LaT6R3PVAtnwA8hh1SjWoQ";
const importedTldrawAssetUrls = getAssetUrlsByImport();
const zhCnTranslationUrl = URL.createObjectURL(
	new Blob(
		[
			JSON.stringify({
				...(JSON.parse(zhCnTldrawMessages) as Record<string, string>),
				...DINING_ZH_CN_TLDRAW_MESSAGES,
			}),
		],
		{ type: "application/json" },
	),
);
const DINING_TLDRAW_ASSET_URLS = {
	...importedTldrawAssetUrls,
	translations: {
		...importedTldrawAssetUrls.translations,
		en: importedTldrawAssetUrls.translations.main,
		"zh-cn": zhCnTranslationUrl,
	},
};
const TLDRAW_CANVAS_SELECTOR = ".tl-canvas";
const TLDRAW_APPLICATION_SELECTOR = '.tl-container[role="application"]';
const TLDRAW_INTERACTIVE_SELECTOR =
	'input, textarea, select, button, a, [contenteditable], [role="button"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="combobox"], [role="slider"]';

function eventTargetElement(target: EventTarget | null): Element | null {
	return target instanceof Element ? target : null;
}

function isTldrawCanvasTarget(target: EventTarget | null): boolean {
	return Boolean(eventTargetElement(target)?.closest(TLDRAW_CANVAS_SELECTOR));
}

function isTldrawKeyboardSurface(target: EventTarget | null): boolean {
	const element = eventTargetElement(target);
	return Boolean(
		element &&
			(element.closest(TLDRAW_CANVAS_SELECTOR) || element.closest(TLDRAW_APPLICATION_SELECTOR)) &&
			!element.closest(TLDRAW_INTERACTIVE_SELECTOR),
	);
}

export function DiningFloorplanEditor(props: {
	draft: DiningMapDraft;
	onSave: (bundle: DiningFloorplanBundleV1, expectedRevision: number) => Promise<DiningMapDraft>;
	onUnsavedChange?: (count: number) => void;
	saving?: boolean;
}) {
	const [activeFloorId, setActiveFloorId] = useState(props.draft.bundle.layouts[0]?.floorId ?? "");
	const [diagnosticsByFloor, setDiagnosticsByFloor] = useState<
		Map<string, DiningWayfindingDiagnostic[]>
	>(() => new Map());
	const [dirtyFloorIds, setDirtyFloorIds] = useState<Set<string>>(() => new Set());
	const [editor, setEditor] = useState<Editor | null>(null);
	const [editorFeedback, setEditorFeedback] = useState<DiningEditorFeedback | null>(null);
	const [pendingWindowName, setPendingWindowName] = useState<{
		shapeId: TLShapeId;
		value: string;
	} | null>(null);
	const [status, setStatus] = useState<EditorStatus>({ kind: "idle", message: "草稿已保存" });
	const [userPreferences, setUserPreferences] = useState<TLUserPreferences>({
		...defaultUserPreferences,
		id: "dining-operator",
		isSnapMode: true,
		locale: "zh-cn",
	});
	const { resolvedTheme } = useTheme();
	const tldrawUser = useTldrawCurrentUser({ setUserPreferences, userPreferences });
	const activeFloorIdRef = useRef(activeFloorId);
	const baselineRef = useRef(
		new Map(
			props.draft.bundle.layouts.map((layout) => [
				layout.floorId,
				serializeDiningWayfindingLayout(layout),
			]),
		),
	);
	const dirtyFloorIdsRef = useRef(new Set<string>());
	const feedbackIdRef = useRef(0);
	const initializedRef = useRef(false);
	const pendingWindowNameInputRef = useRef<HTMLInputElement>(null);
	const reconcileFrameRef = useRef<number | null>(null);
	const suppressStoreEventsRef = useRef(false);

	const reportRejectedContent = useCallback((message: string) => {
		setStatus({ kind: "error", message });
		feedbackIdRef.current += 1;
		setEditorFeedback({ id: feedbackIdRef.current, message });
	}, []);
	const requestWindowName = useCallback((shapeId: string) => {
		setPendingWindowName({ shapeId: shapeId as TLShapeId, value: "" });
	}, []);
	const tldrawOptions = useMemo(
		() => createDiningTldrawOptions(reportRejectedContent),
		[reportRejectedContent],
	);
	const tldrawUiComponents = useMemo(() => createDiningTldrawUiComponents({ canEdit: true }), []);
	const handleStagePointerDownCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
		// tldraw owns middle-button panning; cancel only the browser autoscroll default.
		if (event.pointerType === "mouse" && event.button === 1 && isTldrawCanvasTarget(event.target)) {
			event.preventDefault();
		}
	}, []);
	const handleStageMouseDownCapture = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
		// Chromium exposes middle-button autoscroll through the compatibility mousedown event.
		// Keep this narrow so tldraw still receives the event and owns the pan state.
		if (event.button === 1 && isTldrawCanvasTarget(event.target)) {
			event.preventDefault();
		}
	}, []);
	const handleStageKeyDownCapture = useCallback(
		(event: ReactKeyboardEvent<HTMLDivElement>) => {
			if (!isTldrawKeyboardSurface(event.target) || event.defaultPrevented) {
				return;
			}
			if (editor?.menus.hasOpenMenus()) {
				return;
			}

			if (event.code === "Space" && !event.ctrlKey && !event.metaKey) {
				event.preventDefault();
				return;
			}

			if (
				["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"].includes(event.code) &&
				editor &&
				(editor.getSelectedShapeIds().length > 0 || editor.inputs.getIsSpacebarPanning())
			) {
				event.preventDefault();
			}
		},
		[editor],
	);
	const reconcileFloor = useCallback(
		(currentEditor: Editor, floorId: string): void => {
			const base = props.draft.bundle.layouts.find((layout) => layout.floorId === floorId);
			if (!base || hasDiningWindowAwaitingName(currentEditor, floorId)) {
				return;
			}
			let layout: DiningWayfindingLayout | null = null;
			let diagnostics: DiningWayfindingDiagnostic[];
			try {
				layout = tldrawRecordsToDraft(shapesForPage(currentEditor, floorId), base);
				diagnostics = diagnoseDiningWayfindingLayout(layout);
			} catch (error) {
				diagnostics = [
					{
						code: "invalid_layout",
						entities: [],
						message: error instanceof Error ? error.message : "地图格式无效",
					},
				];
			}
			markInvalidShapes(currentEditor, floorId, diagnostics, suppressStoreEventsRef);
			const dirty = layout
				? serializeDiningWayfindingLayout(layout) !== baselineRef.current.get(floorId)
				: true;
			dirtyFloorIdsRef.current = setMembership(dirtyFloorIdsRef.current, floorId, dirty);
			setDirtyFloorIds(new Set(dirtyFloorIdsRef.current));
			setDiagnosticsByFloor((current) => new Map(current).set(floorId, diagnostics));
			setStatus(
				diagnostics.length > 0
					? { kind: "error", message: `${diagnostics.length} 个问题待处理` }
					: { kind: "idle", message: dirty ? "未保存" : "草稿已保存" },
			);
		},
		[props.draft.bundle.layouts],
	);

	useEffect(() => {
		if (!(editor && props.draft.bundle.layouts.length > 0) || initializedRef.current) {
			return;
		}
		initializedRef.current = true;
		editor.updateDocumentSettings({ gridSize: 8 });
		editor.updateInstanceState({ isGridMode: true });
		editor.user.updateUserPreferences({ isSnapMode: true, locale: "zh-cn" });
		installDiningStoreGuards(editor, setStatus, requestWindowName);
		installDiningExternalContentHandlers(editor, reportRejectedContent);
		loadDiningPages(editor, props.draft.bundle.layouts, suppressStoreEventsRef);
		const firstFloorId = props.draft.bundle.layouts[0]?.floorId ?? "";
		activeFloorIdRef.current = firstFloorId;
		setActiveFloorId(firstFloorId);
		editor.updateInstanceState({ isReadonly: false });
		zoomToDiningCanvas(editor);
	}, [editor, props.draft.bundle.layouts, reportRejectedContent, requestWindowName]);

	useEffect(() => {
		if (!editor) {
			return;
		}
		const scheduleRefresh = () => {
			if (reconcileFrameRef.current !== null) {
				return;
			}
			reconcileFrameRef.current = window.requestAnimationFrame(() => {
				reconcileFrameRef.current = null;
				if (!suppressStoreEventsRef.current) {
					reconcileFloor(editor, activeFloorIdRef.current);
				}
			});
		};
		const dispose = editor.store.listen(scheduleRefresh, {
			scope: "document",
			source: "all",
		});
		return () => {
			dispose();
			if (reconcileFrameRef.current !== null) {
				window.cancelAnimationFrame(reconcileFrameRef.current);
			}
		};
	}, [editor, reconcileFloor]);

	useEffect(() => {
		props.onUnsavedChange?.(dirtyFloorIds.size);
	}, [dirtyFloorIds, props.onUnsavedChange]);

	useEffect(
		() => () => {
			props.onUnsavedChange?.(0);
		},
		[props.onUnsavedChange],
	);

	useEffect(() => {
		if (pendingWindowName) {
			window.requestAnimationFrame(() => pendingWindowNameInputRef.current?.focus());
		}
	}, [pendingWindowName]);

	function switchFloor(floorId: string): void {
		if (!(editor && props.draft.bundle.layouts.some((layout) => layout.floorId === floorId))) {
			return;
		}
		reconcileFloor(editor, activeFloorIdRef.current);
		activeFloorIdRef.current = floorId;
		setActiveFloorId(floorId);
		editor.run(
			() => {
				editor.setCurrentPage(pageIdForFloor(floorId));
				editor.selectNone();
			},
			{ history: "ignore" },
		);
		const floorDiagnostics = diagnosticsByFloor.get(floorId) ?? [];
		setStatus(
			floorDiagnostics.length > 0
				? { kind: "error", message: `${floorDiagnostics.length} 个问题待处理` }
				: {
						kind: "idle",
						message: dirtyFloorIdsRef.current.has(floorId) ? "未保存" : "草稿已保存",
					},
		);
		zoomToDiningCanvas(editor);
	}

	async function saveBundle(): Promise<void> {
		if (!editor) {
			return;
		}
		reconcileFloor(editor, activeFloorIdRef.current);
		try {
			setStatus({ kind: "saving", message: "保存中" });
			const bundle = collectBundle(editor, props.draft.bundle);
			for (const layout of bundle.layouts) {
				const diagnostics = diagnoseDiningWayfindingLayout(layout);
				if (diagnostics.length > 0) {
					throw new Error(`${layout.label} 还有 ${diagnostics.length} 个问题待处理。`);
				}
			}
			const saved = await props.onSave(bundle, props.draft.revision);
			baselineRef.current = new Map(
				saved.bundle.layouts.map((layout) => [
					layout.floorId,
					serializeDiningWayfindingLayout(layout),
				]),
			);
			dirtyFloorIdsRef.current = new Set();
			setDirtyFloorIds(new Set());
			setStatus({ kind: "saved", message: "草稿已保存" });
		} catch (error) {
			setStatus({
				kind: "error",
				message: error instanceof Error ? error.message : "地图草稿保存失败",
			});
		}
	}

	function confirmWindowName(): void {
		if (!(editor && pendingWindowName)) {
			return;
		}
		const value = pendingWindowName.value.trim();
		if (!value || isDiningWayfindingPlaceholderWindowLabel(value)) {
			return;
		}
		const shape = editor.getShape(pendingWindowName.shapeId);
		if (!(shape && shape.type === "dining-window")) {
			setPendingWindowName(null);
			return;
		}
		editor.run(
			() =>
				editor.updateShape({
					id: shape.id,
					meta: { ...shape.meta, diningNeedsName: false },
					props: { label: value },
					type: shape.type,
				} as never),
			{ history: "record" },
		);
		setPendingWindowName(null);
	}

	function cancelWindowName(): void {
		if (editor && pendingWindowName && editor.getShape(pendingWindowName.shapeId)) {
			editor.deleteShape(pendingWindowName.shapeId);
		}
		setPendingWindowName(null);
	}

	const activeDiagnostics = diagnosticsByFloor.get(activeFloorId) ?? [];
	return (
		<>
			<section aria-labelledby="dining-editor-title" className="dining-map-editor editor-shell">
				<header className="editor-toolbar app-toolbar">
					<h2 id="dining-editor-title">地图草稿</h2>
					<NativeSelect
						aria-label="选择楼层"
						className="min-h-11"
						onChange={(event) => switchFloor(event.target.value)}
						value={activeFloorId}
					>
						{props.draft.bundle.layouts.map((layout) => (
							<option key={layout.floorId} value={layout.floorId}>
								{layout.label}
							</option>
						))}
					</NativeSelect>
					<span className={`editor-status ${status.kind === "error" ? "error" : ""}`} role="status">
						{status.message}
					</span>
					<button
						className="save"
						disabled={
							props.saving ||
							dirtyFloorIds.size === 0 ||
							activeDiagnostics.length > 0 ||
							pendingWindowName !== null
						}
						onClick={() => void saveBundle()}
						type="button"
					>
						<Save aria-hidden="true" size={16} />
						保存草稿
					</button>
				</header>
				<div className="editor-body">
					<aside aria-label="地图元素" className="editor-sidebar">
						<h2 className="panel-heading">图层与元素</h2>
						{editor ? <DiningElementList editor={editor} /> : null}
					</aside>
					<section aria-label="平面图画布" className="editor-stage-wrap">
						<div
							className={`editor-stage tl-theme__${resolvedTheme}`}
							onKeyDownCapture={handleStageKeyDownCapture}
							onMouseDownCapture={handleStageMouseDownCapture}
							onPointerDownCapture={handleStagePointerDownCapture}
						>
							<TldrawEditor
								assetUrls={DINING_TLDRAW_ASSET_URLS}
								assetUtils={DINING_TLDRAW_ASSET_UTILS}
								components={DINING_TLDRAW_EDITOR_COMPONENTS}
								colorScheme={resolvedTheme}
								initialState="select"
								licenseKey={TLDRAW_LICENSE_KEY}
								onMount={setEditor}
								options={tldrawOptions}
								shapeUtils={DINING_TLDRAW_SHAPE_UTILS}
								tools={DINING_TLDRAW_TOOLS}
								user={tldrawUser}
							>
								<TldrawUi
									assetUrls={DINING_TLDRAW_ASSET_URLS}
									components={tldrawUiComponents}
									overrides={DINING_TLDRAW_UI_OVERRIDES}
								>
									<DiningEditorFeedbackToast feedback={editorFeedback} />
									<DiningContextMenu />
								</TldrawUi>
							</TldrawEditor>
							{activeDiagnostics.length > 0 && editor ? (
								<DiagnosticPanel diagnostics={activeDiagnostics} editor={editor} />
							) : null}
						</div>
					</section>
				</div>
			</section>

			<Dialog
				open={pendingWindowName !== null}
				onOpenChange={(open) => !open && cancelWindowName()}
			>
				<DialogContent className="w-[min(28rem,calc(100vw-2rem))]">
					<DialogHeader>
						<DialogTitle>给窗口命名</DialogTitle>
						<DialogDescription>窗口必须有学生能够辨认的名称。</DialogDescription>
					</DialogHeader>
					<label className="grid gap-2 text-sm" htmlFor="dining-window-name">
						<span className="font-medium">窗口名称</span>
						<Input
							aria-label="窗口名称"
							className="min-h-11"
							id="dining-window-name"
							maxLength={80}
							onChange={(event) =>
								setPendingWindowName((current) =>
									current ? { ...current, value: event.target.value } : current,
								)
							}
							ref={pendingWindowNameInputRef}
							value={pendingWindowName?.value ?? ""}
						/>
					</label>
					<DialogFooter>
						<Button onClick={cancelWindowName} variant="outline">
							取消创建
						</Button>
						<Button
							disabled={
								!pendingWindowName?.value.trim() ||
								isDiningWayfindingPlaceholderWindowLabel(pendingWindowName.value)
							}
							onClick={confirmWindowName}
						>
							确认
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

function collectBundle(editor: Editor, base: DiningFloorplanBundleV1): DiningFloorplanBundleV1 {
	return canonicalizeDiningFloorplanBundle({
		...base,
		layouts: base.layouts.map((layout) =>
			tldrawRecordsToLayout(shapesForPage(editor, layout.floorId), layout),
		),
	});
}

function shapesForPage(editor: Editor, floorId: string): TLShape[] {
	return [...editor.getPageShapeIds(pageIdForFloor(floorId))].flatMap((id) => {
		const shape = editor.getShape(id);
		return shape ? [shape] : [];
	});
}

function hasDiningWindowAwaitingName(editor: Editor, floorId: string): boolean {
	return shapesForPage(editor, floorId).some(
		(shape) => shape.type === "dining-window" && shape.meta.diningNeedsName === true,
	);
}

function installDiningStoreGuards(
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

function loadDiningPages(
	editor: Editor,
	layouts: DiningWayfindingLayout[],
	suppressRef: { current: boolean },
): void {
	const originalPages = editor.getPages();
	suppressRef.current = true;
	try {
		for (const layout of layouts) {
			const pageId = pageIdForFloor(layout.floorId);
			if (!editor.getPage(pageId)) {
				editor.run(() => editor.createPage({ id: pageId, name: layout.label }), {
					history: "ignore",
				});
				editor.setCurrentPage(pageId);
				editor.run(() => editor.createShapes(layoutToTldrawRecords(layout)), { history: "ignore" });
			}
		}
		const first = layouts[0];
		if (first) {
			editor.setCurrentPage(pageIdForFloor(first.floorId));
		}
		for (const page of originalPages) {
			if (!layouts.some((layout) => page.id === pageIdForFloor(layout.floorId))) {
				editor.run(() => editor.deletePage(page.id), { history: "ignore" });
			}
		}
		editor.clearHistory();
	} finally {
		suppressRef.current = false;
	}
}

function markInvalidShapes(
	editor: Editor,
	floorId: string,
	diagnostics: DiningWayfindingDiagnostic[],
	suppressRef: { current: boolean },
): void {
	const invalidIds = new Set(
		diagnostics.flatMap((diagnostic) => diagnostic.entities.map((entity) => entity.id)),
	);
	const updates = shapesForPage(editor, floorId)
		.filter(isDiningEditorShape)
		.flatMap((shape) => {
			const invalid = invalidIds.has(shape.props.entityId);
			return shape.meta.diningInvalid === invalid
				? []
				: [{ id: shape.id, meta: { ...shape.meta, diningInvalid: invalid }, type: shape.type }];
		});
	if (updates.length === 0) {
		return;
	}
	suppressRef.current = true;
	try {
		editor.run(() => editor.updateShapes(updates as never), { history: "ignore" });
	} finally {
		suppressRef.current = false;
	}
}

function DiagnosticPanel(props: { diagnostics: DiningWayfindingDiagnostic[]; editor: Editor }) {
	return (
		<div className="editor-feedback-panels">
			<div className="diagnostic-panel" role="alert">
				<strong>当前地图需要修正</strong>
				{props.diagnostics.map((diagnostic) => (
					<button
						key={`${diagnostic.code}:${diagnostic.message}`}
						onClick={() => {
							const ids = diagnostic.entities.flatMap((entity) => {
								const shape = props.editor
									.getCurrentPageShapes()
									.find((candidate) => diningShapeEntityId(candidate) === entity.id);
								return shape ? [shape.id] : [];
							});
							if (ids.length > 0) {
								props.editor.select(...ids);
								props.editor.zoomToSelection({ animation: { duration: 180 } });
							}
						}}
						type="button"
					>
						{diagnostic.message}
					</button>
				))}
			</div>
		</div>
	);
}

function pageIdForFloor(floorId: string) {
	return PageRecordType.createId(`dining-${floorId}`);
}

function zoomToDiningCanvas(editor: Editor): void {
	let attemptsRemaining = 12;
	const fitWhenReady = () => {
		const viewport = editor.getViewportScreenBounds();
		if ((viewport.width < 160 || viewport.height < 160) && attemptsRemaining > 0) {
			attemptsRemaining -= 1;
			requestAnimationFrame(fitWhenReady);
			return;
		}
		editor.zoomToBounds(new Box(0, 0, 1280, 760), {
			animation: { duration: 180 },
			inset: 40,
		});
	};
	requestAnimationFrame(fitWhenReady);
}

function setMembership(current: Set<string>, value: string, included: boolean): Set<string> {
	const next = new Set(current);
	if (included) {
		next.add(value);
	} else {
		next.delete(value);
	}
	return next;
}
