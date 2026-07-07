import { desc, eq, inArray } from "drizzle-orm";

import type { Env } from "../../config";
import { type createRuntimeDatabase, createRuntimeDbGetter } from "../../db/runtime";
import {
	campusServicesOpsAuditEvents,
	campusServicesOpsReleases,
	campusServicesOpsSourceAttestations,
	campusServicesOpsTransportOverrides,
} from "../../db/schema";
import type {
	CampusServicesOpsActor,
	CampusServicesOpsAuditEvent,
	CampusServicesOpsCurrentEffectiveSnapshot,
	CampusServicesOpsRelease,
	CampusServicesOpsSourceAttestation,
	CampusServicesOpsTransportOverride,
} from "./types";

type RuntimeDbGetter = () => ReturnType<typeof createRuntimeDatabase>;

export interface CampusServicesOpsStore {
	attestationIdsExist(attestationIds: string[]): Promise<boolean>;
	createAttestation(input: {
		attestation: CampusServicesOpsSourceAttestation;
		auditEvent: CampusServicesOpsAuditEvent;
	}): Promise<void>;
	createTransportOverride(input: {
		auditEvent: CampusServicesOpsAuditEvent;
		override: CampusServicesOpsTransportOverride;
	}): Promise<void>;
	getLatestRelease(): Promise<CampusServicesOpsRelease | null>;
	getTransportOverride(overrideId: string): Promise<CampusServicesOpsTransportOverride | null>;
	listAttestations(): Promise<CampusServicesOpsSourceAttestation[]>;
	listAuditEvents(): Promise<CampusServicesOpsAuditEvent[]>;
	listReleases(): Promise<CampusServicesOpsRelease[]>;
	listTransportOverrides(): Promise<CampusServicesOpsTransportOverride[]>;
	publishRelease(input: {
		auditEvent: CampusServicesOpsAuditEvent;
		release: CampusServicesOpsRelease;
	}): Promise<void>;
	updateTransportOverride(input: {
		auditEvent: CampusServicesOpsAuditEvent;
		override: CampusServicesOpsTransportOverride;
	}): Promise<void>;
}

function clone<T>(value: T): T {
	return structuredClone(value);
}

function toDate(value: string): Date {
	return new Date(value);
}

function actorJson(actor: CampusServicesOpsActor): CampusServicesOpsActor {
	return actor;
}

function toActor(value: CampusServicesOpsActor): CampusServicesOpsActor {
	return {
		displayName: value.displayName,
		principalId: value.principalId,
	};
}

function writeAuditEventRow(auditEvent: CampusServicesOpsAuditEvent) {
	return {
		action: auditEvent.action,
		actorJson: actorJson(auditEvent.actor),
		afterJson: auditEvent.after,
		auditEventId: auditEvent.auditEventId,
		beforeJson: auditEvent.before,
		objectId: auditEvent.objectId,
		objectType: auditEvent.objectType,
		occurredAt: toDate(auditEvent.occurredAt),
		summary: auditEvent.summary,
	};
}

function toAuditEvent(
	row: typeof campusServicesOpsAuditEvents.$inferSelect,
): CampusServicesOpsAuditEvent {
	return {
		action: row.action,
		actor: toActor(row.actorJson),
		after: row.afterJson ?? null,
		auditEventId: row.auditEventId,
		before: row.beforeJson ?? null,
		objectId: row.objectId,
		objectType: row.objectType,
		occurredAt: row.occurredAt.toISOString(),
		summary: row.summary,
	};
}

function toAttestation(
	row: typeof campusServicesOpsSourceAttestations.$inferSelect,
): CampusServicesOpsSourceAttestation {
	return {
		attestationId: row.attestationId,
		confirmedAt: row.confirmedAt.toISOString(),
		createdAt: row.createdAt.toISOString(),
		createdBy: toActor(row.createdByJson),
		operatorNotes: row.operatorNotes ?? null,
		sourceType: row.sourceType as CampusServicesOpsSourceAttestation["sourceType"],
		status: row.status as CampusServicesOpsSourceAttestation["status"],
		summary: row.summary,
	};
}

