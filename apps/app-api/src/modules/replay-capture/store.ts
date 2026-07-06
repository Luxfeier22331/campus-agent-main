import { and, eq, type SQL, sql } from "drizzle-orm";

import type { Env } from "../../config";
import {
	type createRuntimeDatabase,
	createRuntimeDbGetter,
	type RuntimeDatabase,
} from "../../db/runtime";
import { replayPacketAccessAudit, replayPacketIndex } from "../../db/schema/replay-capture";
import type {
	ReplayCaptureStore,
	ReplayPacketAccessAuditWrite,
	ReplayPacketIndexRead,
	ReplayPacketIndexWrite,
	ReplayPacketLinkageFilter,
} from "./types";

type RuntimeDbGetter = () => ReturnType<typeof createRuntimeDatabase>;

export function createPgReplayCaptureStore(
	env: Env,
	input: {
		getDb?: RuntimeDbGetter;
	} = {},
): ReplayCaptureStore {
	const getDb = input.getDb ?? createRuntimeDbGetter(env);

	return {
		async getReplayPacketIndexById(packetId) {
			const db = await getDb();
			const rows = await db
				.select()
				.from(replayPacketIndex)
				.where(eq(replayPacketIndex.packetId, packetId))
				.limit(1);
			return rows[0] ? toRead(rows[0]) : null;
		},

		async insertReplayPacketAccessAudit(input) {
			const db = await getDb();
			await db.insert(replayPacketAccessAudit).values(toAccessAuditRow(input));
		},

		async listReplayPacketsByLinkage(input) {
			const db = await getDb();
			return listReplayPacketsByLinkage(db, input.linkage);
		},

		async markReplayPacketsDeletedByLinkage(input) {
			const db = await getDb();
			const rows = await listReplayPacketsByLinkage(db, input.linkage);
			if (rows.length === 0) {
				return [];
			}
			await db
				.update(replayPacketIndex)
				.set({
					deletedAt: new Date(input.deletionMarker.deletedAt),
					deletionMarkerJson: input.deletionMarker,
				})
				.where(buildReplayPacketLinkageWhere(input.linkage));
			return rows;
		},

		async touchReplayPacketLastAccessedAt(input) {
			const db = await getDb();
			await db
				.update(replayPacketIndex)
				.set({ lastAccessedAt: new Date(input.accessedAt) })
				.where(eq(replayPacketIndex.packetId, input.packetId));
		},

		async upsertReplayPacketIndex(input) {
			const db = await getDb();
			await db
				.insert(replayPacketIndex)
				.values(toRow(input))
				.onConflictDoUpdate({
					set: toRow(input),
					target: replayPacketIndex.packetId,
				});
		},
	};
}

async function listReplayPacketsByLinkage(
	db: RuntimeDatabase,
	linkage: ReplayPacketLinkageFilter,
): Promise<ReplayPacketIndexRead[]> {
	const rows = await db
		.select()
		.from(replayPacketIndex)
		.where(buildReplayPacketLinkageWhere(linkage));
	return rows.map(toRead);
}

function buildReplayPacketLinkageWhere(input: ReplayPacketLinkageFilter) {
	const conditions: SQL<unknown>[] = [];
	if (input.subjectRef) {
		conditions.push(
			sql`${replayPacketIndex.deletionLinkageJson}->>'subject_ref' = ${input.subjectRef}`,
		);
	}
	if (input.requestId) {
		conditions.push(eq(replayPacketIndex.requestId, input.requestId));
	}
	if (input.traceId) {
		conditions.push(eq(replayPacketIndex.traceId, input.traceId));
	}
	if (conditions.length === 0) {
		throw new Error("Replay packet linkage filter requires subjectRef, requestId, or traceId.");
	}
	return and(...conditions);
}

function toAccessAuditRow(
	input: ReplayPacketAccessAuditWrite,
): typeof replayPacketAccessAudit.$inferInsert {
	return {
		accessId: input.accessId,
		accessKind: input.accessKind,
		actorPrincipal: input.actorPrincipal,
		occurredAt: new Date(input.occurredAt),
		packetId: input.packetId,
		purpose: input.purpose,
		requestId: input.requestId,
		traceId: input.traceId,
	};
}

function toRead(row: typeof replayPacketIndex.$inferSelect): ReplayPacketIndexRead {
	return {
		accessAudit: row.accessAuditJson,
		answerEvalFingerprint: row.answerEvalFingerprintJson ?? null,
		approvalRef: row.approvalRef ?? null,
		capturePolicy: row.capturePolicyJson,
		createdAt: row.createdAt.toISOString(),
		deletedAt: row.deletedAt?.toISOString() ?? null,
		deletionLinkage: row.deletionLinkageJson,
		deletionMarker: row.deletionMarkerJson ?? null,
		encryptionKeyRef: row.encryptionKeyRef,
		evidenceReplayIndex: row.evidenceReplayIndexJson,
		expiresAt: row.expiresAt.toISOString(),
		lastAccessedAt: row.lastAccessedAt?.toISOString() ?? null,
		llmIoFingerprint: row.llmIoFingerprintJson,
		objectChecksumSha256: row.objectChecksumSha256,
		objectRef: row.objectRef,
		operatorPrincipal: row.operatorPrincipal ?? null,
		packetId: row.packetId,
		requestId: row.requestId,
		retention: row.retentionJson,
		runId: row.runId,
		sensitivityClassification: row.sensitivityClassification,
		sinkIdentityProjection: row.sinkIdentityProjectionJson ?? null,
		traceId: row.traceId,
	};
}

function toRow(input: ReplayPacketIndexWrite): typeof replayPacketIndex.$inferInsert {
	return {
		accessAuditJson: input.accessAudit,
		answerEvalFingerprintJson: input.answerEvalFingerprint,
		approvalRef: input.approvalRef,
		capturePolicyJson: input.capturePolicy,
		createdAt: new Date(input.createdAt),
		deletionLinkageJson: input.deletionLinkage,
		encryptionKeyRef: input.encryptionKeyRef,
		evidenceReplayIndexJson: input.evidenceReplayIndex,
		expiresAt: new Date(input.expiresAt),
		lastAccessedAt: null,
		deletedAt: null,
		deletionMarkerJson: null,
		llmIoFingerprintJson: input.llmIoFingerprint,
		objectChecksumSha256: input.objectChecksumSha256,
		objectRef: input.objectRef,
		operatorPrincipal: input.operatorPrincipal,
		packetId: input.packetId,
		requestId: input.requestId,
		retentionJson: input.retention,
		runId: input.runId,
		sensitivityClassification: input.sensitivityClassification,
		sinkIdentityProjectionJson: input.sinkIdentityProjection,
		traceId: input.traceId,
	};
}
