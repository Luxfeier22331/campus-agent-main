import type { DiningDraft } from "./types";

export const DINING_SYSTEM_SOURCE = {
	label: "食堂发布数据",
	updatedAt: "2026-06-08T00:00:00.000Z",
};

export function createEmptyDiningDraft(
	input: { createdAt?: string; createdBy?: string } = {},
): DiningDraft {
	return {
		assignments: [],
		baseReleaseId: null,
		halls: [],
		menuItems: [],
		menuOfferings: [],
		revision: 1,
		stallProfiles: [],
		updatedAt: input.createdAt ?? DINING_SYSTEM_SOURCE.updatedAt,
		updatedBy: input.createdBy ?? "system:dining",
		windows: [],
	};
}