function writeAttestationRow(attestation: CampusServicesOpsSourceAttestation) {
	return {
		attestationId: attestation.attestationId,
		confirmedAt: toDate(attestation.confirmedAt),
		createdAt: toDate(attestation.createdAt),
		createdByJson: actorJson(attestation.createdBy),
		operatorNotes: attestation.operatorNotes,
		sourceType: attestation.sourceType,
		status: attestation.status,
		summary: attestation.summary,
	};
}

function toTransportOverride(
	row: typeof campusServicesOpsTransportOverrides.$inferSelect,
): CampusServicesOpsTransportOverride {
	return {
		createdAt: row.createdAt.toISOString(),
		createdBy: toActor(row.createdByJson),
		displayName: row.displayName,
		effectiveFrom: row.effectiveFrom.toISOString(),
		effectiveUntil: row.effectiveUntil.toISOString(),
		message: row.message,
		overrideId: row.overrideId,
		reviewState: row.reviewState as CampusServicesOpsTransportOverride["reviewState"],
		routeId: row.routeId,
		serviceStatus: row.serviceStatus as CampusServicesOpsTransportOverride["serviceStatus"],
		sourceAttestationIds: row.sourceAttestationIdsJson,
		updatedAt: row.updatedAt.toISOString(),
		updatedBy: toActor(row.updatedByJson),
	};
}

function writeTransportOverrideRow(override: CampusServicesOpsTransportOverride) {
	return {
		createdAt: toDate(override.createdAt),
		createdByJson: actorJson(override.createdBy),
		displayName: override.displayName,
		effectiveFrom: toDate(override.effectiveFrom),
		effectiveUntil: toDate(override.effectiveUntil),
		message: override.message,
		overrideId: override.overrideId,
		reviewState: override.reviewState,
		routeId: override.routeId,
		serviceStatus: override.serviceStatus,
		sourceAttestationIdsJson: override.sourceAttestationIds,
		updatedAt: toDate(override.updatedAt),
		updatedByJson: actorJson(override.updatedBy),
	};
}

function toRelease(row: typeof campusServicesOpsReleases.$inferSelect): CampusServicesOpsRelease {
	return {
		createdAt: row.createdAt.toISOString(),
		createdBy: toActor(row.createdByJson),
		currentEffective: row.currentEffectiveJson as CampusServicesOpsCurrentEffectiveSnapshot,
		itemCount: row.itemCount,
		notes: row.notes ?? null,
		publishedAt: row.publishedAt.toISOString(),
		publishedBy: toActor(row.publishedByJson),
		releaseId: row.releaseId,
		status: row.status as "published",
	};
}

function writeReleaseRow(release: CampusServicesOpsRelease) {
	return {
		createdAt: toDate(release.createdAt),
		createdByJson: actorJson(release.createdBy),
		currentEffectiveJson: release.currentEffective,
		itemCount: release.itemCount,
		notes: release.notes,
		publishedAt: toDate(release.publishedAt),
		publishedByJson: actorJson(release.publishedBy),
		releaseId: release.releaseId,
		status: release.status,
	};
}

export function createInMemoryCampusServicesOpsStore(): CampusServicesOpsStore {
	const state = {
		attestations: [] as CampusServicesOpsSourceAttestation[],
		auditEvents: [] as CampusServicesOpsAuditEvent[],
		releases: [] as CampusServicesOpsRelease[],
		transportOverrides: [] as CampusServicesOpsTransportOverride[],
	};

	return {
		async attestationIdsExist(attestationIds) {
			const existingIds = new Set(
				state.attestations.map((attestation) => attestation.attestationId),
			);
			return attestationIds.every((attestationId) => existingIds.has(attestationId));
		},
		async createAttestation(input) {
			state.attestations.push(clone(input.attestation));
			state.auditEvents.push(clone(input.auditEvent));
		},
		async createTransportOverride(input) {
			state.transportOverrides.push(clone(input.override));
			state.auditEvents.push(clone(input.auditEvent));
		},
		async getLatestRelease() {
			return clone(state.releases.at(-1) ?? null);
		},
		async getTransportOverride(overrideId) {
			return clone(
				state.transportOverrides.find((override) => override.overrideId === overrideId) ?? null,
			);
		},
		async listAttestations() {
			return clone(state.attestations);
		},
		async listAuditEvents() {
			return clone([...state.auditEvents].reverse());
		},
		async listReleases() {
			return clone([...state.releases].reverse());
		},
		async listTransportOverrides() {
			return clone(state.transportOverrides);
		},
		async publishRelease(input) {
			state.releases.push(clone(input.release));
			state.auditEvents.push(clone(input.auditEvent));
		},
		async updateTransportOverride(input) {
			const index = state.transportOverrides.findIndex(
				(override) => override.overrideId === input.override.overrideId,
			);
			if (index >= 0) {
				state.transportOverrides[index] = clone(input.override);
			}
			state.auditEvents.push(clone(input.auditEvent));
		},
	};
}

