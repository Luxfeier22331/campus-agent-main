import { randomUUID } from "node:crypto";
import type {
	DiningDraft,
	DiningOpsActor,
	DiningPublication,
	DiningPublishedSnapshot,
	DiningRelease,
	DiningReleaseDetail,
	DiningSourceObservation,
} from "@campus-agent/dining/domain";
import {
	assertDiningSnapshotFloorplanCompatibility,
	materializeDiningCatalog,
	parseDiningPublishedSnapshot,
	publicationAfterCatalogPublish,
	publishDiningDraft,
	sha256Tag,
	stableJson,
	validateDiningDraft,
} from "@campus-agent/dining/domain";
import type { PoolClient } from "pg";

import {
	type DiningPool,
	type DiningQuery,
	DiningStoreNotFoundError,
	diningDateIso,
	diningObservationStatus,
	diningRecord,
	diningStringArray,
	diningTargetKind,
	withDiningTransaction,
	writeDiningEvent,
} from "./dining-store-repository.ts";

export type DiningCatalogCommand =
	| { kind: "rename_stall"; stallProfileId: string; displayName: string }
	| { kind: "set_offering_price"; offeringId: string; priceLabel: string | null }
	| {
			kind: "assign_stall";
			windowId: string;
			stallProfileId: string;
			displayName: string;
			tags: string[];
	  }
	| { kind: "remove_assignment"; assignmentId: string };

export interface DiningPublicationStoreMethods {
	applyCatalogCommand(actor: DiningOpsActor, command: DiningCatalogCommand): Promise<DiningDraft>;
	getDraft(): Promise<DiningDraft>;
	getRelease(releaseId: string): Promise<DiningReleaseDetail | null>;
	listReleases(): Promise<DiningRelease[]>;
	publish(actor: DiningOpsActor, notes: string): Promise<DiningReleaseDetail>;
	rebase(actor: DiningOpsActor): Promise<DiningDraft>;
	rollback(actor: DiningOpsActor, releaseId: string, notes: string): Promise<DiningReleaseDetail>;
	validate(): Promise<ReturnType<typeof validateDiningDraft>>;
}

