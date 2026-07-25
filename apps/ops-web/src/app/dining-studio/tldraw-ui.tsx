import * as RadixDialog from "@radix-ui/react-dialog";
import {
	Armchair,
	DoorOpen,
	Layers3,
	Lock,
	PanelTop,
	Route,
	Store,
	Unlock,
	Utensils,
	ZoomIn,
} from "lucide-react";
import { memo, useCallback, useEffect } from "react";
import {
	DefaultA11yAnnouncer,
	DefaultContextMenu,
	DefaultMinimap,
	DefaultNavigationPanel,
	DefaultQuickActions,
	DefaultToasts,
	DefaultToolbar,
	DefaultZoomMenu,
	type Editor,
	type TLShape,
	type TLUiComponents,
	type TLUiDialogProps,
	type TLUiOverrides,
	type TLUiToolItem,
	TldrawUiButton,
	TldrawUiButtonIcon,
	TldrawUiDialogBody,
	TldrawUiDialogCloseButton,
	TldrawUiDialogHeader,
	TldrawUiDialogTitle,
	TldrawUiMenuActionItem,
	TldrawUiMenuGroup,
	TldrawUiMenuToolItem,
	useDialogs,
	useEditor,
	useIsToolSelected,
	useToasts,
	useTools,
	useValue,
} from "tldraw";

import {
	DINING_ALLOWED_ACTION_IDS,
	duplicateDiningSelection,
	isDuplicableDiningShape,
	runDiningHistoryAction,
} from "./tldraw-policy";
import { DiningStylePanel } from "./tldraw-properties";
import { type DiningEditorShape, diningShapeEntityId, isDiningEditorShape } from "./tldraw-shapes";

const DINING_TOOL_IDS = [
	"select",
	"hand",
	"zoom",
	"dining-window",
	"dining-region",
	"dining-entrance",
	"dining-landmark",
	"dining-structure",
	"dining-partition",
] as const;

export const DINING_ZH_CN_TLDRAW_MESSAGES = {
	"action.copy-hovered-styles": "复制悬停元素样式",
	"action.frame-selection": "为选中元素创建框架",
	"page-menu.max-pages-reached": "已达到页面数量上限",
	"page-menu.resize": "调整页面大小",
} as const;

export const DINING_TLDRAW_UI_OVERRIDES: TLUiOverrides = {
	actions(editor, actions) {
		const duplicate = actions.duplicate;
		if (duplicate) {
			actions.duplicate = {
				...duplicate,
				onSelect: () => {
					duplicateDiningSelection(editor);
				},
			};
		}
		for (const direction of ["undo", "redo"] as const) {
			const action = actions[direction];
			if (action) {
				actions[direction] = {
					...action,
					onSelect: (source) => {
						runDiningHistoryAction(editor, direction, () => action.onSelect(source));
					},
				};
			}
		}
		return Object.fromEntries(
			Object.entries(actions).filter(([id]) => DINING_ALLOWED_ACTION_IDS.has(id)),
		);
	},
	tools(editor, tools) {
		const exactTools: Record<string, TLUiToolItem> = {};
		for (const id of ["select", "hand"] as const) {
			if (tools[id]) {
				exactTools[id] = tools[id];
			}
		}
		Object.assign(exactTools, {
			zoom: diningTool(editor, "zoom", "dining.tool.zoom", <ZoomIn />),
			"dining-entrance": diningTool(
				editor,
				"dining-entrance",
				"dining.tool.entrance",
				<DoorOpen />,
				"e",
			),
			"dining-landmark": diningTool(
				editor,
				"dining-landmark",
				"dining.tool.landmark",
				<Armchair />,
				"l",
			),
			"dining-partition": diningTool(
				editor,
				"dining-partition",
				"dining.tool.partition",
				<Route />,
				"p",
			),
			"dining-region": diningTool(editor, "dining-region", "dining.tool.region", <Utensils />, "r"),
			"dining-structure": diningTool(
				editor,
				"dining-structure",
				"dining.tool.structure",
				<PanelTop />,
				"s",
			),
			"dining-window": diningTool(editor, "dining-window", "dining.tool.window", <Store />, "w"),
		});
		return exactTools;
	},
	translations: {
		en: {
			"dining.tool.entrance": "Entrance",
			"dining.tool.landmark": "Landmark",
			"dining.tool.partition": "Partition",
			"dining.tool.region": "Area",
			"dining.tool.structure": "Structure",
			"dining.tool.window": "Stall position",
			"dining.tool.zoom": "Zoom",
		},
		"zh-cn": {
			...DINING_ZH_CN_TLDRAW_MESSAGES,
			"action.duplicate": "创建副本",
			"actions-menu.title": "地图工具",
			"style-panel.title": "元素属性",
			"dining.tool.entrance": "入口",
			"dining.tool.landmark": "地标",
			"dining.tool.partition": "分隔线",
			"dining.tool.region": "区域",
			"dining.tool.structure": "结构",
			"dining.tool.window": "窗口",
			"dining.tool.zoom": "缩放",
		},
		zh: {
			...DINING_ZH_CN_TLDRAW_MESSAGES,
			"action.duplicate": "创建副本",
			"actions-menu.title": "地图工具",
			"style-panel.title": "元素属性",
			"dining.tool.entrance": "入口",
			"dining.tool.landmark": "地标",
			"dining.tool.partition": "分隔线",
			"dining.tool.region": "区域",
			"dining.tool.structure": "结构",
			"dining.tool.window": "窗口",
			"dining.tool.zoom": "缩放",
		},
	},
};

