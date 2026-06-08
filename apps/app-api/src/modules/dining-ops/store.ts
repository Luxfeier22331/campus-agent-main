import { desc, eq } from "drizzle-orm";

import type { Env } from "../../config";
import {
	createRuntimeDbGetter,
	type RuntimeDatabase,
	type RuntimeDbGetter,
} from "../../db/runtime";
import {
	diningAuditEvents,
	diningFloors,
	diningHalls,
	diningMenuItems,
	diningMenuOfferings,
	diningReleaseSnapshots,
	diningReleases,
	diningStallProfiles,
	diningWindowAssignments,
	diningWindows,
} from "../../db/schema";
import { DINING_SOURCE } from "../campus-experience";
import {
	createInitialDiningOperationsState,
	type DiningAuditEvent,
	type DiningMenuItem,
	type DiningMenuOffering,
	type DiningOperationsState,
	type DiningOperationsStore,
	type DiningOpsHall,
	type DiningPublishedSnapshot,
	type DiningRelease,
	type DiningReleaseStatus,
	type DiningSaleStatus,
	type DiningStallProfile,
	type DiningWindow,
	type DiningWindowAssignment,
	type DiningWindowStatus,
} from ".";

export function createPgDiningOperationsStore(
	env: Env,
	input: {
		getDb?: RuntimeDbGetter;
	} = {},
): DiningOperationsStore {
	const getDb = input.getDb ?? createRuntimeDbGetter(env, { consistency: "fresh" });

	return {
		async getState() {
			return loadDiningOperationsState(await getDb());
		},
		async saveState(state) {
			await saveDiningOperationsState(await getDb(), state);
		},
	};
}

export async function ensureInitialDiningOperationsRelease(input: {
	db: RuntimeDatabase;
}): Promise<boolean> {
	const releaseRows = await input.db
		.select({ releaseId: diningReleases.releaseId })
		.from(diningReleases)
		.where(eq(diningReleases.releaseId, "dining_release:initial"))
		.limit(1);
	if (releaseRows[0]) {
		return false;
	}
	await saveDiningOperationsState(input.db, createInitialDiningOperationsState());
	return true;
}

async function loadDiningOperationsState(db: RuntimeDatabase): Promise<DiningOperationsState> {
	const [
		hallRows,
		floorRows,
		windowRows,
		stallProfileRows,
		assignmentRows,
		menuItemRows,
		menuOfferingRows,
		releaseRows,
		snapshotRows,
		auditRows,
	] = await Promise.all([
		db.select().from(diningHalls),
		db.select().from(diningFloors),
		db.select().from(diningWindows),
		db.select().from(diningStallProfiles),
		db.select().from(diningWindowAssignments),
		db.select().from(diningMenuItems),
		db.select().from(diningMenuOfferings),
		db.select().from(diningReleases).orderBy(desc(diningReleases.createdAt)),
		db.select().from(diningReleaseSnapshots),
		db.select().from(diningAuditEvents).orderBy(desc(diningAuditEvents.occurredAt)),
	]);

	const floorsByHall = new Map<string, typeof floorRows>();
	for (const floorRow of floorRows) {
		const existing = floorsByHall.get(floorRow.hallId) ?? [];
		existing.push(floorRow);
		floorsByHall.set(floorRow.hallId, existing);
	}

	const releases = releaseRows.map(toRelease);
	const releaseSnapshots = Object.fromEntries(
		snapshotRows.map((row) => [row.releaseId, parseSnapshotPayload(row.payloadJson)]),
	);
	const publishedRelease =
		releases.find((release) => release.status === "published" && release.publishedAt) ?? null;
	const publishedSnapshot = publishedRelease
		? (releaseSnapshots[publishedRelease.releaseId] ?? null)
		: null;

	return {
		auditEvents: auditRows.map(toAuditEvent),
		assignments: assignmentRows.map(toAssignment),
		halls: hallRows.map(
			(row): DiningOpsHall => ({
				campus: row.campus,
				floors: [...(floorsByHall.get(row.hallId) ?? [])]
					.sort((left, right) => left.sortKey.localeCompare(right.sortKey))
					.map((floor) => ({
						floorId: floor.floorId,
						label: floor.label,
						svgAssetUrl: floor.svgAssetUrl,
					})),
				hallId: row.hallId,
				name: row.name,
				status: row.status as "active",
			}),
		),
		menuItems: menuItemRows.map(toMenuItem),
		menuOfferings: menuOfferingRows.map(toMenuOffering),
		publishedRelease,
		publishedSnapshot,
		releaseSnapshots,
		releases,
		stallProfiles: stallProfileRows.map(toStallProfile),
		windows: windowRows.map(toWindow),
	};
}

