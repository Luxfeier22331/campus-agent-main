import {
	type CampusGroupsCatalog,
	getCampusGroupsJoinPlatform,
} from "campus-contracts/campus-groups";

export interface InterestGroupJoinLink {
	platform: "discord" | "qq";
	url: string;
}

export interface InterestGroup {
	id: string;
	joinUrl?: string | null;
	name: string;
	qqGroupNumber: string | null;
	summary: string;
	tags: readonly string[];
}

export interface InterestGroupSection {
	groups: readonly InterestGroup[];
	id: string;
	name: string;
}

export interface InterestGroupCatalog {
	sections: readonly InterestGroupSection[];
}

export function toInterestGroupCatalog(response: CampusGroupsCatalog): InterestGroupCatalog {
	return {
		sections: response.sections.flatMap((section) =>
			section.groups.length > 0
				? [
						{
							groups: section.groups.map((group) => ({
								id: group.id,
								joinUrl: group.joinUrl,
								name: group.name,
								qqGroupNumber: group.qqGroupNumber,
								summary: group.summary,
								tags: group.tags,
							})),
							id: section.id,
							name: section.name,
						},
					]
				: [],
		),
	};
}

export function filterInterestGroupCatalog(
	catalog: InterestGroupCatalog,
	query: string,
): InterestGroupCatalog {
	const normalizedQuery = normalizeSearchText(query);
	if (!normalizedQuery) {
		return catalog;
	}

	return {
		sections: catalog.sections.flatMap((section) => {
			const groups = section.groups.filter((group) =>
				buildSearchText(section.name, group).includes(normalizedQuery),
			);
			return groups.length > 0 ? [{ ...section, groups }] : [];
		}),
	};
}

export function countInterestGroups(catalog: InterestGroupCatalog): number {
	return catalog.sections.reduce((count, section) => count + section.groups.length, 0);
}

export function getSafeGroupJoinLink(
	value: string | null | undefined,
): InterestGroupJoinLink | null {
	if (!value) {
		return null;
	}
	const platform = getCampusGroupsJoinPlatform(value);
	if (!platform) {
		return null;
	}
	try {
		const url = new URL(value);
		return {
			platform,
			url: url.toString(),
		};
	} catch {
		return null;
	}
}

export function getQqGroupAvatarUrl(groupNumber: string | null | undefined): string | null {
	const normalizedGroupNumber = groupNumber?.trim() ?? "";
	if (!/^\d{5,12}$/.test(normalizedGroupNumber)) {
		return null;
	}
	return `https://p.qlogo.cn/gh/${normalizedGroupNumber}/${normalizedGroupNumber}/100/`;
}

function buildSearchText(sectionName: string, group: InterestGroup): string {
	return normalizeSearchText(
		[sectionName, group.name, group.qqGroupNumber ?? "", group.summary, ...group.tags].join(" "),
	);
}

function normalizeSearchText(value: string): string {
	return value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/\s+/g, " ").trim();
}
