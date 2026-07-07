import { createDiningFloorplanScaffoldState } from "./floorplan-scaffold";
import { sha256Tag, stableJson } from "./hash";
import { buildPublishedSnapshot } from "./projection";
import { createDiningDraftVersion, DINING_SYSTEM_SOURCE } from "./state-factory";
import type {
	DiningMenuItem,
	DiningMenuOffering,
	DiningOperationsState,
	DiningRelease,
	DiningStallProfile,
	DiningWindowAssignment,
} from "./types";

const DEV_SEED_RELEASE_ID = "dining_release:dev_seed";
const DEV_SEED_ACTOR = "system:dining-dev-seed";
const DEV_SEED_SOURCE = {
	label: "本地开发食堂种子",
	updatedAt: DINING_SYSTEM_SOURCE.updatedAt,
};

export function createDevDiningOperationsState(): DiningOperationsState {
	const scaffold = createDiningFloorplanScaffoldState();
	const halls = DEV_SEED_HALL_IDS.map((hallId) => {
		const hall = scaffold.halls.find((item) => item.hallId === hallId);
		if (!hall) {
			throw new Error(`Dining dev seed hall scaffold is missing: ${hallId}.`);
		}
		if (hall.floors.length === 0) {
			throw new Error(`Dining dev seed hall has no floor scaffold: ${hallId}.`);
		}
		return hall;
	});
	const floorKeys = new Set(
		halls.flatMap((hall) =>
			hall.floors.map((floor) => floorKeyFor({ floorId: floor.floorId, hallId: hall.hallId })),
		),
	);
	const windows = scaffold.windows
		.filter((window) => floorKeys.has(floorKeyFor(window)))
		.map((window) => {
			const floorWindows = scaffold.windows.filter(
				(candidate) => candidate.hallId === window.hallId && candidate.floorId === window.floorId,
			);
			const seed =
				DEV_SEED_STALLS[floorWindows.findIndex((item) => item.windowId === window.windowId)];
			return {
				...window,
				label: seed?.displayName ?? window.label,
				locationLabel: "待补充档口",
				tags: seed?.tags ?? [],
			};
		});
	const stallProfiles: DiningStallProfile[] = [];
	const assignments: DiningWindowAssignment[] = [];
	const menuItems: DiningMenuItem[] = [];
	const menuOfferings: DiningMenuOffering[] = [];

	for (const hall of halls) {
		for (const floor of hall.floors) {
			const floorWindows = windows.filter(
				(window) => window.hallId === hall.hallId && window.floorId === floor.floorId,
			);
			if (floorWindows.length === 0) {
				throw new Error(
					`Dining dev seed floor has no window scaffold: ${hall.hallId}/${floor.floorId}.`,
				);
			}
			for (const [index, seed] of DEV_SEED_STALLS.entries()) {
				const window = floorWindows[index];
				if (!window) {
					break;
				}
				const seedScope = `${hall.hallId}:${floor.floorId}:${index + 1}`;
				const stallProfileId = `stall:dev:${seedScope}`;
				const assignmentId = assignmentIdForWindow(window);
				stallProfiles.push({
					displayName: seed.displayName,
					stallProfileId,
					stallType: "food_window",
					status: "active",
					tags: seed.tags,
				});
				assignments.push({
					assignmentId,
					stallProfileId,
					status: "active",
					windowId: window.windowId,
				});
				for (const [offeringIndex, offering] of seed.offerings.entries()) {
					const menuItemId = `menu:dev:${seedScope}:${offeringIndex + 1}`;
					menuItems.push({
						menuItemId,
						name: offering.name,
						status: "active",
						tags: offering.tags,
					});
					menuOfferings.push({
						assignmentId,
						menuItemId,
						offeringId: `offering:${assignmentId}:${menuItemId}`,
						priceLabel: offering.priceLabel,
					});
				}
			}
			if (
				!assignments.some((assignment) =>
					floorWindows.some((window) => window.windowId === assignment.windowId),
				)
			) {
				throw new Error(
					`Dining dev seed floor has no assigned offering: ${hall.hallId}/${floor.floorId}.`,
				);
			}
		}
	}

	const currentDraftVersion = createDiningDraftVersion({
		createdAt: DEV_SEED_SOURCE.updatedAt,
		createdBy: DEV_SEED_ACTOR,
		source: "dev-seed",
	});
	const draft: DiningOperationsState = {
		...scaffold,
		assignments,
		currentDraftVersion,
		draftVersions: [currentDraftVersion],
		halls,
		menuItems,
		menuOfferings,
		stallProfiles,
		windows,
	};
	const snapshot = buildPublishedSnapshot(draft, DEV_SEED_RELEASE_ID, DEV_SEED_SOURCE);
	const release: DiningRelease = {
		candidateId: null,
		createdAt: DEV_SEED_SOURCE.updatedAt,
		createdBy: DEV_SEED_ACTOR,
		notes: "本地开发食堂种子数据",
		predecessorReleaseId: null,
		publishedAt: DEV_SEED_SOURCE.updatedAt,
		publishedBy: DEV_SEED_ACTOR,
		releaseId: DEV_SEED_RELEASE_ID,
		snapshotHash: sha256Tag(stableJson(snapshot)),
		status: "published",
	};
	return {
		...draft,
		publishedRelease: release,
		publishedSnapshot: snapshot,
		releaseLatestPointer: {
			releaseId: release.releaseId,
			scope: "global",
			snapshotId: `snapshot:${release.releaseId}`,
			updatedAt: DEV_SEED_SOURCE.updatedAt,
			updatedBy: DEV_SEED_ACTOR,
		},
		releaseSnapshots: {
			[release.releaseId]: snapshot,
		},
		releases: [release],
	};
}

const DEV_SEED_HALL_IDS = [
	"haidian-canteen-1",
	"haidian-canteen-2",
	"haidian-canteen-4",
	"fengtai-huixian-canteen",
	"fengtai-juya-canteen",
] as const;

const DEV_SEED_STALLS = [
	{
		displayName: "鱼粉",
		offerings: [{ name: "金汤鱼粉", priceLabel: "12 元", tags: ["粉面"] }],
		tags: ["粉面"],
	},
	{
		displayName: "螺蛳粉",
		offerings: [{ name: "螺蛳粉", priceLabel: "12 元", tags: ["粉面", "热餐"] }],
		tags: ["粉面", "热餐"],
	},
	{
		displayName: "热餐窗口",
		offerings: [{ name: "番茄牛腩饭", priceLabel: "18 元", tags: ["主食", "热餐"] }],
		tags: ["主食", "热餐"],
	},
] satisfies Array<{
	displayName: string;
	offerings: Array<{ name: string; priceLabel: string | null; tags: string[] }>;
	tags: string[];
}>;

function assignmentIdForWindow(input: {
	floorId: string;
	hallId: string;
	windowId: string;
}): string {
	return `assignment:${input.hallId}:${input.floorId}:${input.windowId}`;
}

function floorKeyFor(input: { floorId: string; hallId: string }): string {
	return `${input.hallId}:${input.floorId}`;
}
