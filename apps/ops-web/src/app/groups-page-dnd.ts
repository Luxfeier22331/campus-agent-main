import {
	type CollisionDetection,
	closestCenter,
	type DragEndEvent,
	KeyboardCode,
	type KeyboardCoordinateGetter,
	type UniqueIdentifier,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { CampusGroupsCatalog } from "campus-contracts/campus-groups";

const SECTION_DND_PREFIX = "section:";
const GROUP_DND_PREFIX = "group:";
const GROUP_CONTAINER_DND_PREFIX = "section-groups:";

export type CatalogDragItemType = "group" | "group-container" | "section";

export const catalogCollisionDetection: CollisionDetection = (args) =>
	closestCenter({
		...args,
		droppableContainers: args.droppableContainers.filter((container) =>
			isCompatibleDragTarget(args.active.data.current?.type, container.data.current?.type),
		),
	});

export function getCatalogKeyboardCoordinates(
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

export function reorderCatalog(
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

export function sectionDndId(sectionId: string): string {
	return `${SECTION_DND_PREFIX}${sectionId}`;
}

export function groupDndId(groupId: string): string {
	return `${GROUP_DND_PREFIX}${groupId}`;
}

export function groupContainerDndId(sectionId: string): string {
	return `${GROUP_CONTAINER_DND_PREFIX}${sectionId}`;
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
		const group = section.groups[groupIndex];
		if (groupIndex >= 0 && group) {
			return { group, groupIndex, section };
		}
	}
	return null;
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