export function createDiningPublicationStore(pool: DiningPool): DiningPublicationStoreMethods {
	return {
		async getDraft() {
			return loadDiningDraft(pool);
		},
		async validate() {
			return validateDiningDraft(await loadDiningDraft(pool));
		},
		async rebase(actor) {
			return withDiningTransaction(pool, async (client) => {
				const current = await loadDiningDraft(client);
				const draft = materializeDiningCatalog({
					actorId: actor.principalId,
					baseReleaseId: current.baseReleaseId,
					currentRevision: current.revision,
					now: new Date().toISOString(),
					observations: await loadCatalogObservations(client),
				});
				for (const override of await loadCatalogOverrides(client)) {
					applyStoredOverride(draft, override);
				}
				await replaceDraft(client, draft);
				await writeDiningEvent(client, actor, "catalog.rebased", "catalog", "global", {
					revision: draft.revision,
				});
				return draft;
			});
		},
		async applyCatalogCommand(actor, command) {
			return withDiningTransaction(pool, async (client) => {
				const draft = await loadDiningDraft(client);
				applyCommand(draft, command);
				draft.revision += 1;
				draft.updatedAt = new Date().toISOString();
				draft.updatedBy = actor.principalId;
				await replaceDraft(client, draft);
				await saveCatalogOverride(client, actor, command);
				await writeDiningEvent(client, actor, `catalog.${command.kind}`, "catalog", "global", {
					revision: draft.revision,
				});
				return draft;
			});
		},
		async publish(actor, notes) {
			return withDiningTransaction(pool, async (client) => {
				const draft = await loadDiningDraft(client);
				const result = publishDiningDraft({
					actor,
					draft,
					notes,
					releaseId: `dining_release:${Date.now().toString(36)}:${randomUUID().slice(0, 8)}`,
				});
				await persistRelease(client, result.release, result.snapshot);
				const publication = publicationAfterCatalogPublish({
					current: await loadDiningPublication(client),
					releaseId: result.release.releaseId,
					updatedAt: result.release.createdAt,
				});
				await savePublication(client, publication);
				await client.query(
					"UPDATE dining.catalog_state SET base_release_id=$1 WHERE scope='global'",
					[result.release.releaseId],
				);
				await retainLatestReleases(client);
				await writeDiningEvent(
					client,
					actor,
					"catalog.published",
					"release",
					result.release.releaseId,
					{
						revision: draft.revision,
					},
				);
				return { release: result.release, snapshot: result.snapshot };
			});
		},
		async listReleases() {
			const result = await pool.query("SELECT * FROM dining.releases ORDER BY created_at DESC");
			return result.rows.map(rowToRelease);
		},
		async getRelease(releaseId) {
			const result = await pool.query("SELECT * FROM dining.releases WHERE release_id=$1", [
				releaseId,
			]);
			return result.rows[0] ? rowToReleaseDetail(result.rows[0]) : null;
		},
		async rollback(actor, releaseId, notes) {
			return withDiningTransaction(pool, async (client) => {
				const target = await client.query("SELECT * FROM dining.releases WHERE release_id=$1", [
					releaseId,
				]);
				if (!target.rows[0]) {
					throw new DiningStoreNotFoundError("release");
				}
				const publication = await loadDiningPublication(client);
				const rollback = buildDiningRollback({
					actor,
					notes,
					predecessorReleaseId: publication.catalogReleaseId,
					target: rowToReleaseDetail(target.rows[0]),
				});
				await persistRelease(client, rollback.release, rollback.snapshot);
				await savePublication(client, {
					...publication,
					catalogReleaseId: rollback.release.releaseId,
					updatedAt: rollback.release.createdAt,
				});
				await client.query(
					"UPDATE dining.catalog_state SET base_release_id=$1 WHERE scope='global'",
					[rollback.release.releaseId],
				);
				await retainLatestReleases(client);
				await writeDiningEvent(
					client,
					actor,
					"catalog.rolled_back",
					"release",
					rollback.release.releaseId,
					{ rollbackOfReleaseId: releaseId },
				);
				return rollback;
			});
		},
	};
}

export async function loadDiningPublication(db: DiningQuery): Promise<DiningPublication> {
	const result = await db.query("SELECT * FROM dining.publication WHERE scope='global'");
	const row = result.rows[0];
	return row
		? {
				catalogReleaseId: row.catalog_release_id ?? null,
				reviewRevision: Number(row.review_revision),
				updatedAt: diningDateIso(row.updated_at),
			}
		: { catalogReleaseId: null, reviewRevision: 0, updatedAt: new Date(0).toISOString() };
}

