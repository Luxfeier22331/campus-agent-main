import { and, asc, eq, inArray, isNotNull, lt, or, sql } from "drizzle-orm";

import type { RuntimeDbGetter } from "../../db/runtime";
import { turnDispatches } from "../../db/schema";
import type { ChatAdmissionStore } from "./store-types";

export function createPgChatAdmissionStore(getDb: RuntimeDbGetter): ChatAdmissionStore {
	return {
		async claimAdmission(input) {
			const db = await getDb();
			const admissionCondition = input.staleBefore
				? or(
						eq(turnDispatches.admissionStatus, "pending_admission"),
						and(
							eq(turnDispatches.admissionStatus, "dispatching"),
							lt(turnDispatches.updatedAt, new Date(input.staleBefore)),
						),
					)
				: eq(turnDispatches.admissionStatus, "pending_admission");
			const rows = await db
				.update(turnDispatches)
				.set({
					admissionStatus: "dispatching",
					updatedAt: new Date(input.updatedAt),
				})
				.where(
					and(
						eq(turnDispatches.requestId, input.requestId),
						eq(turnDispatches.workflowId, input.workflowId),
						eq(turnDispatches.status, "accepted"),
						admissionCondition,
						inArray(turnDispatches.cancelOutboxStatus, ["not_requested", "pending_delivery"]),
					),
				)
				.returning({ requestId: turnDispatches.requestId });
			return rows.length === 1;
		},

		async releaseAdmission(input) {
			const db = await getDb();
			const rows = await db
				.update(turnDispatches)
				.set({
					admissionStatus: sql<string>`case
						when ${turnDispatches.cancelOutboxStatus} in ('local_finalization_pending', 'closed')
							then 'cancelled'
						else 'pending_admission'
					end`,
					updatedAt: new Date(input.updatedAt),
				})
				.where(
					and(
						eq(turnDispatches.requestId, input.requestId),
						eq(turnDispatches.workflowId, input.workflowId),
						eq(turnDispatches.status, "accepted"),
						eq(turnDispatches.admissionStatus, "dispatching"),
						inArray(turnDispatches.cancelOutboxStatus, [
							"not_requested",
							"pending_delivery",
							"local_finalization_pending",
						]),
					),
				)
				.returning({ requestId: turnDispatches.requestId });
			return rows.length === 1;
		},

		async markAdmitted(input) {
			const db = await getDb();
			const rows = await db
				.update(turnDispatches)
				.set({
					admissionStatus: "admitted",
					admissionInputJson: null,
					admissionInputSha256: null,
					admittedAt: new Date(input.admittedAt),
					workflowId: input.workflowId,
				})
				.where(
					and(
						eq(turnDispatches.requestId, input.requestId),
						eq(turnDispatches.status, "accepted"),
						inArray(turnDispatches.admissionStatus, ["dispatching", "admitted"]),
						eq(turnDispatches.workflowId, input.workflowId),
						inArray(turnDispatches.cancelOutboxStatus, ["not_requested", "pending_delivery"]),
					),
				)
				.returning({ requestId: turnDispatches.requestId });
			return rows.length === 1;
		},

		async listPendingAdmissions(input = {}) {
			const db = await getDb();
			const limit = Math.max(1, Math.min(input.limit ?? 25, 100));
			const admissionCondition = input.staleBefore
				? or(
						and(
							eq(turnDispatches.admissionStatus, "pending_admission"),
							inArray(turnDispatches.cancelOutboxStatus, ["not_requested", "pending_delivery"]),
						),
						and(
							eq(turnDispatches.admissionStatus, "dispatching"),
							lt(turnDispatches.updatedAt, new Date(input.staleBefore)),
							inArray(turnDispatches.cancelOutboxStatus, ["not_requested", "pending_delivery"]),
						),
					)
				: and(
						eq(turnDispatches.admissionStatus, "pending_admission"),
						inArray(turnDispatches.cancelOutboxStatus, ["not_requested", "pending_delivery"]),
					);
			const rows = await db
				.select({
					admissionInputJson: turnDispatches.admissionInputJson,
					admissionInputSha256: turnDispatches.admissionInputSha256,
					requestId: turnDispatches.requestId,
					runId: turnDispatches.runId,
					workflowId: turnDispatches.workflowId,
				})
				.from(turnDispatches)
				.where(
					and(
						eq(turnDispatches.status, "accepted"),
						admissionCondition,
						isNotNull(turnDispatches.workflowId),
						isNotNull(turnDispatches.runId),
						isNotNull(turnDispatches.admissionInputJson),
						isNotNull(turnDispatches.admissionInputSha256),
					),
				)
				.orderBy(asc(turnDispatches.updatedAt))
				.limit(limit);
			return rows.flatMap((row) =>
				row.workflowId && row.runId && row.admissionInputJson && row.admissionInputSha256
					? [
							{
								admissionInputJson: row.admissionInputJson,
								admissionInputSha256: row.admissionInputSha256,
								requestId: row.requestId,
								runId: row.runId,
								workflowId: row.workflowId,
							},
						]
					: [],
			);
		},
	};
}
