import { normalizeReplayPacketIndexPayload } from "./ingest-contract";
import type {
	ReplayCaptureService,
	ReplayCaptureStore,
	ReplayPacketAccessAuditWrite,
	ReplayPacketAccessKind,
	ReplayPacketIndexRead,
	ReplayPacketLinkageFilter,
} from "./types";
import { normalizeOptionalServiceString, normalizeServiceString, routeError } from "./validation";

export function buildReplayCaptureService(input: {
	generateId?: (prefix: string) => string;
	now?: () => Date;
	store: ReplayCaptureStore;
}): ReplayCaptureService {
	const now = input.now ?? (() => new Date());
	const generateId = input.generateId ?? ((prefix) => `${prefix}_${crypto.randomUUID()}`);

	return {
		async deleteReplayPacketsByLinkage(deleteInput) {
			const actorPrincipal = normalizeServiceString(deleteInput.actorPrincipal, "actorPrincipal");
			const purpose = normalizeServiceString(deleteInput.purpose, "purpose");
			const approvalRef = normalizeOptionalServiceString(deleteInput.approvalRef, "approvalRef");
			const linkage = normalizeLinkageFilter(deleteInput);
			const occurredAt = now().toISOString();
			const rows = await input.store.listReplayPacketsByLinkage({ linkage });

			for (const packet of rows) {
				assertReplayPacketAccessAuthorized({
					accessKind: "delete",
					actorPrincipal,
					approvalRef,
					packet,
				});
				await input.store.insertReplayPacketAccessAudit(
					buildAccessAuditWrite({
						accessKind: "delete",
						actorPrincipal,
						generateId,
						occurredAt,
						packet,
						purpose,
					}),
				);
			}
			await input.store.markReplayPacketsDeletedByLinkage({
				deletionMarker: {
					actorPrincipal,
					deletedAt: occurredAt,
					purpose,
				},
				linkage,
			});

			return {
				deletedPacketIds: rows.map((row) => row.packetId),
				matchedCount: rows.length,
				mode: deleteInput.mode,
			};
		},

		async getReplayPacketIndex(readInput) {
			const packetId = normalizeServiceString(readInput.packetId, "packetId");
			const actorPrincipal = normalizeServiceString(readInput.actorPrincipal, "actorPrincipal");
			const purpose = normalizeServiceString(readInput.purpose, "purpose");
			const approvalRef = normalizeOptionalServiceString(readInput.approvalRef, "approvalRef");
			const accessKind = normalizeAccessKind(readInput.accessKind);
			const packet = await input.store.getReplayPacketIndexById(packetId);
			if (!packet) {
				throw routeError({
					code: "replay_packet_not_found",
					message: "Replay packet index metadata was not found.",
					status: 404,
				});
			}
			assertReplayPacketAccessible(packet, now());
			assertReplayPacketAccessAuthorized({
				accessKind,
				actorPrincipal,
				approvalRef,
				packet,
			});

			const occurredAt = now().toISOString();
			await input.store.touchReplayPacketLastAccessedAt({
				accessedAt: occurredAt,
				packetId: packet.packetId,
			});
			await input.store.insertReplayPacketAccessAudit(
				buildAccessAuditWrite({
					accessKind,
					actorPrincipal,
					generateId,
					occurredAt,
					packet,
					purpose,
				}),
			);

			return { packet };
		},

		async ingestReplayPacketIndex({ payload }) {
			const normalized = normalizeReplayPacketIndexPayload(payload);
			await input.store.upsertReplayPacketIndex(normalized);
			return {
				accepted: 1,
				packetId: normalized.packetId,
			};
		},
	};
}

function buildAccessAuditWrite(input: {
	accessKind: ReplayPacketAccessKind;
	actorPrincipal: string;
	generateId: (prefix: string) => string;
	occurredAt: string;
	packet: ReplayPacketIndexRead;
	purpose: string;
}): ReplayPacketAccessAuditWrite {
	return {
		accessId: input.generateId("replay_access"),
		accessKind: input.accessKind,
		actorPrincipal: input.actorPrincipal,
		occurredAt: input.occurredAt,
		packetId: input.packet.packetId,
		purpose: input.purpose,
		requestId: input.packet.requestId,
		traceId: input.packet.traceId,
	};
}

function normalizeAccessKind(value: unknown): Exclude<ReplayPacketAccessKind, "delete"> {
	if (value === "read" || value === "export" || value === "replay") {
		return value;
	}
	throw routeError({
		code: "validation_failed",
		details: { field: "accessKind" },
		message: "accessKind must be read, export, or replay.",
		status: 422,
	});
}

function normalizeLinkageFilter(input: {
	requestId?: string;
	subjectRef?: string;
	traceId?: string;
}): ReplayPacketLinkageFilter {
	const linkage = {
		requestId: normalizeOptionalServiceString(input.requestId, "requestId"),
		subjectRef: normalizeOptionalServiceString(input.subjectRef, "subjectRef"),
		traceId: normalizeOptionalServiceString(input.traceId, "traceId"),
	};
	if (!(linkage.requestId || linkage.subjectRef || linkage.traceId)) {
		throw routeError({
			code: "validation_failed",
			message: "At least one replay packet deletion linkage field is required.",
			status: 422,
		});
	}
	return linkage;
}

function assertReplayPacketAccessible(packet: ReplayPacketIndexRead, now: Date): void {
	if (packet.deletedAt) {
		throw routeError({
			code: "replay_packet_deleted",
			message: "Replay packet index metadata is deleted.",
			status: 410,
		});
	}
	if (new Date(packet.expiresAt).getTime() <= now.getTime()) {
		throw routeError({
			code: "replay_packet_expired",
			message: "Replay packet index metadata is expired.",
			status: 410,
		});
	}
}

function assertReplayPacketAccessAuthorized(input: {
	accessKind: ReplayPacketAccessKind;
	actorPrincipal: string;
	approvalRef?: string;
	packet: ReplayPacketIndexRead;
}): void {
	if (!input.packet.accessAudit.audit_required) {
		throw routeError({
			code: "replay_packet_access_policy_invalid",
			message: "Replay packet access audit policy is not active.",
			status: 403,
		});
	}
	const expectedOperator = input.packet.operatorPrincipal?.trim();
	if (
		input.accessKind !== "delete" &&
		expectedOperator &&
		expectedOperator !== input.actorPrincipal
	) {
		throw routeError({
			code: "replay_packet_access_forbidden",
			message: "Replay packet access requires the admitted operator principal.",
			status: 403,
		});
	}
	const expectedApproval = input.packet.approvalRef?.trim();
	if (
		(input.accessKind !== "read" || expectedApproval) &&
		!(expectedApproval && input.approvalRef === expectedApproval)
	) {
		throw routeError({
			code: "replay_packet_approval_required",
			message: "Replay packet access requires the matching approval reference.",
			status: 403,
		});
	}
}
