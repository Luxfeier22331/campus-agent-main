import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	Badge,
	Button,
	Card,
	CardContent,
	cn,
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Field,
	Input,
	NativeSelect,
	Textarea,
} from "@campus-agent/ui";
import {
	type CollisionDetection,
	closestCenter,
	DndContext,
	type DragEndEvent,
	KeyboardCode,
	type KeyboardCoordinateGetter,
	KeyboardSensor,
	PointerSensor,
	type UniqueIdentifier,
	useDroppable,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	arrayMove,
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	type CampusGroup,
	type CampusGroupSection,
	type CampusGroupsCatalog,
	getCampusGroupsJoinPlatform,
} from "campus-contracts/campus-groups";
import { Check, Edit3, GripVertical, Plus, RefreshCw, Trash2 } from "lucide-react";
import type { CSSProperties } from "react";
import { useCallback, useRef, useState } from "react";
import { fetchCampusGroupsCatalog, replaceCampusGroupsCatalog } from "./ops-api-client";
import { ErrorState, InlineError, PageHeader } from "./ops-display";

const CATALOG_QUERY_KEY = ["campus-groups", "catalog"] as const;
const SECTION_DND_PREFIX = "section:";
const GROUP_DND_PREFIX = "group:";
const GROUP_CONTAINER_DND_PREFIX = "section-groups:";

type CatalogMutationKind =
	| "add-group"
	| "add-section"
	| "delete-group"
	| "delete-section"
	| "edit-group"
	| "rename-section"
	| "reorder";

interface CatalogMutation {
	kind: CatalogMutationKind;
	next: CampusGroupsCatalog;
	previous: CampusGroupsCatalog;
}

interface GroupEditorState {
	group: CampusGroup;
	originalSectionId: string | null;
	sectionId: string;
}

type PendingRemoval =
	| { group: CampusGroup; kind: "group"; sectionId: string }
	| { kind: "section"; section: CampusGroupSection };

type SectionEditorState =
	| { kind: "add"; section: CampusGroupSection }
	| { kind: "rename"; section: CampusGroupSection };

type CatalogDragItemType = "group" | "group-container" | "section";

const catalogCollisionDetection: CollisionDetection = (args) =>
	closestCenter({
		...args,
		droppableContainers: args.droppableContainers.filter((container) =>
			isCompatibleDragTarget(args.active.data.current?.type, container.data.current?.type),
		),
	});

function getCatalogKeyboardCoordinates(
	event: KeyboardEvent,
	args: Parameters<KeyboardCoordinateGetter>[1],
	setPreferredTarget: (target: UniqueIdentifier | null) => void,
): ReturnType<KeyboardCoordinateGetter> {
	const activeType = args.context.active?.data.current?.type;
	const originalContainers = args.context.droppableContainers;
	if (
		activeType === "section" &&
		(event.code === KeyboardCode.Down || event.code === KeyboardCode.Up)
	) {
		event.preventDefault();
		const sections = originalContainers
			.getEnabled()
			.filter((container) => container.data.current?.type === "section")
			.sort((left, right) => (left.rect.current?.top ?? 0) - (right.rect.current?.top ?? 0));
		const activeIndex = sections.findIndex((container) => container.id === args.active);
		const target = sections[activeIndex + (event.code === KeyboardCode.Down ? 1 : -1)];
		setPreferredTarget(target?.id ?? null);
		const targetRect = target
			? (args.context.droppableRects.get(target.id) ?? target.rect.current)
			: null;
		const collisionRect = args.context.collisionRect;
		if (!(targetRect && collisionRect)) {
			return;
		}
		return {
			x:
				args.currentCoordinates.x +
				targetRect.left +
				targetRect.width / 2 -
				collisionRect.left -
				collisionRect.width / 2,
			y:
				args.currentCoordinates.y +
				targetRect.top +
				targetRect.height / 2 -
				collisionRect.top -
				collisionRect.height / 2,
		};
	}
	if (
		activeType === "group" &&
		(event.code === KeyboardCode.Down || event.code === KeyboardCode.Up)
	) {
		const activeContainer = originalContainers.get(args.active);
		const activeSortable = activeContainer?.data.current?.sortable;
		const groups = originalContainers
			.getEnabled()
			.filter(
				(container) =>
					container.data.current?.type === "group" &&
					container.data.current?.sortable?.containerId === activeSortable?.containerId,
			)
			.sort((left, right) => (left.rect.current?.top ?? 0) - (right.rect.current?.top ?? 0));
		const activeIndex = groups.findIndex((container) => container.id === args.active);
		const target = groups[activeIndex + (event.code === KeyboardCode.Down ? 1 : -1)];
		const targetRect = target
			? (args.context.droppableRects.get(target.id) ?? target.rect.current)
			: null;
		const collisionRect = args.context.collisionRect;
		if (target) {
			event.preventDefault();
			setPreferredTarget(target.id);
			if (!(targetRect && collisionRect)) {
				return;
			}
			return {
				x:
					args.currentCoordinates.x +
					targetRect.left +
					targetRect.width / 2 -
					collisionRect.left -
					collisionRect.width / 2,
				y:
					args.currentCoordinates.y +
					targetRect.top +
					targetRect.height / 2 -
					collisionRect.top -
					collisionRect.height / 2,
			};
		}
	}
	setPreferredTarget(null);
	const droppableContainers = new Map(originalContainers) as typeof originalContainers;
	droppableContainers.getEnabled = () =>
		originalContainers
			.getEnabled()
			.filter((container) => isCompatibleKeyboardTarget(activeType, container.data.current));
	droppableContainers.getNodeFor = (id) => originalContainers.getNodeFor(id);
	droppableContainers.toArray = () => [...droppableContainers.values()];

	return sortableKeyboardCoordinates(event, {
		...args,
		context: { ...args.context, droppableContainers },
	});
}