export interface DiningEditorFeedback {
	id: number;
	message: string;
}

export function DiningEditorFeedbackToast({ feedback }: { feedback: DiningEditorFeedback | null }) {
	const { addToast } = useToasts();
	useEffect(() => {
		if (!feedback) {
			return;
		}
		addToast({
			id: `dining-editor-feedback-${feedback.id}`,
			severity: "warning",
			title: feedback.message,
		});
	}, [addToast, feedback]);
	return null;
}

export function createDiningTldrawUiComponents(input: { canEdit: boolean }): TLUiComponents {
	return {
		A11y: DefaultA11yAnnouncer,
		ActionsMenu: null,
		DebugMenu: null,
		DebugPanel: null,
		Dialogs: DiningDialogs,
		FollowingIndicator: null,
		HelpMenu: null,
		HelperButtons: input.canEdit ? DiningLayersButton : null,
		ImageToolbar: null,
		MainMenu: null,
		MenuPanel: null,
		Minimap: DefaultMinimap,
		NavigationPanel: DefaultNavigationPanel,
		PageMenu: null,
		PeopleMenu: null,
		QuickActions: DiningQuickActions,
		RichTextToolbar: null,
		SharePanel: null,
		StylePanel: input.canEdit ? DiningStylePanel : null,
		Toasts: DefaultToasts,
		Toolbar: input.canEdit ? DiningToolbar : null,
		TopPanel: null,
		VideoToolbar: null,
		ZoomMenu: DefaultZoomMenu,
	};
}

const DiningDialogs = memo(function DiningDialogs() {
	const { dialogs } = useDialogs();
	const dialogsArray = useValue("dining dialogs", () => dialogs.get(), [dialogs]);
	return dialogsArray.map((dialog) => <DiningDialog key={dialog.id} {...dialog} />);
});

function DiningDialog({
	id,
	component: ModalContent,
	preventBackgroundClose,
}: {
	id: string;
	component: React.ComponentType<TLUiDialogProps>;
	preventBackgroundClose?: boolean;
}) {
	const { removeDialog } = useDialogs();
	const handleOpenChange = useCallback(
		(isOpen: boolean) => {
			if (!isOpen) {
				removeDialog(id);
			}
		},
		[id, removeDialog],
	);
	return (
		<RadixDialog.Root defaultOpen onOpenChange={handleOpenChange}>
			<RadixDialog.Portal>
				<div className="tl-container tl-theme__light dining-tldraw-dialog-portal">
					<RadixDialog.Overlay className="tlui-dialog__overlay" />
					<div className="tlui-dialog__positioner">
						<RadixDialog.Content
							aria-describedby={undefined}
							className="tlui-dialog__content"
							onInteractOutside={(event) => {
								if (preventBackgroundClose) {
									event.preventDefault();
								}
							}}
						>
							<ModalContent onClose={() => handleOpenChange(false)} />
						</RadixDialog.Content>
					</div>
				</div>
			</RadixDialog.Portal>
		</RadixDialog.Root>
	);
}

function DiningQuickActions() {
	const editor = useEditor();
	const state = useValue("dining quick actions", () => {
		const selected = editor.getSelectedShapes();
		return {
			canDelete:
				selected.length > 0 &&
				selected.every(
					(shape) => !(shape.type === "dining-path" && shape.props.layer === "outline"),
				),
			canDuplicate: selected.length > 0 && selected.every(isDuplicableDiningShape),
			canRedo: editor.getCanRedo(),
			canUndo: editor.getCanUndo(),
		};
	}, [editor]);
	return (
		<DefaultQuickActions>
			<TldrawUiMenuActionItem actionId="undo" disabled={!state.canUndo} />
			<TldrawUiMenuActionItem actionId="redo" disabled={!state.canRedo} />
			<TldrawUiMenuActionItem actionId="delete" disabled={!state.canDelete} />
			<TldrawUiMenuActionItem actionId="duplicate" disabled={!state.canDuplicate} />
		</DefaultQuickActions>
	);
}

