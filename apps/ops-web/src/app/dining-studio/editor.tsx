import type { DiningMapDraft } from "@campus-agent/dining/domain";
import {
	type DiningFloorplanBundleV1,
	type DiningWayfindingDiagnostic,
	type DiningWayfindingLayout,
	diagnoseDiningWayfindingLayout,
	isDiningWayfindingPlaceholderWindowLabel,
	serializeDiningWayfindingLayout,
} from "@campus-agent/dining/floorplans";
import {
	Button,
	ConfirmDialog,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Field,
	Input,
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
import { Download, FileUp, Save } from "lucide-react";
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
import { type Editor, type TLShapeId, TldrawUi } from "tldraw";
import { FilterSelect } from "../ui/filter-select";
import "tldraw/tldraw.css";
import "./editor.css";

import {
	type DiningFloorplanBundleSummary,
	downloadDiningFloorplanBundle,
	readDiningFloorplanBundleFile,
	summarizeDiningFloorplanBundle,
} from "./bundle-file";
import { DINING_TLDRAW_LICENSE } from "./dining-editor-license";
import { DiningEditorDiagnosticPanel } from "./editor-diagnostics";
import { installDiningStoreGuards } from "./editor-store-guards";
import {
	collectBundle,
	hasDiningWindowAwaitingName,
	isTldrawCanvasTarget,
	isTldrawKeyboardSurface,
	loadDiningPages,
	markInvalidShapes,
	pageIdForFloor,
	replaceDiningPages,
	setMembership,
	shapesForPage,
	zoomToDiningCanvas,
} from "./editor-support";
import type { EditorStatus, PendingWindowName } from "./editor-types";
import { tldrawRecordsToDraft } from "./tldraw-adapter";
import {
	createDiningTldrawOptions,
	DINING_TLDRAW_ASSET_UTILS,
	DINING_TLDRAW_OVERLAY_UTILS,
	DINING_TLDRAW_SHAPE_UTILS,
	DINING_TLDRAW_TOOLS,
	installDiningExternalContentHandlers,
} from "./tldraw-policy";
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

const DINING_TLDRAW_EDITOR_COMPONENTS = { ErrorFallback: DiningEditorErrorFallback } as const;
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
	const [pendingWindowName, setPendingWindowName] = useState<PendingWindowName | null>(null);
	const [pendingImport, setPendingImport] = useState<{
		bundle: DiningFloorplanBundleV1;
		fileName: string;
		summary: DiningFloorplanBundleSummary;
	} | null>(null);
	const [importError, setImportError] = useState<string | null>(null);
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

	function beginImport(): void {
		if (dirtyFloorIds.size > 0) {
			setStatus({ kind: "error", message: "请先保存当前画布修改，再导入地图 bundle。" });
			return;
		}
		setImportError(null);
		const input = document.createElement("input");
		input.accept = ".json,application/json";
		input.type = "file";
		input.onchange = () => {
			const file = input.files?.[0];
			if (!file) {
				return;
			}
			setImportError(null);
			void readDiningFloorplanBundleFile(file)
				.then((bundle) =>
					setPendingImport({
						bundle,
						fileName: file.name,
						summary: summarizeDiningFloorplanBundle(bundle),
					}),
				)
				.catch((error: unknown) =>
					setImportError(error instanceof Error ? error.message : "导入地图 bundle 失败。"),
				);
		};
		input.click();
	}

	async function confirmImport(): Promise<void> {
		if (!(editor && pendingImport)) {
			return;
		}
		try {
			setStatus({ kind: "saving", message: "保存导入的草稿" });
			const saved = await props.onSave(pendingImport.bundle, props.draft.revision);
			replaceDiningPages(editor, saved.bundle.layouts, suppressStoreEventsRef);
			baselineRef.current = new Map(
				saved.bundle.layouts.map((layout) => [
					layout.floorId,
					serializeDiningWayfindingLayout(layout),
				]),
			);
			dirtyFloorIdsRef.current = new Set();
			setDirtyFloorIds(new Set());
			setDiagnosticsByFloor(new Map());
			const firstFloorId = saved.bundle.layouts[0]?.floorId ?? "";
			activeFloorIdRef.current = firstFloorId;
			setActiveFloorId(firstFloorId);
			setPendingImport(null);
			setImportError(null);
			setStatus({ kind: "saved", message: "导入草稿已保存" });
			zoomToDiningCanvas(editor);
		} catch (error) {
			setImportError(error instanceof Error ? error.message : "导入地图草稿失败。");
			setStatus({ kind: "error", message: "导入地图草稿失败" });
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
				<header className="editor-toolbar">
					<h2 className="editor-toolbar-title ui-section-title" id="dining-editor-title">
						地图草稿
					</h2>
					<div className="editor-floor-control">
						<Field label="选择楼层">
							<FilterSelect
								aria-label="选择楼层"
								className="min-h-11"
								onValueChange={(nextValue) => switchFloor(nextValue)}
								value={activeFloorId}
								options={props.draft.bundle.halls.flatMap((hall) =>
									props.draft.bundle.layouts
										.filter((layout) => layout.hallId === hall.hallId)
										.map((layout) => ({ value: layout.floorId, label: layout.label })),
								)}
							/>
						</Field>
					</div>
					<fieldset aria-label="地图文件" className="editor-file-actions">
						<Button
							aria-label="导入食堂地图 bundle"
							disabled={props.saving || dirtyFloorIds.size > 0}
							onClick={beginImport}
							title={dirtyFloorIds.size > 0 ? "请先保存当前画布修改" : undefined}
							variant="secondary"
						>
							<FileUp />
							导入
						</Button>
						<Button
							aria-label="导出食堂地图 bundle"
							disabled={props.saving || dirtyFloorIds.size > 0}
							onClick={() => downloadDiningFloorplanBundle(props.draft.bundle)}
							title={dirtyFloorIds.size > 0 ? "请先保存当前画布修改" : undefined}
							variant="secondary"
						>
							<Download />
							导出
						</Button>
					</fieldset>
					<Button
						aria-busy={props.saving}
						className="editor-save min-w-0 whitespace-normal"
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
						<span>保存草稿</span>
					</Button>
					<div className="editor-status-group">
						<span
							className={`editor-status ui-metadata ${status.kind === "error" ? "error" : ""}`}
							role="status"
						>
							{status.message}
						</span>
						{importError && !pendingImport ? (
							<span className="text-danger text-xs" role="alert">
								{importError}
							</span>
						) : null}
					</div>
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
								licenseKey={DINING_TLDRAW_LICENSE.key}
								onMount={setEditor}
								options={tldrawOptions}
								overlayUtils={DINING_TLDRAW_OVERLAY_UTILS}
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
								<DiningEditorDiagnosticPanel diagnostics={activeDiagnostics} editor={editor} />
							) : null}
						</div>
					</section>
				</div>
			</section>

			<ConfirmDialog
				confirmLabel="替换草稿"
				confirmVariant="destructive"
				description="导入会整体替换当前全局地图草稿，不会自动发布到学生端。"
				error={importError}
				onConfirm={() => void confirmImport()}
				onOpenChange={(open) => {
					if (!(open || props.saving)) {
						setPendingImport(null);
						setImportError(null);
					}
				}}
				open={pendingImport !== null}
				pending={props.saving ?? false}
				pendingLabel="正在保存草稿…"
				title="替换全部食堂地图草稿？"
			>
				{pendingImport ? (
					<div className="grid gap-2 text-sm">
						<p>文件：{pendingImport.fileName}</p>
						<p>
							导入内容：{pendingImport.summary.halls} 个食堂、
							{pendingImport.summary.layouts} 个楼层、
							{pendingImport.summary.windows} 个窗口。
						</p>
						<p>这会替换当前所有校区和食堂的地图草稿；现有发布版本保持不变。</p>
					</div>
				) : null}
			</ConfirmDialog>

			<Dialog
				open={pendingWindowName !== null}
				onOpenChange={(open) => !open && cancelWindowName()}
			>
				<DialogContent className="w-[min(28rem,calc(100vw-2rem))]">
					<DialogHeader>
						<DialogTitle>给窗口命名</DialogTitle>
						<DialogDescription>窗口必须有学生能够辨认的名称。</DialogDescription>
					</DialogHeader>
					<Field label="窗口名称" className="gap-2">
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
					</Field>
					<DialogFooter>
						<Button onClick={cancelWindowName} variant="secondary">
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