export async function loadDiningDraft(db: DiningQuery): Promise<DiningDraft> {
	const [state, halls, floors, windows, stalls, assignments, items, offerings] = await Promise.all([
		db.query("SELECT * FROM dining.catalog_state WHERE scope='global'"),
		db.query("SELECT * FROM dining.halls ORDER BY campus,hall_id"),
		db.query("SELECT * FROM dining.floors ORDER BY sort_key,floor_id"),
		db.query("SELECT * FROM dining.windows ORDER BY window_id"),
		db.query("SELECT * FROM dining.stall_profiles ORDER BY stall_profile_id"),
		db.query("SELECT * FROM dining.window_assignments ORDER BY assignment_id"),
		db.query("SELECT * FROM dining.menu_items ORDER BY menu_item_id"),
		db.query("SELECT * FROM dining.menu_offerings ORDER BY offering_id"),
	]);
	const stateRow = state.rows[0];
	if (!stateRow) {
		throw new Error("Dining catalog_state is missing.");
	}
	return {
		assignments: assignments.rows.map((row) => ({
			assignmentId: String(row.assignment_id),
			stallProfileId: String(row.stall_profile_id),
			status: "active" as const,
			windowId: String(row.window_id),
		})),
		baseReleaseId: stateRow.base_release_id ?? null,
		halls: halls.rows.map((hall) => ({
			campus: String(hall.campus),
			floors: floors.rows
				.filter((floor) => floor.hall_id === hall.hall_id)
				.map((floor) => ({
					floorId: String(floor.floor_id),
					floorplan: {
						floorplanId: String(floor.floorplan_id),
						kind: floorplanKind(floor.floorplan_kind),
					},
					label: String(floor.label),
				})),
			hallId: String(hall.hall_id),
			name: String(hall.name),
			status: "active" as const,
		})),
		menuItems: items.rows.map((row) => ({
			menuItemId: String(row.menu_item_id),
			name: String(row.name),
			status: "active" as const,
			tags: diningStringArray(row.tags_json),
		})),
		menuOfferings: offerings.rows.map((row) => ({
			assignmentId: String(row.assignment_id),
			menuItemId: String(row.menu_item_id),
			offeringId: String(row.offering_id),
			priceLabel: row.price_label ?? null,
		})),
		revision: Number(stateRow.draft_revision),
		stallProfiles: stalls.rows.map((row) => ({
			displayName: String(row.display_name),
			stallProfileId: String(row.stall_profile_id),
			stallType: String(row.stall_type),
			status: "active" as const,
			tags: diningStringArray(row.tags_json),
		})),
		updatedAt: diningDateIso(stateRow.updated_at),
		updatedBy: String(stateRow.updated_by),
		windows: windows.rows.map((row) => ({
			floorId: String(row.floor_id),
			hallId: String(row.hall_id),
			label: String(row.label),
			locationLabel: String(row.location_label),
			status: windowStatus(row.status),
			svgAnchorId: row.svg_anchor_id ?? null,
			tags: diningStringArray(row.tags_json),
			windowId: String(row.window_id),
		})),
	};
}

async function savePublication(db: DiningQuery, publication: DiningPublication): Promise<void> {
	await db.query(
		`INSERT INTO dining.publication(scope,catalog_release_id,review_revision,updated_at)
		 VALUES('global',$1,$2,$3) ON CONFLICT(scope) DO UPDATE SET
		 catalog_release_id=EXCLUDED.catalog_release_id,review_revision=EXCLUDED.review_revision,
		 updated_at=EXCLUDED.updated_at`,
		[publication.catalogReleaseId, publication.reviewRevision, new Date(publication.updatedAt)],
	);
}