export function DiningContextMenu() {
	const editor = useEditor();
	const selected = useValue("dining context selection", () => editor.getSelectedShapes(), [editor]);
	const hasSelection = selected.length > 0;
	const hasOutline = selected.some(
		(shape) => shape.type === "dining-path" && shape.props.layer === "outline",
	);
	return (
		<DefaultContextMenu>
			{hasSelection ? (
				<>
					<TldrawUiMenuGroup id="dining-clipboard">
						{hasOutline ? null : <TldrawUiMenuActionItem actionId="cut" />}
						{hasOutline ? null : <TldrawUiMenuActionItem actionId="copy" />}
						{hasOutline ? null : <TldrawUiMenuActionItem actionId="duplicate" />}
						<TldrawUiMenuActionItem actionId="paste" />
					</TldrawUiMenuGroup>
					<TldrawUiMenuGroup id="dining-edit">
						<TldrawUiMenuActionItem actionId="toggle-lock" />
						{hasOutline ? null : <TldrawUiMenuActionItem actionId="delete" />}
					</TldrawUiMenuGroup>
					{selected.length > 1 && !hasOutline ? (
						<TldrawUiMenuGroup id="dining-layout">
							<TldrawUiMenuActionItem actionId="align-left" />
							<TldrawUiMenuActionItem actionId="align-center-horizontal" />
							<TldrawUiMenuActionItem actionId="align-right" />
							<TldrawUiMenuActionItem actionId="align-top" />
							<TldrawUiMenuActionItem actionId="align-center-vertical" />
							<TldrawUiMenuActionItem actionId="align-bottom" />
							{selected.length > 2 ? (
								<>
									<TldrawUiMenuActionItem actionId="distribute-horizontal" />
									<TldrawUiMenuActionItem actionId="distribute-vertical" />
								</>
							) : null}
						</TldrawUiMenuGroup>
					) : null}
				</>
			) : (
				<TldrawUiMenuGroup id="dining-canvas">
					<TldrawUiMenuActionItem actionId="paste" />
					<TldrawUiMenuActionItem actionId="select-all" />
					<TldrawUiMenuActionItem actionId="zoom-to-fit" />
					<TldrawUiMenuActionItem actionId="toggle-grid" />
					<TldrawUiMenuActionItem actionId="toggle-snap-mode" />
				</TldrawUiMenuGroup>
			)}
		</DefaultContextMenu>
	);
}

export function DiningElementList({ editor, onSelect }: { editor: Editor; onSelect?: () => void }) {
	const shapes = useValue(
		"dining element list",
		() => editor.getCurrentPageShapes().filter(isDiningEditorShape),
		[editor],
	);
	const selected = useValue("dining selected ids", () => new Set(editor.getSelectedShapeIds()), [
		editor,
	]);
	const groups = diningShapeGroups(shapes);
	return (
		<div className="element-sections">
			{groups.map((group) =>
				group.shapes.length > 0 ? (
					<section className="element-section" key={group.key}>
						<div className="element-section-heading">
							<h3>{group.label}</h3>
							<button
								aria-label={group.shapes.every((shape) => shape.isLocked) ? "解锁本组" : "锁定本组"}
								onClick={() =>
									toggleShapeLocks(
										editor,
										group.shapes,
										!group.shapes.every((shape) => shape.isLocked),
									)
								}
								type="button"
							>
								{group.shapes.every((shape) => shape.isLocked) ? (
									<Unlock aria-hidden="true" size={14} />
								) : (
									<Lock aria-hidden="true" size={14} />
								)}
							</button>
						</div>
						<div className="element-list">
							{[...group.shapes]
								.sort((a, b) =>
									(diningShapeEntityId(a) ?? "").localeCompare(diningShapeEntityId(b) ?? ""),
								)
								.map((shape, index, sorted) => (
									<button
										aria-pressed={selected.has(shape.id)}
										data-dining-editor-list-entity-id={diningShapeEntityId(shape)}
										key={shape.id}
										onClick={() => {
											editor.run(() => editor.select(shape.id), { history: "ignore" });
											editor.zoomToSelectionIfOffscreen(48, {
												animation: { duration: 180 },
												targetZoom: editor.getZoomLevel(),
											});
											onSelect?.();
										}}
										type="button"
									>
										{shapeLabel(shape, sorted.slice(0, index + 1))}
									</button>
								))}
						</div>
					</section>
				) : null,
			)}
		</div>
	);
}

