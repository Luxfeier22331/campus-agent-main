import { ActionGroup, Badge, Button, cn } from "@campus-agent/ui";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
	type CampusGroup,
	type CampusGroupSection,
	getCampusGroupsJoinPlatform,
} from "campus-contracts/campus-groups";
import { Edit3, GripVertical, Plus, Trash2 } from "lucide-react";
import type { CSSProperties } from "react";
import {
	type CatalogDragItemType,
	groupContainerDndId,
	groupDndId,
	sectionDndId,
} from "./groups-page-dnd";

export function SortableGroupSection({
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
				<ActionGroup className="shrink-0">
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
				</ActionGroup>
			</header>

			<SortableContext
				items={section.groups.map((group) => groupDndId(group.id))}
				strategy={verticalListSortingStrategy}
			>
				<ul
					aria-label={`“${section.name}”分组中的群`}
					className={cn("min-h-14 divide-y divide-border", droppable.isOver && "bg-selected")}
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
			<ActionGroup className="col-start-3 row-span-3 row-start-1 shrink-0 self-center md:col-start-auto md:row-span-1 md:row-start-auto">
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
			</ActionGroup>
		</li>
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
