import { desc, eq } from "drizzle-orm";

import type { Env } from "../../config";
import {
	createRuntimeDbGetter,
	type RuntimeDatabase,
	type RuntimeDbGetter,
} from "../../db/runtime";
import {
	diningAuditEvents,
	diningDraftVersions,
	diningFloors,
	diningHalls,
	diningMenuItems,
	diningMenuOfferings,
	diningReleaseCandidates,
	diningReleaseCandidateValidationReports,
	diningReleaseLatestPointer,
	diningReleaseScheduleJobs,
	diningReleaseSnapshots,
	diningReleases,
	diningStallProfiles,
	diningWindowAssignments,
	diningWindows,
} from "../../db/schema";
import { AppApiRouteError } from "../../http";
import { DINING_SOURCE } from "./initial-data";
import { createInitialDiningOperationsState } from "./initial-state";
import type {
	DiningDraftVersion,
	DiningFloorplanRef,
	DiningReleaseCandidate,
	DiningReleaseCandidateStatus,
	DiningReleaseCandidateValidationReport,
	DiningReleaseLatestPointer,
	DiningReleaseScheduleJob,
	DiningReleaseValidationIssue,
	DiningReleaseValidationStatus,
} from "./release-types";
import type {
	DiningAuditEvent,
	DiningMenuItem,
	DiningMenuOffering,
	DiningOperationsState,
	DiningOperationsStore,
	DiningOpsHall,
	DiningPublishedSnapshot,
	DiningRelease,
	DiningReleaseStatus,
	DiningSaleStatus,
	DiningStallProfile,
	DiningWindow,
	DiningWindowAssignment,
	DiningWindowStatus,
} from "./types";

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
	const state = createInitialDiningOperationsState();
	await saveDiningOperationsState(input.db, state);
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
		draftVersionRows,
		candidateRows,
		validationReportRows,
		scheduleJobRows,
		releaseRows,
		snapshotRows,
		latestPointerRows,
		auditRows,
	] = await Promise.all([
		db.select().from(diningHalls),
		db.select().from(diningFloors),
		db.select().from(diningWindows),
		db.select().from(diningStallProfiles),
		db.select().from(diningWindowAssignments),
		db.select().from(diningMenuItems),
		db.select().from(diningMenuOfferings),
		db.select().from(diningDraftVersions).orderBy(desc(diningDraftVersions.versionNumber)),
		db.select().from(diningReleaseCandidates).orderBy(desc(diningReleaseCandidates.createdAt)),
		db.select().from(diningReleaseCandidateValidationReports),
		db.select().from(diningReleaseScheduleJobs),
		db.select().from(diningReleases).orderBy(desc(diningReleases.createdAt)),
		db.select().from(diningReleaseSnapshots),
		db.select().from(diningReleaseLatestPointer),
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
	const releaseLatestPointer = latestPointerRows[0] ? toLatestPointer(latestPointerRows[0]) : null;
	const publishedRelease = releaseLatestPointer
		? (releases.find((release) => release.releaseId === releaseLatestPointer.releaseId) ?? null)
		: (releases.find((release) => release.status === "published" && release.publishedAt) ?? null);
	const publishedSnapshot = publishedRelease
		? (releaseSnapshots[publishedRelease.releaseId] ?? null)
		: null;
	const candidateSnapshots = Object.fromEntries(
		candidateRows.map((row) => [row.candidateId, parseSnapshotPayload(row.snapshotPayloadJson)]),
	);
	const draftVersions = draftVersionRows
		.map(toDraftVersion)
		.sort((left, right) => left.versionNumber - right.versionNumber);
	const currentDraftVersion = draftVersions.at(-1);
	if (!currentDraftVersion) {
		throwInvalidState("Persisted dining operations state is missing draft version truth.", {
			reason: "missing_draft_version",
		});
	}
	if (releaseLatestPointer && !publishedRelease) {
		throwInvalidState("Persisted dining latest pointer references a missing release.", {
			reason: "missing_latest_release",
			releaseId: releaseLatestPointer.releaseId,
		});
	}
	if (publishedRelease && !publishedSnapshot) {
		throwInvalidState("Persisted dining published release is missing snapshot payload.", {
			reason: "missing_published_snapshot",
			releaseId: publishedRelease.releaseId,
		});
	}

	return {
		auditEvents: auditRows.map(toAuditEvent),
		assignments: assignmentRows.map(toAssignment),
		candidateSnapshots,
		currentDraftVersion,
		draftVersions,
		halls: hallRows.map(
			(row): DiningOpsHall => ({
				campus: row.campus,
				floors: [...(floorsByHall.get(row.hallId) ?? [])]
					.sort((left, right) => left.sortKey.localeCompare(right.sortKey))
					.map((floor) => ({
						floorId: floor.floorId,
						floorplanId: floor.floorplanId,
						floorplanSha256: floor.floorplanSha256,
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
		releaseCandidateValidationReports: validationReportRows.map(toValidationReport),
		releaseCandidates: candidateRows.map(toReleaseCandidate),
		releaseLatestPointer,
		releaseScheduleJobs: scheduleJobRows.map(toScheduleJob),
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
	assertPersistableDiningOperationsState(state);
	const now = new Date();
	await db.transaction(async (tx) => {
		await tx.delete(diningAuditEvents);
		await tx.delete(diningReleaseLatestPointer);
		await tx.delete(diningReleaseSnapshots);
		await tx.delete(diningReleases);
		await tx.delete(diningReleaseScheduleJobs);
		await tx.delete(diningReleaseCandidateValidationReports);
		await tx.delete(diningReleaseCandidates);
		await tx.delete(diningDraftVersions);
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
				floorplanId: floor.floorplanId,
				floorplanSha256: floor.floorplanSha256,
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
					svgAnchorId: window.svgAnchorId,
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

		if (state.draftVersions.length > 0) {
			await tx.insert(diningDraftVersions).values(
				state.draftVersions.map((version) => ({
					createdAt: new Date(version.createdAt),
					createdBy: version.createdBy,
					draftVersionId: version.draftVersionId,
					summaryJson: version.summary,
					versionNumber: version.versionNumber,
				})),
			);
		}

		if (state.releaseCandidates.length > 0) {
			await tx.insert(diningReleaseCandidates).values(
				state.releaseCandidates.map((candidate) => {
					const snapshot = requireCandidateSnapshotForPersistence(state, candidate.candidateId);
					return {
						approvedAt: candidate.approvedAt ? new Date(candidate.approvedAt) : null,
						approvedBy: candidate.approvedBy,
						baseDraftVersionId: candidate.baseDraftVersionId,
						cancelledAt: candidate.cancelledAt ? new Date(candidate.cancelledAt) : null,
						cancelledBy: candidate.cancelledBy,
						candidateId: candidate.candidateId,
						createdAt: new Date(candidate.createdAt),
						createdBy: candidate.createdBy,
						expectedPredecessorReleaseId: candidate.expectedPredecessorReleaseId,
						floorplanRefsJson: candidate.floorplanRefs.map(toJsonRecord),
						notes: candidate.notes,
						publishedReleaseId: candidate.publishedReleaseId,
						publishMode: candidate.publishMode,
						scheduledAt: candidate.scheduledAt ? new Date(candidate.scheduledAt) : null,
						snapshotHash: candidate.snapshotHash,
						snapshotPayloadJson: toJsonRecord(snapshot),
						status: candidate.status,
					};
				}),
			);
		}

		if (state.releaseCandidateValidationReports.length > 0) {
			await tx.insert(diningReleaseCandidateValidationReports).values(
				state.releaseCandidateValidationReports.map((report) => ({
					blockersJson: report.blockers.map(toJsonRecord),
					candidateId: report.candidateId,
					createdAt: new Date(report.createdAt),
					status: report.status,
					summaryJson: report.summary,
					validationReportId: report.validationReportId,
					warningsJson: report.warnings.map(toJsonRecord),
				})),
			);
		}

		if (state.releaseScheduleJobs.length > 0) {
			await tx.insert(diningReleaseScheduleJobs).values(
				state.releaseScheduleJobs.map((job) => ({
					attemptCount: job.attemptCount,
					candidateId: job.candidateId,
					createdAt: new Date(job.createdAt),
					createdBy: job.createdBy,
					executedAt: job.executedAt ? new Date(job.executedAt) : null,
					lastErrorCode: job.lastErrorCode,
					lastErrorMessage: job.lastErrorMessage,
					scheduleJobId: job.scheduleJobId,
					scheduledAt: new Date(job.scheduledAt),
					status: job.status,
				})),
			);
		}

		if (state.releases.length > 0) {
			await tx.insert(diningReleases).values(
				state.releases.map((release) => ({
					candidateId: release.candidateId,
					createdAt: new Date(release.createdAt),
					createdBy: release.createdBy,
					notes: release.notes,
					predecessorReleaseId: release.predecessorReleaseId,
					published: release.status === "published",
					publishedAt: release.publishedAt ? new Date(release.publishedAt) : null,
					publishedBy: release.publishedBy,
					releaseId: release.releaseId,
					snapshotHash: release.snapshotHash,
					status: release.status,
				})),
			);
		}

		const snapshotRows = Object.entries(state.releaseSnapshots).map(([releaseId, snapshot]) => {
			const release = requireReleaseForSnapshotPersistence(state, releaseId);
			return {
				createdAt: new Date(release.publishedAt ?? DINING_SOURCE.updatedAt),
				payloadJson: toJsonRecord(snapshot),
				releaseId,
				snapshotHash: release.snapshotHash,
				snapshotId: `snapshot:${releaseId}`,
				svgObjectRefsJson:
					state.releaseCandidates
						.find((candidate) => candidate.publishedReleaseId === releaseId)
						?.floorplanRefs.map(toJsonRecord) ?? [],
			};
		});
		if (snapshotRows.length > 0) {
			await tx.insert(diningReleaseSnapshots).values(snapshotRows);
		}

		if (state.releaseLatestPointer) {
			await tx.insert(diningReleaseLatestPointer).values({
				releaseId: state.releaseLatestPointer.releaseId,
				scope: state.releaseLatestPointer.scope,
				snapshotId: state.releaseLatestPointer.snapshotId,
				updatedAt: new Date(state.releaseLatestPointer.updatedAt),
				updatedBy: state.releaseLatestPointer.updatedBy,
			});
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
		candidateId: row.candidateId,
		createdAt: toIsoString(row.createdAt),
		createdBy: row.createdBy,
		notes: row.notes,
		predecessorReleaseId: row.predecessorReleaseId,
		publishedAt: row.publishedAt ? toIsoString(row.publishedAt) : null,
		publishedBy: row.publishedBy,
		releaseId: row.releaseId,
		snapshotHash: row.snapshotHash,
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
		svgAnchorId: row.svgAnchorId,
		tags: row.tagsJson,
		windowId: row.windowId,
	};
}

function toDraftVersion(row: typeof diningDraftVersions.$inferSelect): DiningDraftVersion {
	return {
		createdAt: toIsoString(row.createdAt),
		createdBy: row.createdBy,
		draftVersionId: row.draftVersionId,
		summary: row.summaryJson,
		versionNumber: row.versionNumber,
	};
}

function toReleaseCandidate(
	row: typeof diningReleaseCandidates.$inferSelect,
): DiningReleaseCandidate {
	return {
		approvedAt: row.approvedAt ? toIsoString(row.approvedAt) : null,
		approvedBy: row.approvedBy,
		baseDraftVersionId: row.baseDraftVersionId,
		cancelledAt: row.cancelledAt ? toIsoString(row.cancelledAt) : null,
		cancelledBy: row.cancelledBy,
		candidateId: row.candidateId,
		createdAt: toIsoString(row.createdAt),
		createdBy: row.createdBy,
		expectedPredecessorReleaseId: row.expectedPredecessorReleaseId,
		floorplanRefs: row.floorplanRefsJson as unknown as DiningFloorplanRef[],
		notes: row.notes,
		publishedReleaseId: row.publishedReleaseId,
		publishMode: row.publishMode as DiningReleaseCandidate["publishMode"],
		scheduledAt: row.scheduledAt ? toIsoString(row.scheduledAt) : null,
		snapshotHash: row.snapshotHash,
		status: row.status as DiningReleaseCandidateStatus,
	};
}

function toValidationReport(
	row: typeof diningReleaseCandidateValidationReports.$inferSelect,
): DiningReleaseCandidateValidationReport {
	return {
		blockers: row.blockersJson as unknown as DiningReleaseValidationIssue[],
		candidateId: row.candidateId,
		createdAt: toIsoString(row.createdAt),
		status: row.status as DiningReleaseValidationStatus,
		summary: row.summaryJson,
		validationReportId: row.validationReportId,
		warnings: row.warningsJson as unknown as DiningReleaseValidationIssue[],
	};
}

function toScheduleJob(
	row: typeof diningReleaseScheduleJobs.$inferSelect,
): DiningReleaseScheduleJob {
	return {
		attemptCount: row.attemptCount,
		candidateId: row.candidateId,
		createdAt: toIsoString(row.createdAt),
		createdBy: row.createdBy,
		executedAt: row.executedAt ? toIsoString(row.executedAt) : null,
		lastErrorCode: row.lastErrorCode,
		lastErrorMessage: row.lastErrorMessage,
		scheduleJobId: row.scheduleJobId,
		scheduledAt: toIsoString(row.scheduledAt),
		status: row.status as DiningReleaseScheduleJob["status"],
	};
}

function toLatestPointer(
	row: typeof diningReleaseLatestPointer.$inferSelect,
): DiningReleaseLatestPointer {
	return {
		releaseId: row.releaseId,
		scope: row.scope as "global",
		snapshotId: row.snapshotId,
		updatedAt: toIsoString(row.updatedAt),
		updatedBy: row.updatedBy,
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

function assertPersistableDiningOperationsState(state: DiningOperationsState): void {
	if (!state.currentDraftVersion) {
		throwInvalidState("Dining operations state is missing current draft version.", {
			reason: "missing_current_draft_version",
		});
	}
	if (
		!state.draftVersions.some(
			(version) => version.draftVersionId === state.currentDraftVersion.draftVersionId,
		)
	) {
		throwInvalidState("Dining operations current draft version is not recorded.", {
			draftVersionId: state.currentDraftVersion.draftVersionId,
			reason: "current_draft_version_not_recorded",
		});
	}
	for (const candidate of state.releaseCandidates) {
		requireCandidateSnapshotForPersistence(state, candidate.candidateId);
	}
	for (const releaseId of Object.keys(state.releaseSnapshots)) {
		requireReleaseForSnapshotPersistence(state, releaseId);
	}
	if (state.publishedRelease) {
		requireReleaseSnapshotForPersistence(state, state.publishedRelease.releaseId);
	}
	if (state.releaseLatestPointer) {
		requireReleaseForSnapshotPersistence(state, state.releaseLatestPointer.releaseId);
		requireReleaseSnapshotForPersistence(state, state.releaseLatestPointer.releaseId);
	}
}

function requireCandidateSnapshotForPersistence(
	state: DiningOperationsState,
	candidateId: string,
): DiningPublishedSnapshot {
	const snapshot = state.candidateSnapshots[candidateId];
	if (!snapshot) {
		throwInvalidState("Dining release candidate is missing frozen snapshot payload.", {
			candidateId,
			reason: "missing_candidate_snapshot",
		});
	}
	return snapshot;
}

function requireReleaseSnapshotForPersistence(
	state: DiningOperationsState,
	releaseId: string,
): DiningPublishedSnapshot {
	const snapshot = state.releaseSnapshots[releaseId];
	if (!snapshot) {
		throwInvalidState("Dining release is missing snapshot payload.", {
			reason: "missing_release_snapshot",
			releaseId,
		});
	}
	return snapshot;
}

function requireReleaseForSnapshotPersistence(
	state: DiningOperationsState,
	releaseId: string,
): DiningRelease {
	const release = state.releases.find((item) => item.releaseId === releaseId);
	if (!release) {
		throwInvalidState("Dining release snapshot is missing release metadata.", {
			reason: "missing_release_for_snapshot",
			releaseId,
		});
	}
	if (!release.snapshotHash) {
		throwInvalidState("Dining release metadata is missing snapshot hash.", {
			reason: "missing_release_snapshot_hash",
			releaseId,
		});
	}
	return release;
}

function throwInvalidState(message: string, details: Record<string, unknown>): never {
	throw new AppApiRouteError({
		code: "dining_operations_state_invalid",
		details,
		message,
		retryable: false,
		status: 500,
	});
}
