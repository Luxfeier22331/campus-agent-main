import { z } from "zod";

export const CAMPUS_GROUPS_SCHEMA_VERSION = "campus-groups-catalog.v1" as const;
export const CAMPUS_GROUPS_QQ_JOIN_URL_PATTERN = "^https://(?:jq|qm|qun)\\.qq\\.com(?:[/?#]|$)";
export const CAMPUS_GROUPS_DISCORD_JOIN_URL_PATTERN =
	"^https://(?:discord\\.gg/|(?:www\\.)?discord\\.com/invite/)[^/?#]+(?:[/?#]|$)";

const NonEmptyTextSchema = z.string().trim().min(1).max(200);

export const CampusGroupIdSchema = NonEmptyTextSchema;
export const CampusGroupSectionIdSchema = NonEmptyTextSchema;

export const CampusGroupsQqJoinUrlSchema = z
	.string()
	.url()
	.regex(new RegExp(CAMPUS_GROUPS_QQ_JOIN_URL_PATTERN, "u"), "加入链接必须是 QQ 官方 HTTPS 链接。")
	.meta({ format: "uri" });

export const CampusGroupsDiscordJoinUrlSchema = z
	.string()
	.url()
	.regex(
		new RegExp(CAMPUS_GROUPS_DISCORD_JOIN_URL_PATTERN, "u"),
		"加入链接必须是 Discord 官方 HTTPS 邀请链接。",
	)
	.meta({ format: "uri" });

export const CampusGroupsJoinUrlSchema = z.union([
	CampusGroupsQqJoinUrlSchema,
	CampusGroupsDiscordJoinUrlSchema,
]);

export const CampusGroupSchema = z
	.object({
		id: CampusGroupIdSchema,
		joinUrl: CampusGroupsJoinUrlSchema.nullable(),
		name: NonEmptyTextSchema,
		qqGroupNumber: z
			.string()
			.regex(/^[0-9]{5,12}$/u)
			.nullable(),
		summary: z.string().trim().max(2000),
		tags: z.array(z.string().trim().min(1).max(80)).max(20),
	})
	.strict();

export const CampusGroupSectionSchema = z
	.object({
		groups: z.array(CampusGroupSchema).max(500),
		id: CampusGroupSectionIdSchema,
		name: NonEmptyTextSchema,
	})
	.strict();

const CampusGroupsCatalogObjectSchema = z
	.object({
		schemaVersion: z.literal(CAMPUS_GROUPS_SCHEMA_VERSION),
		sections: z.array(CampusGroupSectionSchema),
	})
	.strict();

export const CampusGroupsCatalogSchema =
	CampusGroupsCatalogObjectSchema.superRefine(assertUniqueGroups);

export type CampusGroup = z.infer<typeof CampusGroupSchema>;
export type CampusGroupSection = z.infer<typeof CampusGroupSectionSchema>;
export type CampusGroupsCatalog = z.infer<typeof CampusGroupsCatalogSchema>;
export type CampusGroupsJoinPlatform = "discord" | "qq";

export function getCampusGroupsJoinPlatform(value: string): CampusGroupsJoinPlatform | null {
	if (CampusGroupsQqJoinUrlSchema.safeParse(value).success) {
		return "qq";
	}
	if (CampusGroupsDiscordJoinUrlSchema.safeParse(value).success) {
		return "discord";
	}
	return null;
}

function assertUniqueGroups(
	value: { sections: CampusGroupSection[] },
	context: z.RefinementCtx,
): void {
	const sectionIds = new Set<string>();
	const sectionNames = new Set<string>();
	const groupIds = new Set<string>();
	const qqNumbers = new Set<string>();
	let groupCount = 0;
	for (const [sectionIndex, section] of value.sections.entries()) {
		if (sectionIds.has(section.id)) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "分组 ID 不能重复。",
				path: ["sections", sectionIndex, "id"],
			});
		}
		sectionIds.add(section.id);
		if (sectionNames.has(section.name)) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "分组名称不能重复。",
				path: ["sections", sectionIndex, "name"],
			});
		}
		sectionNames.add(section.name);

		for (const [groupIndex, group] of section.groups.entries()) {
			groupCount += 1;
			if (groupIds.has(group.id)) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					message: "群 ID 不能重复。",
					path: ["sections", sectionIndex, "groups", groupIndex, "id"],
				});
			}
			groupIds.add(group.id);
			if (group.qqGroupNumber && qqNumbers.has(group.qqGroupNumber)) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					message: "群号不能重复。",
					path: ["sections", sectionIndex, "groups", groupIndex, "qqGroupNumber"],
				});
			}
			if (group.qqGroupNumber) {
				qqNumbers.add(group.qqGroupNumber);
			}
		}
	}
	if (groupCount > 500) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			message: "目录最多包含 500 个群。",
			path: ["sections"],
		});
	}
}