export function DiningEditorErrorFallback({ error }: { error: unknown }) {
	return (
		<div className="dining-editor-error" role="alert">
			<div>
				<strong>地图编辑器暂时无法继续</strong>
				<p>重新载入已保存地图后可以继续编辑，当前未保存修改将被丢弃。</p>
				{import.meta.env.DEV && error instanceof Error ? <pre>{error.message}</pre> : null}
				<button onClick={() => window.location.reload()} type="button">
					重新载入已保存地图
				</button>
			</div>
		</div>
	);
}

function DiningToolbar() {
	const tools = useTools();
	return (
		<DefaultToolbar maxItems={9} maxSizePx={630} minItems={4} minSizePx={320}>
			{DINING_TOOL_IDS.map((id) => (
				<DiningToolbarItem key={id} tool={tools[id]} />
			))}
		</DefaultToolbar>
	);
}

function DiningLayersButton() {
	const dialogs = useDialogs();
	const editor = useEditor();
	return (
		<TldrawUiButton
			onClick={() =>
				dialogs.addDialog({
					component: (props) => <DiningLayersDialog {...props} editor={editor} />,
				})
			}
			title="图层与元素"
			type="icon"
		>
			<TldrawUiButtonIcon icon={<Layers3 aria-hidden="true" size={20} />} />
		</TldrawUiButton>
	);
}

function DiningToolbarItem({ tool }: { tool: TLUiToolItem | undefined }) {
	const isSelected = useIsToolSelected(tool);
	return tool ? <TldrawUiMenuToolItem isSelected={isSelected} toolId={tool.id} /> : null;
}

function DiningLayersDialog({ editor, onClose }: TLUiDialogProps & { editor: Editor }) {
	return (
		<>
			<TldrawUiDialogHeader>
				<TldrawUiDialogTitle>图层与元素</TldrawUiDialogTitle>
				<TldrawUiDialogCloseButton />
			</TldrawUiDialogHeader>
			<TldrawUiDialogBody className="dining-layers-dialog">
				<DiningElementList editor={editor} onSelect={onClose} />
				<TldrawUiButton onClick={onClose} type="normal">
					关闭
				</TldrawUiButton>
			</TldrawUiDialogBody>
		</>
	);
}

function diningTool(
	editor: Editor,
	id: string,
	label: string,
	icon: React.ReactElement,
	kbd?: string,
): TLUiToolItem {
	return {
		icon: icon as TLUiToolItem["icon"],
		id,
		kbd,
		label,
		onSelect: () => editor.setCurrentTool(id),
	};
}

function diningShapeGroups(shapes: DiningEditorShape[]) {
	return [
		{
			key: "window",
			label: "窗口",
			shapes: shapes.filter((shape) => shape.type === "dining-window"),
		},
		{
			key: "region",
			label: "区域",
			shapes: shapes.filter((shape) => shape.type === "dining-region"),
		},
		{
			key: "entrance",
			label: "入口",
			shapes: shapes.filter((shape) => shape.type === "dining-entrance"),
		},
		{
			key: "landmark",
			label: "地标",
			shapes: shapes.filter((shape) => shape.type === "dining-landmark"),
		},
		{
			key: "structure",
			label: "结构",
			shapes: shapes.filter(
				(shape) => shape.type === "dining-path" && shape.props.layer === "structure",
			),
		},
		{
			key: "partition",
			label: "分隔线",
			shapes: shapes.filter(
				(shape) => shape.type === "dining-path" && shape.props.layer === "partition",
			),
		},
		{
			key: "outline",
			label: "外轮廓",
			shapes: shapes.filter(
				(shape) => shape.type === "dining-path" && shape.props.layer === "outline",
			),
		},
	];
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

function shapeLabel(shape: DiningEditorShape, preceding: DiningEditorShape[]): string {
	const base =
		shape.type === "dining-path"
			? pathLayerLabel(shape.props.layer)
			: shape.props.label || "未命名窗口";
	const sameKind = preceding.filter((candidate) => {
		const label =
			candidate.type === "dining-path"
				? pathLayerLabel(candidate.props.layer)
				: candidate.props.label || "未命名窗口";
		return label === base;
	});
	return sameKind.length > 1 ? `${base} ${sameKind.length}` : base;
}

function pathLayerLabel(layer: "outline" | "partition" | "structure"): string {
	return { outline: "外轮廓", partition: "分隔线", structure: "结构" }[layer];
}