export function GroupsPage() {
	const queryClient = useQueryClient();
	const preferredDragTarget = useRef<UniqueIdentifier | null>(null);
	const [editingGroup, setEditingGroup] = useState<GroupEditorState | null>(null);
	const [editingSection, setEditingSection] = useState<SectionEditorState | null>(null);
	const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null);
	const [feedback, setFeedback] = useState<CatalogMutationKind | null>(null);
	const catalog = useQuery({
		queryFn: ({ signal }) => fetchCampusGroupsCatalog({ signal }),
		queryKey: CATALOG_QUERY_KEY,
	});
	const mutation = useMutation({
		mutationFn: ({ next }: CatalogMutation) => replaceCampusGroupsCatalog(next),
		onError: (_error, input) => {
			queryClient.setQueryData(CATALOG_QUERY_KEY, input.previous);
		},
		onSuccess: (saved, input) => {
			queryClient.setQueryData(CATALOG_QUERY_KEY, saved);
			setEditingGroup(null);
			setEditingSection(null);
			setPendingRemoval(null);
			setFeedback(input.kind);
		},
	});
	const keyboardCoordinates = useCallback<KeyboardCoordinateGetter>(
		(event, args) =>
			getCatalogKeyboardCoordinates(event, args, (target) => {
				preferredDragTarget.current = target;
			}),
		[],
	);
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
		useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates }),
	);

	const refresh = async () => {
		await queryClient.invalidateQueries({ queryKey: CATALOG_QUERY_KEY });
	};
	const persist = (next: CampusGroupsCatalog, kind: CatalogMutationKind) => {
		if (!(catalog.data && !mutation.isPending)) {
			return;
		}
		mutation.reset();
		setFeedback(null);
		const previous = catalog.data;
		queryClient.setQueryData(CATALOG_QUERY_KEY, next);
		mutation.mutate({ kind, next, previous });
	};

	if (catalog.isPending) {
		return (
			<div className="mx-auto w-full max-w-[1440px]">
				<GroupsHeader onRefresh={() => void refresh()} refreshing={catalog.isFetching} />
				<Card>
					<CardContent
						aria-live="polite"
						className="p-6 text-muted-foreground text-sm"
						role="status"
					>
						正在读取同好群目录...
					</CardContent>
				</Card>
			</div>
		);
	}
	if (catalog.error && !catalog.data) {
		return (
			<div className="mx-auto w-full max-w-[1440px]">
				<GroupsHeader onRefresh={() => void catalog.refetch()} refreshing={catalog.isFetching} />
				<ErrorState
					error={catalog.error}
					onRetry={() => void catalog.refetch()}
					title="同好群目录读取失败"
				/>
			</div>
		);
	}

	const data = catalog.data ?? emptyCatalog();
	const totalGroups = countGroups(data);
	const mutationKind = mutation.variables?.kind;

	return (
		<div className="mx-auto w-full max-w-[1440px]">
			<GroupsHeader onRefresh={() => void refresh()} refreshing={catalog.isFetching} />
			<MutationFeedbackNotice kind={feedback} />
			{catalog.error ? (
				<ErrorState
					error={catalog.error}
					onRetry={() => void catalog.refetch()}
					title="同好群目录读取失败"
				/>
			) : null}
			{mutation.error && mutationKind === "reorder" ? (
				<div className="mb-4">
					<InlineError error={mutation.error} title="顺序保存失败" />
				</div>
			) : null}

			<section className="grid min-w-0 content-start gap-4">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div>
						<h2 className="font-semibold text-lg">目录</h2>
						<p className="mt-1 text-muted-foreground text-sm">
							{data.sections.length} 个分组 · {totalGroups} 个群
						</p>
					</div>
					<Button
						disabled={mutation.isPending}
						onClick={() => {
							mutation.reset();
							setFeedback(null);
							setEditingSection({ kind: "add", section: createEmptySection() });
						}}
					>
						<Plus className="size-4" />
						新增分组
					</Button>
				</div>

				{data.sections.length > 0 ? (
					<DndContext
						collisionDetection={catalogCollisionDetection}
						onDragCancel={() => {
							preferredDragTarget.current = null;
						}}
						onDragEnd={(event) => {
							const next = reorderCatalog(data, event, preferredDragTarget.current);
							preferredDragTarget.current = null;
							if (next) {
								persist(next, "reorder");
							}
						}}
						sensors={sensors}
					>
						<SortableContext
							items={data.sections.map((section) => sectionDndId(section.id))}
							strategy={verticalListSortingStrategy}
						>
							<div className="grid gap-4">
								{data.sections.map((section) => (
									<SortableSection
										disabled={mutation.isPending}
										key={section.id}
										onAddGroup={() => {
											mutation.reset();
											setEditingGroup({
												group: createEmptyGroup(),
												originalSectionId: null,
												sectionId: section.id,
											});
										}}
										onEditGroup={(group) => {
											mutation.reset();
											setEditingGroup({
												group,
												originalSectionId: section.id,
												sectionId: section.id,
											});
										}}
										onRemoveGroup={(group) => {
											mutation.reset();
											setPendingRemoval({ group, kind: "group", sectionId: section.id });
										}}
										onRemoveSection={() => {
											mutation.reset();
											setPendingRemoval({ kind: "section", section });
										}}
										onRenameSection={() => {
											mutation.reset();
											setEditingSection({ kind: "rename", section });
										}}
										section={section}
									/>
								))}
							</div>
						</SortableContext>
					</DndContext>
				) : (
					<Card>
						<CardContent className="p-6 text-muted-foreground text-sm">
							目录中还没有分组。
						</CardContent>
					</Card>
				)}
			</section>

			{editingSection ? (
				<SectionEditor
					error={
						mutationKind === "add-section" || mutationKind === "rename-section"
							? mutation.error
							: null
					}
					pending={mutation.isPending}
					state={editingSection}
					onCancel={() => {
						mutation.reset();
						setEditingSection(null);
					}}
					onSave={(section) => {
						const next =
							editingSection.kind === "add"
								? { ...data, sections: [...data.sections, section] }
								: {
										...data,
										sections: data.sections.map((current) =>
											current.id === section.id ? section : current,
										),
									};
						persist(next, editingSection.kind === "add" ? "add-section" : "rename-section");
					}}
				/>
			) : null}

			{editingGroup ? (
				<GroupEditor
					error={
						mutationKind === "add-group" || mutationKind === "edit-group" ? mutation.error : null
					}
					pending={mutation.isPending}
					sections={data.sections}
					state={editingGroup}
					onCancel={() => {
						mutation.reset();
						setEditingGroup(null);
					}}
					onSave={(nextState) => {
						persist(
							upsertGroup(data, nextState, editingGroup.originalSectionId),
							editingGroup.originalSectionId ? "edit-group" : "add-group",
						);
					}}
				/>
			) : null}

			{pendingRemoval ? (
				<ActionConfirmation
					error={
						mutationKind === "delete-group" || mutationKind === "delete-section"
							? mutation.error
							: null
					}
					pending={mutation.isPending}
					removal={pendingRemoval}
					onCancel={() => {
						mutation.reset();
						setPendingRemoval(null);
					}}
					onConfirm={() => {
						if (pendingRemoval.kind === "section") {
							persist(
								{
									...data,
									sections: data.sections.filter(
										(section) => section.id !== pendingRemoval.section.id,
									),
								},
								"delete-section",
							);
							return;
						}
						persist(
							{
								...data,
								sections: data.sections.map((section) =>
									section.id === pendingRemoval.sectionId
										? {
												...section,
												groups: section.groups.filter(
													(group) => group.id !== pendingRemoval.group.id,
												),
											}
										: section,
								),
							},
							"delete-group",
						);
					}}
				/>
			) : null}
		</div>
	);
}