async function saveDiningOperationsState(
	db: RuntimeDatabase,
	state: DiningOperationsState,
): Promise<void> {
	const now = new Date();
	await db.transaction(async (tx) => {
		await tx.delete(diningAuditEvents);
		await tx.delete(diningReleaseSnapshots);
		await tx.delete(diningReleases);
		await tx.delete(diningMenuOfferings);
		await tx.delete(diningMenuItems);
		await tx.delete(diningWindowAssignments);
		await tx.delete(diningStallProfiles);
		await tx.delete(diningWindows);
		await tx.delete(diningFloors);
		await tx.delete(diningHalls);

		if (state.halls.length > 0) {
			await tx.insert(diningHalls).values(
				state.halls.map((hall) => ({
					campus: hall.campus,
					createdAt: now,
					hallId: hall.hallId,
					name: hall.name,
					status: hall.status,
					updatedAt: now,
				})),
			);
		}

		const floorRows = state.halls.flatMap((hall) =>
			hall.floors.map((floor, index) => ({
				createdAt: now,
				floorId: floor.floorId,
				hallId: hall.hallId,
				label: floor.label,
				sortKey: String(index).padStart(4, "0"),
				svgAssetUrl: floor.svgAssetUrl,
				updatedAt: now,
			})),
		);
		if (floorRows.length > 0) {
			await tx.insert(diningFloors).values(floorRows);
		}

		if (state.windows.length > 0) {
			await tx.insert(diningWindows).values(
				state.windows.map((window) => ({
					createdAt: now,
					floorId: window.floorId,
					geometryJson: window.geometry,
					hallId: window.hallId,
					label: window.label,
					locationLabel: window.locationLabel,
					status: window.status,
					tagsJson: window.tags,
					updatedAt: now,
					windowId: window.windowId,
				})),
			);
		}

		if (state.stallProfiles.length > 0) {
			await tx.insert(diningStallProfiles).values(
				state.stallProfiles.map((profile) => ({
					createdAt: now,
					displayName: profile.displayName,
					stallProfileId: profile.stallProfileId,
					stallType: profile.stallType,
					status: profile.status,
					tagsJson: profile.tags,
					updatedAt: now,
				})),
			);
		}

		if (state.assignments.length > 0) {
			await tx.insert(diningWindowAssignments).values(
				state.assignments.map((assignment) => ({
					assignmentId: assignment.assignmentId,
					createdAt: now,
					effectiveFrom: null,
					effectiveTo: null,
					stallProfileId: assignment.stallProfileId,
					status: assignment.status,
					updatedAt: now,
					windowId: assignment.windowId,
				})),
			);
		}

		if (state.menuItems.length > 0) {
			await tx.insert(diningMenuItems).values(
				state.menuItems.map((item) => ({
					createdAt: now,
					menuItemId: item.menuItemId,
					name: item.name,
					status: item.status,
					tagsJson: item.tags,
					updatedAt: now,
				})),
			);
		}

		if (state.menuOfferings.length > 0) {
			await tx.insert(diningMenuOfferings).values(
				state.menuOfferings.map((offering) => ({
					assignmentId: offering.assignmentId,
					createdAt: now,
					menuItemId: offering.menuItemId,
					offeringId: offering.offeringId,
					priceLabel: offering.priceLabel,
					saleStatus: offering.saleStatus,
					specLabel: offering.specLabel,
					updatedAt: now,
				})),
			);
		}

		if (state.releases.length > 0) {
			await tx.insert(diningReleases).values(
				state.releases.map((release) => ({
					createdAt: new Date(release.createdAt),
					createdBy: release.createdBy,
					notes: release.notes,
					published: release.status === "published",
					publishedAt: release.publishedAt ? new Date(release.publishedAt) : null,
					publishedBy: release.publishedBy,
					releaseId: release.releaseId,
					status: release.status,
				})),
			);
		}

		const snapshotRows = Object.entries(state.releaseSnapshots).map(([releaseId, snapshot]) => ({
			createdAt: new Date(
				state.releases.find((release) => release.releaseId === releaseId)?.publishedAt ??
					DINING_SOURCE.updatedAt,
			),
			payloadJson: toJsonRecord(snapshot),
			releaseId,
			snapshotId: `snapshot:${releaseId}`,
		}));
		if (snapshotRows.length > 0) {
			await tx.insert(diningReleaseSnapshots).values(snapshotRows);
		}

		if (state.auditEvents.length > 0) {
			await tx.insert(diningAuditEvents).values(
				state.auditEvents.map((event) => ({
					action: event.action,
					actorDisplayName: event.actorDisplayName,
					actorPrincipalId: event.actorPrincipalId,
					afterJson: event.after,
					auditEventId: event.auditEventId,
					beforeJson: event.before,
					objectId: event.objectId,
					objectKind: event.objectKind,
					occurredAt: new Date(event.occurredAt),
				})),
			);
		}
	});
}

