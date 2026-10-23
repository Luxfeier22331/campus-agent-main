import {
	type CampusGroupsCatalog,
	CampusGroupsCatalogSchema,
} from "campus-contracts/campus-groups";

import { AppApiRouteError } from "../../http";

export function parseCampusGroupsCatalogInput(value: unknown): CampusGroupsCatalog {
	const result = CampusGroupsCatalogSchema.safeParse(value);
	if (!result.success) {
		throw groupsError("groups_catalog_invalid", "同好群目录不符合合同。", 422, {
			issues: result.error.issues.slice(0, 20),
		});
	}
	return {
		schemaVersion: result.data.schemaVersion,
		sections: result.data.sections.map((section) => ({
			...section,
			groups: section.groups.map((group) => ({
				...group,
				tags: [...new Set(group.tags)],
			})),
		})),
	};
}

export function groupsError(
	code: string,
	message: string,
	status: 422,
	details?: Record<string, unknown>,
): AppApiRouteError {
	return new AppApiRouteError({ code, details, message, retryable: false, status });
}