function SortableSection({
	disabled,
	onAddGroup,
	onEditGroup,
	onRemoveGroup,
	onRemoveSection,
	onRenameSection,
	section,
}: {
	disabled: boolean;
	onAddGroup: () => void;
	onEditGroup: (group: CampusGroup) => void;
	onRemoveGroup: (group: CampusGroup) => void;
	onRemoveSection: () => void;
	onRenameSection: () => void;
	section: CampusGroupSection;
}) {
	const sortable = useSortable({
		data: { type: "section" satisfies CatalogDragItemType },
		disabled,
		id: sectionDndId(section.id),
	});
	const droppable = useDroppable({
		data: {
			empty: section.groups.length === 0,
			type: "group-container" satisfies CatalogDragItemType,
		},
		disabled,
		id: groupContainerDndId(section.id),
	});
	const style: CSSProperties = {
		transform: CSS.Transform.toString(sortable.transform),
		transition: sortable.transition,
	};

	return (
		<section
			className={cn(
				"overflow-hidden rounded-lg border border-border bg-card",
				sortable.isDragging && "z-10 opacity-70 shadow-lg",
			)}
			ref={sortable.setNodeRef}
			style={style}
		>
			<header className="flex min-w-0 items-center gap-2 border-border border-b bg-muted/30 px-3 py-3 sm:px-4">
				<button
					aria-label={`调整分组“${section.name}”的顺序`}
					className="grid size-10 shrink-0 touch-none place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
					disabled={disabled}
					title="调整分组顺序"
					type="button"
					{...sortable.attributes}
					{...sortable.listeners}
				>
					<GripVertical className="size-4" />
				</button>
				<div className="min-w-0 flex-1">
					<h3 className="truncate font-semibold text-base text-foreground">{section.name}</h3>
					<p className="mt-0.5 text-muted-foreground text-xs">{section.groups.length} 个群</p>
				</div>
				<div className="flex shrink-0 items-center gap-1">
					<Button
						aria-label={`在“${section.name}”中新增群`}
						className="size-10 p-0"
						disabled={disabled}
						onClick={onAddGroup}
						title="新增群"
						variant="ghost"
					>
						<Plus className="size-4" />
					</Button>
					<Button
						aria-label={`重命名分组“${section.name}”`}
						className="size-10 p-0"
						disabled={disabled}
						onClick={onRenameSection}
						title="重命名分组"
						variant="ghost"
					>
						<Edit3 className="size-4" />
					</Button>
					<Button
						aria-label={`删除分组“${section.name}”`}
						className="size-10 p-0"
						disabled={disabled}
						onClick={onRemoveSection}
						title="删除分组"
						variant="ghost"
					>
						<Trash2 className="size-4 text-destructive" />
					</Button>
				</div>
			</header>

			<SortableContext
				items={section.groups.map((group) => groupDndId(group.id))}
				strategy={verticalListSortingStrategy}
			>
				<ul
					aria-label={`“${section.name}”分组中的群`}
					className={cn("min-h-14 divide-y divide-border", droppable.isOver && "bg-primary/5")}
					ref={droppable.setNodeRef}
				>
					{section.groups.length > 0 ? (
						section.groups.map((group) => (
							<SortableGroupRow
								disabled={disabled}
								group={group}
								key={group.id}
								onEdit={() => onEditGroup(group)}
								onRemove={() => onRemoveGroup(group)}
							/>
						))
					) : (
						<li className="px-4 py-5 text-muted-foreground text-sm">此分组暂无群。</li>
					)}
				</ul>
			</SortableContext>
		</section>
	);
}