function parseSnapshotPayload(value: Record<string, unknown>): DiningPublishedSnapshot {
	return value as unknown as DiningPublishedSnapshot;
}

function toJsonRecord(value: unknown): Record<string, unknown> {
	return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function toIsoString(value: Date): string {
	return value.toISOString();
}

function toRelease(row: typeof diningReleases.$inferSelect): DiningRelease {
	return {
		createdAt: toIsoString(row.createdAt),
		createdBy: row.createdBy,
		notes: row.notes,
		publishedAt: row.publishedAt ? toIsoString(row.publishedAt) : null,
		publishedBy: row.publishedBy,
		releaseId: row.releaseId,
		status: row.status as DiningReleaseStatus,
	};
}

function toWindow(row: typeof diningWindows.$inferSelect): DiningWindow {
	return {
		floorId: row.floorId,
		geometry: row.geometryJson as DiningWindow["geometry"],
		hallId: row.hallId,
		label: row.label,
		locationLabel: row.locationLabel,
		status: row.status as DiningWindowStatus,
		tags: row.tagsJson,
		windowId: row.windowId,
	};
}

function toStallProfile(row: typeof diningStallProfiles.$inferSelect): DiningStallProfile {
	return {
		displayName: row.displayName,
		stallProfileId: row.stallProfileId,
		stallType: row.stallType,
		status: row.status as "active",
		tags: row.tagsJson,
	};
}

function toAssignment(row: typeof diningWindowAssignments.$inferSelect): DiningWindowAssignment {
	return {
		assignmentId: row.assignmentId,
		stallProfileId: row.stallProfileId,
		status: row.status as "active",
		windowId: row.windowId,
	};
}

function toMenuItem(row: typeof diningMenuItems.$inferSelect): DiningMenuItem {
	return {
		menuItemId: row.menuItemId,
		name: row.name,
		status: row.status as "active",
		tags: row.tagsJson,
	};
}

function toMenuOffering(row: typeof diningMenuOfferings.$inferSelect): DiningMenuOffering {
	return {
		assignmentId: row.assignmentId,
		menuItemId: row.menuItemId,
		offeringId: row.offeringId,
		priceLabel: row.priceLabel,
		saleStatus: row.saleStatus as DiningSaleStatus,
		specLabel: row.specLabel,
	};
}

function toAuditEvent(row: typeof diningAuditEvents.$inferSelect): DiningAuditEvent {
	return {
		action: row.action,
		actorDisplayName: row.actorDisplayName,
		actorPrincipalId: row.actorPrincipalId,
		after: row.afterJson,
		auditEventId: row.auditEventId,
		before: row.beforeJson,
		objectId: row.objectId,
		objectKind: row.objectKind,
		occurredAt: toIsoString(row.occurredAt),
	};
}
