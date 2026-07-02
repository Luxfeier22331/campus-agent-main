import type { DiningOperationsState, DiningPublishedSnapshot, DiningRelease } from "dining-domain";
import { Client } from "pg";

export interface DiningCatalogPgClient {
	connect(): Promise<unknown>;
	end(): Promise<unknown>;
	query(sql: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export type DiningCatalogPgClientFactory = () => DiningCatalogPgClient;

export class PostgresDiningCatalogPublisher {
	private readonly createClient: DiningCatalogPgClientFactory;

	constructor(input: { databaseUrl: string } | { createClient: DiningCatalogPgClientFactory }) {
		this.createClient =
			"createClient" in input
				? input.createClient
				: () => new Client({ connectionString: input.databaseUrl });
	}

	async refreshCatalog(state: DiningOperationsState): Promise<void> {
		const client = this.createClient();
		await client.connect();
		try {
			await replaceCatalog(client, state);
		} finally {
			await client.end();
		}
	}

	async publishCatalog(state: DiningOperationsState): Promise<void> {
		await this.refreshCatalog(state);
	}
}

async function replaceCatalog(
	client: DiningCatalogPgClient,
	state: DiningOperationsState,
): Promise<void> {
	assertPersistableCatalogState(state);
	const now = new Date();
	await client.query("BEGIN");
	try {
		for (const table of [
			"audit_events",
			"release_latest_pointer",
			"release_snapshots",
			"releases",
			"release_schedule_jobs",
			"release_candidate_validation_reports",
			"release_candidates",
			"draft_versions",
			"menu_offerings",
			"menu_items",
			"window_assignments",
			"stall_profiles",
			"windows",
			"floors",
			"halls",
		]) {
			await client.query(`DELETE FROM "dining"."${table}"`);
		}

		for (const hall of state.halls) {
			await client.query(
				`INSERT INTO "dining"."halls" (
					"hall_id", "campus", "name", "status", "created_at", "updated_at"
				) VALUES ($1, $2, $3, $4, $5, $6)`,
				[hall.hallId, hall.campus, hall.name, hall.status, now, now],
			);
			for (const [index, floor] of hall.floors.entries()) {
				await client.query(
					`INSERT INTO "dining"."floors" (
						"floor_id", "hall_id", "label", "floorplan_id", "floorplan_sha256",
						"svg_asset_url", "sort_key", "created_at", "updated_at"
					) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
					[
						floor.floorId,
						hall.hallId,
						floor.label,
						floor.floorplanId,
						floor.floorplanSha256,
						floor.svgAssetUrl,
						String(index).padStart(4, "0"),
						now,
						now,
					],
				);
			}
		}

		for (const window of state.windows) {
			await client.query(
				`INSERT INTO "dining"."windows" (
					"window_id", "hall_id", "floor_id", "label", "location_label", "svg_anchor_id",
					"geometry_json", "tags_json", "status", "created_at", "updated_at"
				) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
				[
					window.windowId,
					window.hallId,
					window.floorId,
					window.label,
					window.locationLabel,
					window.svgAnchorId,
					JSON.stringify(window.geometry),
					JSON.stringify(window.tags),
					window.status,
					now,
					now,
				],
			);
		}

		for (const profile of state.stallProfiles) {
			await client.query(
				`INSERT INTO "dining"."stall_profiles" (
					"stall_profile_id", "display_name", "stall_type", "tags_json", "status",
					"created_at", "updated_at"
				) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
				[
					profile.stallProfileId,
					profile.displayName,
					profile.stallType,
					JSON.stringify(profile.tags),
					profile.status,
					now,
					now,
				],
			);
		}

		for (const assignment of state.assignments) {
			await client.query(
				`INSERT INTO "dining"."window_assignments" (
					"assignment_id", "window_id", "stall_profile_id", "status", "effective_from",
					"effective_to", "created_at", "updated_at"
				) VALUES ($1, $2, $3, $4, NULL, NULL, $5, $6)`,
				[
					assignment.assignmentId,
					assignment.windowId,
					assignment.stallProfileId,
					assignment.status,
					now,
					now,
				],
			);
		}

		for (const item of state.menuItems) {
			await client.query(
				`INSERT INTO "dining"."menu_items" (
					"menu_item_id", "name", "tags_json", "status", "created_at", "updated_at"
				) VALUES ($1, $2, $3, $4, $5, $6)`,
				[item.menuItemId, item.name, JSON.stringify(item.tags), item.status, now, now],
			);
		}

		for (const offering of state.menuOfferings) {
			await client.query(
				`INSERT INTO "dining"."menu_offerings" (
					"offering_id", "assignment_id", "menu_item_id", "price_label", "created_at",
					"updated_at"
				) VALUES ($1, $2, $3, $4, $5, $6)`,
				[
					offering.offeringId,
					offering.assignmentId,
					offering.menuItemId,
					offering.priceLabel,
					now,
					now,
				],
			);
		}

		for (const version of state.draftVersions) {
			await client.query(
				`INSERT INTO "dining"."draft_versions" (
					"draft_version_id", "version_number", "summary_json", "created_at", "created_by"
				) VALUES ($1, $2, $3, $4, $5)`,
				[
					version.draftVersionId,
					version.versionNumber,
					JSON.stringify(version.summary),
					new Date(version.createdAt),
					version.createdBy,
				],
			);
		}

		for (const candidate of state.releaseCandidates) {
			const snapshot = requireCandidateSnapshot(state, candidate.candidateId);
			await client.query(
				`INSERT INTO "dining"."release_candidates" (
					"candidate_id", "base_draft_version_id", "status", "notes", "publish_mode",
					"scheduled_at", "expected_predecessor_release_id", "snapshot_hash",
					"floorplan_refs_json", "snapshot_payload_json", "created_at", "created_by",
					"approved_at", "approved_by", "cancelled_at", "cancelled_by",
					"published_release_id"
				) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
				[
					candidate.candidateId,
					candidate.baseDraftVersionId,
					candidate.status,
					candidate.notes,
					candidate.publishMode,
					candidate.scheduledAt ? new Date(candidate.scheduledAt) : null,
					candidate.expectedPredecessorReleaseId,
					candidate.snapshotHash,
					JSON.stringify(candidate.floorplanRefs),
					JSON.stringify(snapshot),
					new Date(candidate.createdAt),
					candidate.createdBy,
					candidate.approvedAt ? new Date(candidate.approvedAt) : null,
					candidate.approvedBy,
					candidate.cancelledAt ? new Date(candidate.cancelledAt) : null,
					candidate.cancelledBy,
					candidate.publishedReleaseId,
				],
			);
		}

		for (const report of state.releaseCandidateValidationReports) {
			await client.query(
				`INSERT INTO "dining"."release_candidate_validation_reports" (
					"validation_report_id", "candidate_id", "status", "blockers_json",
					"warnings_json", "summary_json", "created_at"
				) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
				[
					report.validationReportId,
					report.candidateId,
					report.status,
					JSON.stringify(report.blockers),
					JSON.stringify(report.warnings),
					JSON.stringify(report.summary),
					new Date(report.createdAt),
				],
			);
		}

		for (const job of state.releaseScheduleJobs) {
			await client.query(
				`INSERT INTO "dining"."release_schedule_jobs" (
					"schedule_job_id", "candidate_id", "scheduled_at", "status", "attempt_count",
					"last_error_code", "last_error_message", "created_at", "created_by", "executed_at"
				) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
				[
					job.scheduleJobId,
					job.candidateId,
					new Date(job.scheduledAt),
					job.status,
					job.attemptCount,
					job.lastErrorCode,
					job.lastErrorMessage,
					new Date(job.createdAt),
					job.createdBy,
					job.executedAt ? new Date(job.executedAt) : null,
				],
			);
		}

		for (const release of state.releases) {
			await client.query(
				`INSERT INTO "dining"."releases" (
					"release_id", "candidate_id", "notes", "status", "published", "published_at",
					"published_by", "predecessor_release_id", "snapshot_hash", "created_at",
					"created_by"
				) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
				[
					release.releaseId,
					release.candidateId,
					release.notes,
					release.status,
					release.status === "published",
					release.publishedAt ? new Date(release.publishedAt) : null,
					release.publishedBy,
					release.predecessorReleaseId,
					release.snapshotHash,
					new Date(release.createdAt),
					release.createdBy,
				],
			);
		}

		for (const [releaseId, snapshot] of Object.entries(state.releaseSnapshots)) {
			const release = requireReleaseForSnapshot(state, releaseId);
			await client.query(
				`INSERT INTO "dining"."release_snapshots" (
					"snapshot_id", "release_id", "payload_json", "svg_object_refs_json",
					"snapshot_hash", "created_at"
				) VALUES ($1, $2, $3, $4, $5, $6)`,
				[
					`snapshot:${releaseId}`,
					releaseId,
					JSON.stringify(snapshot),
					JSON.stringify(
						state.releaseCandidates.find((candidate) => candidate.publishedReleaseId === releaseId)
							?.floorplanRefs ?? [],
					),
					release.snapshotHash,
					new Date(release.publishedAt ?? release.createdAt),
				],
			);
		}

		if (state.releaseLatestPointer) {
			await client.query(
				`INSERT INTO "dining"."release_latest_pointer" (
					"scope", "release_id", "snapshot_id", "updated_at", "updated_by"
				) VALUES ($1, $2, $3, $4, $5)`,
				[
					state.releaseLatestPointer.scope,
					state.releaseLatestPointer.releaseId,
					state.releaseLatestPointer.snapshotId,
					new Date(state.releaseLatestPointer.updatedAt),
					state.releaseLatestPointer.updatedBy,
				],
			);
		}

		for (const event of state.auditEvents) {
			await client.query(
				`INSERT INTO "dining"."audit_events" (
					"audit_event_id", "action", "actor_display_name", "actor_principal_id",
					"object_id", "object_kind", "after_json", "before_json", "occurred_at"
				) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
				[
					event.auditEventId,
					event.action,
					event.actorDisplayName,
					event.actorPrincipalId,
					event.objectId,
					event.objectKind,
					event.after ? JSON.stringify(event.after) : null,
					event.before ? JSON.stringify(event.before) : null,
					new Date(event.occurredAt),
				],
			);
		}

		await client.query("COMMIT");
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	}
}

function assertPersistableCatalogState(state: DiningOperationsState): void {
	if (!state.currentDraftVersion) {
		throw new Error("Dining catalog state is missing current draft version.");
	}
	if (
		!state.draftVersions.some(
			(version) => version.draftVersionId === state.currentDraftVersion.draftVersionId,
		)
	) {
		throw new Error("Dining catalog state current draft version is not recorded.");
	}
	if (state.publishedRelease) {
		requireReleaseSnapshot(state, state.publishedRelease.releaseId);
	}
	if (state.releaseLatestPointer) {
		requireReleaseForSnapshot(state, state.releaseLatestPointer.releaseId);
		requireReleaseSnapshot(state, state.releaseLatestPointer.releaseId);
	}
}

function requireCandidateSnapshot(
	state: DiningOperationsState,
	candidateId: string,
): DiningPublishedSnapshot {
	const snapshot = state.candidateSnapshots[candidateId];
	if (!snapshot) {
		throw new Error(`Dining release candidate ${candidateId} is missing snapshot payload.`);
	}
	return snapshot;
}

function requireReleaseSnapshot(
	state: DiningOperationsState,
	releaseId: string,
): DiningPublishedSnapshot {
	const snapshot = state.releaseSnapshots[releaseId];
	if (!snapshot) {
		throw new Error(`Dining release ${releaseId} is missing snapshot payload.`);
	}
	return snapshot;
}

function requireReleaseForSnapshot(
	state: DiningOperationsState,
	releaseId: string,
): DiningRelease {
	const release = state.releases.find((item) => item.releaseId === releaseId);
	if (!release) {
		throw new Error(`Dining release snapshot ${releaseId} is missing release metadata.`);
	}
	return release;
}