function SortableGroupRow({
	disabled,
	group,
	onEdit,
	onRemove,
}: {
	disabled: boolean;
	group: CampusGroup;
	onEdit: () => void;
	onRemove: () => void;
}) {
	const sortable = useSortable({
		data: { type: "group" satisfies CatalogDragItemType },
		disabled,
		id: groupDndId(group.id),
	});
	const style: CSSProperties = {
		transform: CSS.Transform.toString(sortable.transform),
		transition: sortable.transition,
	};

	return (
		<li
			className={cn(
				"grid min-w-0 grid-cols-[2.5rem_minmax(0,1fr)_auto] items-start gap-x-2 px-2 py-3 sm:px-3 md:grid-cols-[2.5rem_minmax(12rem,1.3fr)_minmax(9rem,0.8fr)_minmax(10rem,1fr)_auto] md:items-center",
				sortable.isDragging && "z-10 bg-card opacity-70 shadow-md",
			)}
			ref={sortable.setNodeRef}
			style={style}
		>
			<button
				aria-label={`调整“${group.name}”的顺序`}
				className="grid size-10 touch-none place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
				disabled={disabled}
				title="调整群顺序"
				type="button"
				{...sortable.attributes}
				{...sortable.listeners}
			>
				<GripVertical className="size-4" />
			</button>
			<div className="min-w-0 self-center">
				<h4 className="break-words font-medium text-foreground">{group.name}</h4>
				{group.summary ? (
					<p className="mt-1 line-clamp-2 break-words text-muted-foreground text-xs leading-5">
						{group.summary}
					</p>
				) : null}
			</div>
			<div className="col-start-2 mt-2 min-w-0 self-center md:col-start-auto md:mt-0">
				<GroupContact group={group} />
			</div>
			<div className="col-start-2 mt-2 min-w-0 self-center text-muted-foreground text-sm md:col-start-auto md:mt-0">
				{group.tags.join("、") || "未填写标签"}
			</div>
			<div className="col-start-3 row-span-3 row-start-1 flex shrink-0 gap-1 self-center md:col-start-auto md:row-span-1 md:row-start-auto">
				<Button
					aria-label={`编辑 ${group.name}`}
					className="size-10 p-0"
					disabled={disabled}
					onClick={onEdit}
					title="编辑"
					variant="ghost"
				>
					<Edit3 className="size-4" />
				</Button>
				<Button
					aria-label={`删除 ${group.name}`}
					className="size-10 p-0"
					disabled={disabled}
					onClick={onRemove}
					title="删除"
					variant="ghost"
				>
					<Trash2 className="size-4 text-destructive" />
				</Button>
			</div>
		</li>
	);
}

