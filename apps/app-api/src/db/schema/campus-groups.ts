import { sql } from "drizzle-orm";
import { check, integer, pgSchema, text, uniqueIndex } from "drizzle-orm/pg-core";

export const campusGroupsSchema = pgSchema("campus_groups");

export const campusGroupSections = campusGroupsSchema.table(
	"sections",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		position: integer("position").notNull(),
	},
	(table) => ({
		nameUnique: uniqueIndex("campus_groups_sections_name_uidx").on(table.name),
		positionCheck: check("campus_groups_sections_position_check", sql`${table.position} >= 0`),
		positionUnique: uniqueIndex("campus_groups_sections_position_uidx").on(table.position),
	}),
);

export const campusGroups = campusGroupsSchema.table(
	"groups",
	{
		id: text("id").primaryKey(),
		joinUrl: text("join_url"),
		name: text("name").notNull(),
		position: integer("position").notNull(),
		qqGroupNumber: text("qq_group_number"),
		sectionId: text("section_id")
			.notNull()
			.references(() => campusGroupSections.id, { onDelete: "cascade" }),
		summary: text("summary").notNull(),
		tags: text("tags").array().notNull(),
	},
	(table) => ({
		positionCheck: check("campus_groups_groups_position_check", sql`${table.position} >= 0`),
		qqGroupNumberUnique: uniqueIndex("campus_groups_groups_qq_group_number_uidx").on(
			table.qqGroupNumber,
		),
		sectionPositionUnique: uniqueIndex("campus_groups_groups_section_position_uidx").on(
			table.sectionId,
			table.position,
		),
	}),
);
