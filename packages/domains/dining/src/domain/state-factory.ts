import type { DiningDraftVersion } from "./release-types";
import type { DiningOperationsState } from "./types";

export const DINING_CANVAS = {
	height: 420,
	width: 720,
};

export const DINING_SYSTEM_SOURCE = {
	label: "食堂发布数据",
	updatedAt: "2026-06-08T00:00:00.000Z",
};

export function createDiningDraftVersion(input: {
	createdAt?: string;
	createdBy?: string;
	source: string;
	versionNumber?: number;
}): DiningDraftVersion {
	const versionNumber = input.versionNumber ?? 1;
	return {
		createdAt: input.createdAt ?? DINING_SYSTEM_SOURCE.updatedAt,
		createdBy: input.createdBy ?? "system:dining",
		draftVersionId: `dining_draft_version:${versionNumber}`,
		summary: { source: input.source },
		versionNumber,
	};
}

export function createEmptyDiningOperationsState(
	input: { createdAt?: string; createdBy?: string; source?: string } = {},
): DiningOperationsState {
	const currentDraftVersion = createDiningDraftVersion({
		createdAt: input.createdAt,
		createdBy: input.createdBy,
		source: input.source ?? "empty",
	});
	return {
		auditEvents: [],
		assignments: [],
		candidateSnapshots: {},
		currentDraftVersion,
		draftVersions: [currentDraftVersion],
		halls: [],
		menuItems: [],
		menuOfferings: [],
		publishedRelease: null,
		publishedSnapshot: null,
		releaseCandidateValidationReports: [],
		releaseCandidates: [],
		releaseLatestPointer: null,
		releaseScheduleJobs: [],
		releaseSnapshots: {},
		releases: [],
		reviewProjections: [],
		stallProfiles: [],
		windows: [],
	};
}