async function replaceDraft(client: PoolClient, draft: DiningDraft): Promise<void> {
	for (const table of [
		"menu_offerings",
		"menu_items",
		"window_assignments",
		"stall_profiles",
		"windows",
		"floors",
		"halls",
	]) {
		await client.query(`DELETE FROM dining.${table}`);
	}
	const now = new Date(draft.updatedAt);
	for (const hall of draft.halls) {
		await client.query("INSERT INTO dining.halls VALUES($1,$2,$3,$4,$5,$5)", [
			hall.hallId,
			hall.campus,
			hall.name,
			hall.status,
			now,
		]);
		for (const [index, floor] of hall.floors.entries()) {
			await client.query(
				"INSERT INTO dining.floors(floor_id,hall_id,label,floorplan_kind,floorplan_id,sort_key,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7)",
				[
					floor.floorId,
					hall.hallId,
					floor.label,
					floor.floorplan.kind,
					floor.floorplan.floorplanId,
					String(index).padStart(4, "0"),
					now,
				],
			);
		}
	}
	for (const row of draft.windows) {
		await client.query(
			"INSERT INTO dining.windows(window_id,hall_id,floor_id,label,location_label,svg_anchor_id,tags_json,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)",
			[
				row.windowId,
				row.hallId,
				row.floorId,
				row.label,
				row.locationLabel,
				row.svgAnchorId,
				JSON.stringify(row.tags),
				row.status,
				now,
			],
		);
	}
	for (const row of draft.stallProfiles) {
		await client.query("INSERT INTO dining.stall_profiles VALUES($1,$2,$3,$4,$5,$6,$6)", [
			row.stallProfileId,
			row.displayName,
			row.stallType,
			JSON.stringify(row.tags),
			row.status,
			now,
		]);
	}
	for (const row of draft.assignments) {
		await client.query("INSERT INTO dining.window_assignments VALUES($1,$2,$3,$4,$5,$5)", [
			row.assignmentId,
			row.windowId,
			row.stallProfileId,
			row.status,
			now,
		]);
	}
	for (const row of draft.menuItems) {
		await client.query("INSERT INTO dining.menu_items VALUES($1,$2,$3,$4,$5,$5)", [
			row.menuItemId,
			row.name,
			JSON.stringify(row.tags),
			row.status,
			now,
		]);
	}
	for (const row of draft.menuOfferings) {
		await client.query("INSERT INTO dining.menu_offerings VALUES($1,$2,$3,$4,$5,$5)", [
			row.offeringId,
			row.assignmentId,
			row.menuItemId,
			row.priceLabel,
			now,
		]);
	}
	await client.query(
		`INSERT INTO dining.catalog_state(scope,draft_revision,base_release_id,updated_at,updated_by)
		 VALUES('global',$1,$2,$3,$4) ON CONFLICT(scope) DO UPDATE SET
		 draft_revision=EXCLUDED.draft_revision,base_release_id=EXCLUDED.base_release_id,
		 updated_at=EXCLUDED.updated_at,updated_by=EXCLUDED.updated_by`,
		[draft.revision, draft.baseReleaseId, now, draft.updatedBy],
	);
}

async function loadCatalogObservations(db: DiningQuery): Promise<DiningSourceObservation[]> {
	const result = await db.query(
		"SELECT * FROM dining.source_observations WHERE source_type='feishu_catalog' AND stale_at IS NULL ORDER BY target_kind,observation_id",
	);
	return result.rows.map((row) => ({
		observationId: String(row.observation_id),
		observedAt: diningDateIso(row.observed_at),
		payloadJson: diningRecord(row.payload_json),
		sourceType: "feishu_catalog",
		status: diningObservationStatus(row.status),
		targetId: row.target_id ?? null,
		targetKind: diningTargetKind(row.target_kind),
	}));
}

