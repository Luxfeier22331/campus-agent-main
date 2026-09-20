import { WorkflowExecutionAlreadyStartedError } from "@temporalio/common";
import {
	executeChild,
	isCancellation,
	ParentClosePolicy,
	proxyActivities,
} from "@temporalio/workflow";
import type * as activities from "./activities.ts";
import type { RollbackInput } from "./contracts.ts";
import { RAG_MAINTENANCE_WORKFLOW_ID } from "./identity.ts";

const stages = proxyActivities<typeof activities>({
	cancellationType: "WAIT_CANCELLATION_COMPLETED",
	startToCloseTimeout: "60 minutes",
	heartbeatTimeout: "60 seconds",
	retry: {
		maximumAttempts: 3,
		initialInterval: "30 seconds",
		backoffCoefficient: 2,
		maximumInterval: "60 seconds",
	},
});

// Schedule adds a timestamp to its action ID. The child owns the shared ID
// for the entire prepare/embed/publish/cleanup lifetime.
export async function campusRagScheduledRefresh() {
	try {
		return await executeChild(campusRagRefresh, {
			workflowId: RAG_MAINTENANCE_WORKFLOW_ID,
			workflowIdReusePolicy: "ALLOW_DUPLICATE",
			parentClosePolicy: ParentClosePolicy.ABANDON,
			workflowExecutionTimeout: "4 hours",
		});
	} catch (error) {
		if (error instanceof WorkflowExecutionAlreadyStartedError) {
			return { outcome: "skipped" as const, reason: "already-running" };
		}
		throw error;
	}
}

export async function campusRagRefresh() {
	const prepared = await stages.prepareRefresh();
	let result: { outcome: "success" | "skipped"; collection: string };
	if (prepared.unchanged) {
		result = { outcome: "skipped", collection: prepared.expectedCurrent };
	} else {
		const embedding = await stages.embedNotices(prepared);
		result = await stages.publishRefresh({
			...prepared,
			noticeEmbeddingSet: embedding.embeddingSet,
		});
	}
	try {
		const cleanup = await stages.cleanupVersions();
		return { ...result, cleanup };
	} catch (error) {
		if (isCancellation(error)) {
			throw error;
		}
		return {
			...result,
			cleanup: { outcome: "failed", error: error instanceof Error ? error.message : String(error) },
		};
	}
}

export async function campusRagRollback(input: RollbackInput) {
	return stages.rollbackIndex(input);
}
