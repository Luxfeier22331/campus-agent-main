import { Button, Card, CardContent, StateMessage } from "@campus-agent/ui";
import {
	DndContext,
	type KeyboardCoordinateGetter,
	KeyboardSensor,
	PointerSensor,
	type UniqueIdentifier,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CampusGroupsCatalog } from "campus-contracts/campus-groups";
import { Check, Plus, RefreshCw } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { SortableGroupSection } from "./groups-catalog";
import { ActionConfirmation, GroupEditor, SectionEditor } from "./groups-editors";
import {
	catalogCollisionDetection,
	getCatalogKeyboardCoordinates,
	reorderCatalog,
	sectionDndId,
} from "./groups-page-dnd";
import {
	applySectionEditor,
	type CatalogMutation,
	type CatalogMutationKind,
	countGroups,
	createEmptyGroup,
	createEmptySection,
	emptyCatalog,
	type GroupEditorState,
	type PendingRemoval,
	removeCatalogItem,
	type SectionEditorState,
	upsertGroup,
} from "./groups-page-model";
import { fetchCampusGroupsCatalog, replaceCampusGroupsCatalog } from "./ops-api/campus-groups";
import { ErrorState, InlineError, PageHeader } from "./ops-display";

const CATALOG_QUERY_KEY = ["campus-groups", "catalog"] as const;

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
						className="p-4 text-muted-foreground text-sm md:p-5"
						role="status"
					>
						<StateMessage layout="inline" description="正在读取同好群目录..." />
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
				<div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
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
									<SortableGroupSection
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
						<CardContent className="p-4 text-muted-foreground text-sm md:p-5">
							<StateMessage layout="inline" description="目录中还没有分组。" />
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
						persist(
							applySectionEditor(data, editingSection, section),
							editingSection.kind === "add" ? "add-section" : "rename-section",
						);
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
						persist(
							removeCatalogItem(data, pendingRemoval),
							pendingRemoval.kind === "section" ? "delete-section" : "delete-group",
						);
					}}
				/>
			) : null}
		</div>
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
					variant="ghost"
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