async function persistRelease(
	client: Pick<PoolClient, "query">,
	release: DiningRelease,
	snapshot: DiningPublishedSnapshot,
): Promise<void> {
	await client.query(
		`INSERT INTO dining.releases(release_id,predecessor_release_id,rollback_of_release_id,
		 draft_revision,notes,snapshot_hash,payload_json,validation_json,created_at,created_by)
		 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
		[
			release.releaseId,
			release.predecessorReleaseId,
			release.rollbackOfReleaseId,
			release.draftRevision,
			release.notes,
			release.snapshotHash,
			JSON.stringify(snapshot),
			JSON.stringify(release.validation),
			new Date(release.createdAt),
			release.createdBy,
		],
	);
}

export async function retainLatestReleases(client: DiningQuery): Promise<void> {
	await client.query(`DELETE FROM dining.releases WHERE release_id IN (
		SELECT release_id FROM dining.releases ORDER BY created_at DESC OFFSET 30
	) AND release_id IS DISTINCT FROM (
		SELECT catalog_release_id FROM dining.publication WHERE scope='global'
	)`);
}

function applyCommand(draft: DiningDraft, command: DiningCatalogCommand): void {
	if (command.kind === "rename_stall") {
		const item = draft.stallProfiles.find(
			(value) => value.stallProfileId === command.stallProfileId,
		);
		if (!item) {
			throw new DiningStoreNotFoundError("stall");
		}
		item.displayName = command.displayName;
		return;
	}
	if (command.kind === "set_offering_price") {
		const item = draft.menuOfferings.find((value) => value.offeringId === command.offeringId);
		if (!item) {
			throw new DiningStoreNotFoundError("offering");
		}
		item.priceLabel = command.priceLabel;
		return;
	}
	if (command.kind === "remove_assignment") {
		if (!draft.assignments.some((value) => value.assignmentId === command.assignmentId)) {
			throw new DiningStoreNotFoundError("assignment");
		}
		draft.assignments = draft.assignments.filter(
			(value) => value.assignmentId !== command.assignmentId,
		);
		draft.menuOfferings = draft.menuOfferings.filter(
			(value) => value.assignmentId !== command.assignmentId,
		);
		return;
	}
	if (!draft.windows.some((value) => value.windowId === command.windowId)) {
		throw new DiningStoreNotFoundError("window");
	}
	const replacedAssignments = new Set(
		draft.assignments
			.filter((assignment) => assignment.windowId === command.windowId)
			.map((assignment) => assignment.assignmentId),
	);
	if (!draft.stallProfiles.some((value) => value.stallProfileId === command.stallProfileId)) {
		draft.stallProfiles.push({
			displayName: command.displayName,
			stallProfileId: command.stallProfileId,
			stallType: "food_window",
			status: "active",
			tags: command.tags,
		});
	}
	draft.assignments = draft.assignments.filter((value) => value.windowId !== command.windowId);
	draft.menuOfferings = draft.menuOfferings.filter(
		(value) => !replacedAssignments.has(value.assignmentId),
	);
	draft.assignments.push({
		assignmentId: `assignment:${command.windowId}:${command.stallProfileId}`,
		stallProfileId: command.stallProfileId,
		status: "active",
		windowId: command.windowId,
	});
}

export interface StoredCatalogOverride {
	patch: Record<string, unknown>;
	targetId: string;
	targetKind: string;
}

async function loadCatalogOverrides(db: DiningQuery): Promise<StoredCatalogOverride[]> {
	const result = await db.query(
		"SELECT target_kind,target_id,patch_json FROM dining.catalog_overrides WHERE active ORDER BY created_at",
	);
	return result.rows.map((row) => ({
		patch: diningRecord(row.patch_json),
		targetId: String(row.target_id),
		targetKind: String(row.target_kind),
	}));
}

export function applyStoredOverride(draft: DiningDraft, override: StoredCatalogOverride): void {
	if (override.targetKind === "stall") {
		const stall = draft.stallProfiles.find((item) => item.stallProfileId === override.targetId);
		if (stall && typeof override.patch.displayName === "string") {
			stall.displayName = override.patch.displayName;
		}
		return;
	}
	if (override.targetKind === "offering") {
		const offering = draft.menuOfferings.find((item) => item.offeringId === override.targetId);
		if (
			offering &&
			(typeof override.patch.priceLabel === "string" || override.patch.priceLabel === null)
		) {
			offering.priceLabel = override.patch.priceLabel;
		}
		return;
	}
	if (override.targetKind === "assignment" && override.patch.removed === true) {
		draft.assignments = draft.assignments.filter((item) => item.assignmentId !== override.targetId);
		draft.menuOfferings = draft.menuOfferings.filter(
			(item) => item.assignmentId !== override.targetId,
		);
		return;
	}
	if (override.targetKind === "window" && isAssignPatch(override.patch)) {
		applyCommand(draft, { kind: "assign_stall", ...override.patch });
	}
}

async function saveCatalogOverride(
	client: Pick<PoolClient, "query">,
	actor: DiningOpsActor,
	command: DiningCatalogCommand,
): Promise<void> {
	const targetKind =
		command.kind === "rename_stall"
			? "stall"
			: command.kind === "set_offering_price"
				? "offering"
				: command.kind === "remove_assignment"
					? "assignment"
					: "window";
	const targetId =
		command.kind === "rename_stall"
			? command.stallProfileId
			: command.kind === "set_offering_price"
				? command.offeringId
				: command.kind === "remove_assignment"
					? command.assignmentId
					: command.windowId;
	const value =
		command.kind === "rename_stall"
			? { displayName: command.displayName }
			: command.kind === "set_offering_price"
				? { priceLabel: command.priceLabel }
				: command.kind === "remove_assignment"
					? { removed: true }
					: {
							displayName: command.displayName,
							stallProfileId: command.stallProfileId,
							tags: command.tags,
							windowId: command.windowId,
						};
	await client.query(
		`INSERT INTO dining.catalog_overrides(override_id,target_kind,target_id,patch_json,reason,
		 active,created_at,updated_at,updated_by) VALUES($1,$2,$3,$4,'ops edit',true,now(),now(),$5)
		 ON CONFLICT(override_id) DO UPDATE SET patch_json=EXCLUDED.patch_json,active=true,
		 updated_at=now(),updated_by=EXCLUDED.updated_by`,
		[
			`override:${targetKind}:${targetId}`,
			targetKind,
			targetId,
			JSON.stringify(value),
			actor.principalId,
		],
	);
}

function isAssignPatch(value: Record<string, unknown>): value is {
	displayName: string;
	stallProfileId: string;
	tags: string[];
	windowId: string;
} {
	return (
		typeof value.displayName === "string" &&
		typeof value.stallProfileId === "string" &&
		typeof value.windowId === "string" &&
		Array.isArray(value.tags) &&
		value.tags.every((item) => typeof item === "string")
	);
}

function rowToRelease(row: Record<string, unknown>): DiningRelease {
	return {
		createdAt: diningDateIso(row.created_at),
		createdBy: String(row.created_by),
		draftRevision: Number(row.draft_revision),
		notes: String(row.notes),
		predecessorReleaseId:
			typeof row.predecessor_release_id === "string" ? row.predecessor_release_id : null,
		releaseId: String(row.release_id),
		rollbackOfReleaseId:
			typeof row.rollback_of_release_id === "string" ? row.rollback_of_release_id : null,
		snapshotHash: String(row.snapshot_hash),
		validation: diningRecord(row.validation_json) as never,
	};
}

function rowToReleaseDetail(row: Record<string, unknown>): DiningReleaseDetail {
	const release = rowToRelease(row);
	return {
		release,
		snapshot: parseDiningPublishedSnapshot(row.payload_json, {
			releaseId: release.releaseId,
			snapshotHash: release.snapshotHash,
		}),
	};
}

function windowStatus(value: unknown): DiningDraft["windows"][number]["status"] {
	if (value === "active" || value === "closed" || value === "maintenance") {
		return value;
	}
	throw new Error("Invalid Dining window status.");
}

function floorplanKind(
	value: unknown,
): DiningDraft["halls"][number]["floors"][number]["floorplan"]["kind"] {
	if (value === "asset" || value === "placeholder") {
		return value;
	}
	throw new Error("Invalid Dining floorplan kind.");
}

export function buildDiningRollback(input: {
	actor: DiningOpsActor;
	notes: string;
	now?: string;
	predecessorReleaseId: string | null;
	releaseId?: string;
	target: DiningReleaseDetail;
}): DiningReleaseDetail {
	assertDiningSnapshotFloorplanCompatibility(input.target.snapshot);
	const now = input.now ?? new Date().toISOString();
	const releaseId =
		input.releaseId ?? `dining_release:${Date.parse(now).toString(36)}:${randomUUID().slice(0, 8)}`;
	const snapshot: DiningPublishedSnapshot = {
		...input.target.snapshot,
		source: { ...input.target.snapshot.source, releaseId, updatedAt: now },
	};
	return {
		release: {
			...input.target.release,
			createdAt: now,
			createdBy: input.actor.principalId,
			notes: input.notes,
			predecessorReleaseId: input.predecessorReleaseId,
			releaseId,
			rollbackOfReleaseId: input.target.release.releaseId,
			snapshotHash: sha256Tag(stableJson(snapshot)),
		},
		snapshot,
	};
}