function GroupsHeader({ onRefresh, refreshing }: { onRefresh: () => void; refreshing: boolean }) {
	return (
		<PageHeader
			actions={
				<Button
					aria-busy={refreshing}
					aria-label={refreshing ? "刷新中" : "刷新同好群目录"}
					disabled={refreshing}
					onClick={onRefresh}
					variant="outline"
				>
					<RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} />
					<span>{refreshing ? "刷新中..." : "刷新"}</span>
				</Button>
			}
			description="维护面向学生展示的同好群目录。"
			title="同好群"
		/>
	);
}

function MutationFeedbackNotice({ kind }: { kind: CatalogMutationKind | null }) {
	if (!kind) {
		return null;
	}
	const labels: Record<CatalogMutationKind, string> = {
		"add-group": "同好群已新增。",
		"add-section": "分组已新增。",
		"delete-group": "同好群已删除。",
		"delete-section": "分组已删除。",
		"edit-group": "同好群已保存。",
		"rename-section": "分组已重命名。",
		reorder: "目录顺序已保存。",
	};
	return (
		<div
			aria-live="polite"
			className="mb-4 flex items-center gap-2 rounded-md border border-success/20 bg-success-subtle px-3 py-2 text-success text-sm"
			role="status"
		>
			<Check aria-hidden="true" className="size-4 shrink-0" />
			<span>{labels[kind]}</span>
		</div>
	);
}

