import type { CampusGroup, CampusGroupsCatalog } from "campus-contracts/campus-groups";
import { asc, eq } from "drizzle-orm";

import type { Env } from "../../config";
import { createRuntimeDbGetter, type RuntimeDatabase } from "../../db/runtime";
import { campusGroupSections, campusGroups } from "../../db/schema";
import type { CampusGroupsStore } from "./types";

type RuntimeDbGetter = () => Promise<RuntimeDatabase>;

export function createPgCampusGroupsStore(
	env: Env,
	input: { getDb?: RuntimeDbGetter } = {},
): CampusGroupsStore {
	const getDb = input.getDb ?? createRuntimeDbGetter(env, { consistency: "fresh" });

	return {
		async getCatalog() {
			const rows = await (await getDb())
				.select({
					group: {
						id: campusGroups.id,
						joinUrl: campusGroups.joinUrl,
						name: campusGroups.name,
						qqGroupNumber: campusGroups.qqGroupNumber,
						summary: campusGroups.summary,
						tags: campusGroups.tags,
					},
					section: {
						id: campusGroupSections.id,
						name: campusGroupSections.name,
					},
				})
				.from(campusGroupSections)
				.leftJoin(campusGroups, eq(campusGroups.sectionId, campusGroupSections.id))
				.orderBy(
					asc(campusGroupSections.position),
					asc(campusGroupSections.id),
					asc(campusGroups.position),
					asc(campusGroups.id),
				);

			const sections: CampusGroupsCatalog["sections"] = [];
			for (const row of rows) {
				let section = sections.at(-1);
				if (section?.id !== row.section.id) {
					section = { groups: [], id: row.section.id, name: row.section.name };
					sections.push(section);
				}
				if (row.group) {
					section.groups.push(row.group);
				}
			}

			return { schemaVersion: "campus-groups-catalog.v1", sections };
		},
		async replaceCatalog(catalog) {
			const db = await getDb();
			await db.transaction(async (tx) => {
				await tx.delete(campusGroupSections);
				if (catalog.sections.length === 0) {
					return;
				}
				await tx.insert(campusGroupSections).values(
					catalog.sections.map((section, position) => ({
						id: section.id,
						name: section.name,
						position,
					})),
				);
				const groups = catalog.sections.flatMap((section) =>
					section.groups.map((group, position) => toGroupRow(group, section.id, position)),
				);
				if (groups.length > 0) {
					await tx.insert(campusGroups).values(groups);
				}
			});
		},
	};
}

function toGroupRow(
	group: CampusGroup,
	sectionId: string,
	position: number,
): typeof campusGroups.$inferInsert {
	return {
		id: group.id,
		joinUrl: group.joinUrl,
		name: group.name,
		position,
		qqGroupNumber: group.qqGroupNumber,
		sectionId,
		summary: group.summary,
		tags: group.tags,
	};
}
