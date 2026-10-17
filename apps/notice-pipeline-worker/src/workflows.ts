import { WorkflowExecutionAlreadyStartedError } from "@temporalio/common";
import { executeChild, ParentClosePolicy, proxyActivities } from "@temporalio/workflow";
import type * as pipelineActivities from "./activities.ts";
import type { NoticePipelineInput } from "./contracts.ts";
import { NOTICE_PIPELINE_WORKFLOW_ID } from "./identity.ts";

const pipelineStages = proxyActivities<typeof pipelineActivities>({
	taskQueue: "notice-pipeline",
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

export async function noticePipelineScheduled() {
	try {
		return await executeChild(noticePipelineRun, {
			args: [{ mode: "scheduled" }],
			workflowId: NOTICE_PIPELINE_WORKFLOW_ID,
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

export async function noticePipelineRun(input: NoticePipelineInput = { mode: "scheduled" }) {
	if (input.mode === "file-sync") {
		const files = await pipelineStages.syncFiles();
		return { outcome: files.summary.outcome, files };
	}
	if (input.mode === "classify-one") {
		const classification = await pipelineStages.classifyNotices(input.noticeIds);
		return { outcome: classification.outcome, classification };
	}
	if (input.mode === "publish-one" || input.mode === "republish-one") {
		const publication = await pipelineStages.publishNoticesStage(
			input.noticeIds,
			input.mode === "republish-one",
		);
		return { outcome: publication.outcome, publication };
	}
	const collection = await pipelineStages.collectNotices(
		input.mode === "backfill"
			? { mode: "notice-backfill", startDate: input.startDate ?? "" }
			: input.mode === "rescan"
				? { mode: "notice-rescan", from: input.from ?? "", to: input.to ?? "" }
				: { mode: "notice-sync" },
	);
	const classification = await pipelineStages.classifyNotices();
	const publication = await pipelineStages.publishNoticesStage();
	return {
		outcome: pipelineOutcome([collection, classification, publication]),
		collection,
		classification,
		publication,
	};
}

function pipelineOutcome(stages: readonly unknown[]): "success" | "partial" | "skipped" {
	const outcomes = stages.map((stage) => {
		const value = stage as { outcome?: string; summary?: { outcome?: string } };
		return value.summary?.outcome ?? value.outcome;
	});
	if (outcomes.some((value) => value === "partial" || value === "failed")) {
		return "partial";
	}
	return outcomes.every((value) => value === "skipped") ? "skipped" : "success";
}
