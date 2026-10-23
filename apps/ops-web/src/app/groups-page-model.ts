import type {
	CampusGroup,
	CampusGroupSection,
	CampusGroupsCatalog,
} from "campus-contracts/campus-groups";

export type CatalogMutationKind =
	| "add-group"
	| "add-section"
	| "delete-group"
	| "delete-section"
	| "edit-group"
	| "rename-section"
	| "reorder";

export interface CatalogMutation {
	kind: CatalogMutationKind;
	next: CampusGroupsCatalog;
	previous: CampusGroupsCatalog;
}

export interface GroupEditorState {
	group: CampusGroup;
	originalSectionId: string | null;
	sectionId: string;
}

export type PendingRemoval =
	| { group: CampusGroup; kind: "group"; sectionId: string }
	| { kind: "section"; section: CampusGroupSection };

export type SectionEditorState =
	| { kind: "add"; section: CampusGroupSection }
	| { kind: "rename"; section: CampusGroupSection };

export function applySectionEditor(
	catalog: CampusGroupsCatalog,
	state: SectionEditorState,
	section: CampusGroupSection,
): CampusGroupsCatalog {
	return state.kind === "add"
		? { ...catalog, sections: [...catalog.sections, section] }
		: {
				...catalog,
				sections: catalog.sections.map((current) =>
					current.id === section.id ? section : current,
				),
			};
}

export function removeCatalogItem(
	catalog: CampusGroupsCatalog,
	removal: PendingRemoval,
): CampusGroupsCatalog {
	if (removal.kind === "section") {
		return {
			...catalog,
			sections: catalog.sections.filter((section) => section.id !== removal.section.id),
		};
	}
	return {
		...catalog,
		sections: catalog.sections.map((section) =>
			section.id === removal.sectionId
				? {
						...section,
						groups: section.groups.filter((group) => group.id !== removal.group.id),
					}
				: section,
		),
	};
}

export function upsertGroup(
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

export function countGroups(catalog: CampusGroupsCatalog): number {
	return catalog.sections.reduce((count, section) => count + section.groups.length, 0);
}

export function emptyCatalog(): CampusGroupsCatalog {
	return { schemaVersion: "campus-groups-catalog.v1", sections: [] };
}

export function createEmptySection(): CampusGroupSection {
	return { groups: [], id: `section-${crypto.randomUUID()}`, name: "" };
}

export function createEmptyGroup(): CampusGroup {
	return {
		id: `group-${crypto.randomUUID()}`,
		joinUrl: null,
		name: "",
		qqGroupNumber: null,
		summary: "",
		tags: [],
	};
}