export function createPgCampusServicesOpsStore(
	env: Env,
	input: {
		getDb?: RuntimeDbGetter;
	} = {},
): CampusServicesOpsStore {
	const getDb = input.getDb ?? createRuntimeDbGetter(env);

	return {
		async attestationIdsExist(attestationIds) {
			const db = await getDb();
			const rows = await db
				.select({ attestationId: campusServicesOpsSourceAttestations.attestationId })
				.from(campusServicesOpsSourceAttestations)
				.where(inArray(campusServicesOpsSourceAttestations.attestationId, attestationIds));
			return new Set(rows.map((row) => row.attestationId)).size === new Set(attestationIds).size;
		},
		async createAttestation(input) {
			const db = await getDb();
			await db.transaction(async (tx) => {
				await tx
					.insert(campusServicesOpsSourceAttestations)
					.values(writeAttestationRow(input.attestation));
				await tx.insert(campusServicesOpsAuditEvents).values(writeAuditEventRow(input.auditEvent));
			});
		},
		async createTransportOverride(input) {
			const db = await getDb();
			await db.transaction(async (tx) => {
				await tx
					.insert(campusServicesOpsTransportOverrides)
					.values(writeTransportOverrideRow(input.override));
				await tx.insert(campusServicesOpsAuditEvents).values(writeAuditEventRow(input.auditEvent));
			});
		},
		async getLatestRelease() {
			const db = await getDb();
			const rows = await db
				.select()
				.from(campusServicesOpsReleases)
				.orderBy(desc(campusServicesOpsReleases.publishedAt))
				.limit(1);
			return rows[0] ? toRelease(rows[0]) : null;
		},
		async getTransportOverride(overrideId) {
			const db = await getDb();
			const rows = await db
				.select()
				.from(campusServicesOpsTransportOverrides)
				.where(eq(campusServicesOpsTransportOverrides.overrideId, overrideId))
				.limit(1);
			return rows[0] ? toTransportOverride(rows[0]) : null;
		},
		async listAttestations() {
			const db = await getDb();
			const rows = await db
				.select()
				.from(campusServicesOpsSourceAttestations)
				.orderBy(desc(campusServicesOpsSourceAttestations.createdAt));
			return rows.map(toAttestation);
		},
		async listAuditEvents() {
			const db = await getDb();
			const rows = await db
				.select()
				.from(campusServicesOpsAuditEvents)
				.orderBy(desc(campusServicesOpsAuditEvents.occurredAt));
			return rows.map(toAuditEvent);
		},
		async listReleases() {
			const db = await getDb();
			const rows = await db
				.select()
				.from(campusServicesOpsReleases)
				.orderBy(desc(campusServicesOpsReleases.publishedAt));
			return rows.map(toRelease);
		},
		async listTransportOverrides() {
			const db = await getDb();
			const rows = await db
				.select()
				.from(campusServicesOpsTransportOverrides)
				.orderBy(desc(campusServicesOpsTransportOverrides.updatedAt));
			return rows.map(toTransportOverride);
		},
		async publishRelease(input) {
			const db = await getDb();
			await db.transaction(async (tx) => {
				await tx.insert(campusServicesOpsReleases).values(writeReleaseRow(input.release));
				await tx.insert(campusServicesOpsAuditEvents).values(writeAuditEventRow(input.auditEvent));
			});
		},
		async updateTransportOverride(input) {
			const db = await getDb();
			await db.transaction(async (tx) => {
				await tx
					.update(campusServicesOpsTransportOverrides)
					.set(writeTransportOverrideRow(input.override))
					.where(eq(campusServicesOpsTransportOverrides.overrideId, input.override.overrideId));
				await tx.insert(campusServicesOpsAuditEvents).values(writeAuditEventRow(input.auditEvent));
			});
		},
	};
}