function SectionEditor({
	error,
	onCancel,
	onSave,
	pending,
	state,
}: {
	error: unknown;
	onCancel: () => void;
	onSave: (section: CampusGroupSection) => void;
	pending: boolean;
	state: SectionEditorState;
}) {
	const [name, setName] = useState(state.section.name);
	return (
		<Dialog
			onOpenChange={(open) => {
				if (!(open || pending)) {
					onCancel();
				}
			}}
			open
		>
			<DialogContent className="max-w-lg" showCloseButton={!pending}>
				<DialogHeader>
					<DialogTitle>{state.kind === "add" ? "新增分组" : "重命名分组"}</DialogTitle>
				</DialogHeader>
				<form
					className="grid gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						onSave({ ...state.section, name: name.trim() });
					}}
				>
					<Field label="分组名称">
						<Input
							autoFocus
							className="min-h-11"
							onChange={(event) => setName(event.target.value)}
							required
							value={name}
						/>
					</Field>
					{error ? <InlineError error={error} title="保存失败" /> : null}
					<DialogFooter>
						<Button disabled={pending} onClick={onCancel} variant="ghost">
							取消
						</Button>
						<Button disabled={pending} type="submit">
							保存
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function GroupEditor({
	error,
	onCancel,
	onSave,
	pending,
	sections,
	state,
}: {
	error: unknown;
	onCancel: () => void;
	onSave: (state: GroupEditorState) => void;
	pending: boolean;
	sections: CampusGroupSection[];
	state: GroupEditorState;
}) {
	const [form, setForm] = useState(state);
	const [tagsInput, setTagsInput] = useState(state.group.tags.join("，"));
	return (
		<Dialog
			onOpenChange={(open) => {
				if (!(open || pending)) {
					onCancel();
				}
			}}
			open
		>
			<DialogContent
				className="max-h-[calc(100dvh-2rem)] max-w-2xl overflow-y-auto"
				showCloseButton={!pending}
			>
				<DialogHeader>
					<DialogTitle>{state.originalSectionId ? "编辑同好群" : "新增同好群"}</DialogTitle>
				</DialogHeader>
				<form
					className="grid gap-4 sm:grid-cols-2"
					onSubmit={(event) => {
						event.preventDefault();
						onSave({
							...form,
							group: {
								...form.group,
								name: form.group.name.trim(),
								qqGroupNumber: form.group.qqGroupNumber?.trim() || null,
								summary: form.group.summary.trim(),
								tags: tagsInput
									.split(/[,，]/)
									.map((tag) => tag.trim())
									.filter(Boolean),
							},
						});
					}}
				>
					<Field label="群名">
						<Input
							autoFocus
							className="min-h-11"
							onChange={(event) =>
								setForm({ ...form, group: { ...form.group, name: event.target.value } })
							}
							required
							value={form.group.name}
						/>
					</Field>
					<Field label="分组">
						<NativeSelect
							className="min-h-11"
							onChange={(event) => setForm({ ...form, sectionId: event.target.value })}
							value={form.sectionId}
						>
							{sections.map((section) => (
								<option key={section.id} value={section.id}>
									{section.name}
								</option>
							))}
						</NativeSelect>
					</Field>
					<Field label="QQ 群号">
						<Input
							className="min-h-11"
							inputMode="numeric"
							onChange={(event) =>
								setForm({
									...form,
									group: { ...form.group, qqGroupNumber: event.target.value || null },
								})
							}
							pattern="[0-9]{5,12}"
							value={form.group.qqGroupNumber ?? ""}
						/>
					</Field>
					<Field label="标签（用逗号分隔）">
						<Input
							className="min-h-11"
							onChange={(event) => setTagsInput(event.target.value)}
							value={tagsInput}
						/>
					</Field>
					<Field className="sm:col-span-2" label="说明">
						<Textarea
							className="min-h-24"
							onChange={(event) =>
								setForm({ ...form, group: { ...form.group, summary: event.target.value } })
							}
							rows={3}
							value={form.group.summary}
						/>
					</Field>
					<Field
						className="sm:col-span-2"
						description="仅填写群主或管理员取得的真实官方邀请链接；没有链接时留空。"
						label="官方邀请链接（可选）"
					>
						<Input
							className="min-h-11"
							onChange={(event) =>
								setForm({
									...form,
									group: { ...form.group, joinUrl: event.target.value || null },
								})
							}
							placeholder="QQ 或 Discord 官方 HTTPS 邀请链接"
							type="url"
							value={form.group.joinUrl ?? ""}
						/>
					</Field>
					{error ? (
						<div className="sm:col-span-2">
							<InlineError error={error} title="保存失败" />
						</div>
					) : null}
					<DialogFooter className="sm:col-span-2">
						<Button disabled={pending} onClick={onCancel} variant="ghost">
							取消
						</Button>
						<Button disabled={pending} type="submit">
							保存
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function ActionConfirmation({
	error,
	onCancel,
	onConfirm,
	pending,
	removal,
}: {
	error: unknown;
	onCancel: () => void;
	onConfirm: () => void;
	pending: boolean;
	removal: PendingRemoval;
}) {
	const title =
		removal.kind === "group"
			? `确定删除“${removal.group.name}”吗？`
			: `确定删除分组“${removal.section.name}”吗？`;
	const description =
		removal.kind === "group"
			? "删除后学生端将不再显示该群。"
			: removal.section.groups.length > 0
				? `该分组中的 ${removal.section.groups.length} 个群将同时删除。`
				: "该分组将从目录中删除。";
	return (
		<AlertDialog
			onOpenChange={(open) => {
				if (!(open || pending)) {
					onCancel();
				}
			}}
			open
		>
			<AlertDialogContent className="max-w-2xl border-warning/30 bg-warning-subtle">
				<AlertDialogHeader>
					<AlertDialogTitle>{title}</AlertDialogTitle>
					<AlertDialogDescription className="text-warning">{description}</AlertDialogDescription>
				</AlertDialogHeader>
				{error ? <InlineError error={error} title="删除失败" /> : null}
				<AlertDialogFooter>
					<AlertDialogCancel disabled={pending}>取消</AlertDialogCancel>
					<Button
						className="border-destructive/30 text-destructive hover:bg-destructive/10"
						disabled={pending}
						onClick={onConfirm}
						variant="outline"
					>
						{pending ? "处理中..." : "确认"}
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

function GroupContact({ group }: { group: CampusGroup }) {
	const joinPlatform = group.joinUrl ? getCampusGroupsJoinPlatform(group.joinUrl) : null;
	const label = group.qqGroupNumber
		? `QQ ${group.qqGroupNumber}`
		: joinPlatform === "discord"
			? "Discord 邀请链接"
			: joinPlatform === "qq"
				? "QQ 邀请链接"
				: null;

	if (!label) {
		return <span className="text-muted-foreground text-sm">未提供联系方式</span>;
	}

	return (
		<div className="grid min-w-0 gap-1">
			<span className="break-words text-sm">{label}</span>
			<Badge tone={group.joinUrl ? "success" : "neutral"}>
				{group.joinUrl ? "邀请链接已配置" : "未配置邀请链接"}
			</Badge>
		</div>
	);
}

function reorderCatalog(
	catalog: CampusGroupsCatalog,
	event: DragEndEvent,
	preferredTarget: UniqueIdentifier | null = null,
): CampusGroupsCatalog | null {
	const activeId = String(event.active.id);
	const overId =
		preferredTarget === null
			? event.over
				? String(event.over.id)
				: null
			: String(preferredTarget);
	if (!overId || activeId === overId) {
		return null;
	}

	if (activeId.startsWith(SECTION_DND_PREFIX)) {
		const activeSectionId = activeId.slice(SECTION_DND_PREFIX.length);
		const overSectionId = sectionIdForTarget(catalog, overId);
		if (!overSectionId || activeSectionId === overSectionId) {
			return null;
		}
		const activeIndex = catalog.sections.findIndex((section) => section.id === activeSectionId);
		const overIndex = catalog.sections.findIndex((section) => section.id === overSectionId);
		return activeIndex < 0 || overIndex < 0
			? null
			: { ...catalog, sections: arrayMove(catalog.sections, activeIndex, overIndex) };
	}

	if (!activeId.startsWith(GROUP_DND_PREFIX)) {
		return null;
	}
	const activeGroupId = activeId.slice(GROUP_DND_PREFIX.length);
	const source = findGroup(catalog, activeGroupId);
	const targetSectionId = sectionIdForTarget(catalog, overId);
	if (!(source && targetSectionId)) {
		return null;
	}
	const targetSection = catalog.sections.find((section) => section.id === targetSectionId);
	if (!targetSection) {
		return null;
	}

	if (source.section.id === targetSectionId) {
		const overGroupId = overId.startsWith(GROUP_DND_PREFIX)
			? overId.slice(GROUP_DND_PREFIX.length)
			: null;
		const targetIndex = overGroupId
			? source.section.groups.findIndex((group) => group.id === overGroupId)
			: source.section.groups.length - 1;
		if (targetIndex < 0 || targetIndex === source.groupIndex) {
			return null;
		}
		return {
			...catalog,
			sections: catalog.sections.map((section) =>
				section.id === source.section.id
					? {
							...section,
							groups: arrayMove(section.groups, source.groupIndex, targetIndex),
						}
					: section,
			),
		};
	}

	const overGroupId = overId.startsWith(GROUP_DND_PREFIX)
		? overId.slice(GROUP_DND_PREFIX.length)
		: null;
	const targetIndex = overGroupId
		? targetSection.groups.findIndex((group) => group.id === overGroupId)
		: targetSection.groups.length;
	if (targetIndex < 0) {
		return null;
	}
	return {
		...catalog,
		sections: catalog.sections.map((section) => {
			if (section.id === source.section.id) {
				return {
					...section,
					groups: section.groups.filter((group) => group.id !== source.group.id),
				};
			}
			if (section.id === targetSectionId) {
				const groups = [...section.groups];
				groups.splice(targetIndex, 0, source.group);
				return { ...section, groups };
			}
			return section;
		}),
	};
}

function sectionIdForTarget(catalog: CampusGroupsCatalog, targetId: string): string | null {
	if (targetId.startsWith(SECTION_DND_PREFIX)) {
		return targetId.slice(SECTION_DND_PREFIX.length);
	}
	if (targetId.startsWith(GROUP_CONTAINER_DND_PREFIX)) {
		return targetId.slice(GROUP_CONTAINER_DND_PREFIX.length);
	}
	if (targetId.startsWith(GROUP_DND_PREFIX)) {
		return findGroup(catalog, targetId.slice(GROUP_DND_PREFIX.length))?.section.id ?? null;
	}
	return null;
}

function findGroup(catalog: CampusGroupsCatalog, groupId: string) {
	for (const section of catalog.sections) {
		const groupIndex = section.groups.findIndex((group) => group.id === groupId);
		if (groupIndex >= 0) {
			return { group: section.groups[groupIndex], groupIndex, section };
		}
	}
	return null;
}

function upsertGroup(
	catalog: CampusGroupsCatalog,
	state: GroupEditorState,
	originalSectionId: string | null,
): CampusGroupsCatalog {
	return {
		...catalog,
		sections: catalog.sections.map((section) => {
			const originalIndex = section.groups.findIndex((group) => group.id === state.group.id);
			if (section.id === state.sectionId) {
				if (section.id === originalSectionId && originalIndex >= 0) {
					const groups = [...section.groups];
					groups[originalIndex] = state.group;
					return { ...section, groups };
				}
				return { ...section, groups: [...section.groups, state.group] };
			}
			return originalIndex >= 0
				? { ...section, groups: section.groups.filter((group) => group.id !== state.group.id) }
				: section;
		}),
	};
}

function countGroups(catalog: CampusGroupsCatalog): number {
	return catalog.sections.reduce((count, section) => count + section.groups.length, 0);
}

function emptyCatalog(): CampusGroupsCatalog {
	return { schemaVersion: "campus-groups-catalog.v1", sections: [] };
}

function createEmptySection(): CampusGroupSection {
	return { groups: [], id: `section-${crypto.randomUUID()}`, name: "" };
}

function createEmptyGroup(): CampusGroup {
	return {
		id: `group-${crypto.randomUUID()}`,
		joinUrl: null,
		name: "",
		qqGroupNumber: null,
		summary: "",
		tags: [],
	};
}

function sectionDndId(sectionId: string): string {
	return `${SECTION_DND_PREFIX}${sectionId}`;
}

function groupDndId(groupId: string): string {
	return `${GROUP_DND_PREFIX}${groupId}`;
}

function groupContainerDndId(sectionId: string): string {
	return `${GROUP_CONTAINER_DND_PREFIX}${sectionId}`;
}

function isCompatibleDragTarget(activeType: unknown, targetType: unknown): boolean {
	if (activeType === "section") {
		return targetType === "section";
	}
	if (activeType === "group") {
		return targetType === "group" || targetType === "group-container";
	}
	return false;
}

function isCompatibleKeyboardTarget(
	activeType: unknown,
	targetData: Record<string, unknown> | undefined,
): boolean {
	if (activeType === "group") {
		return (
			targetData?.type === "group" ||
			(targetData?.type === "group-container" && targetData.empty === true)
		);
	}
	return isCompatibleDragTarget(activeType, targetData?.type);
}
