import { WorkflowExecutionAlreadyStartedError } from "@temporalio/common";
import {
	executeChild,
	ParentClosePolicy,
	patched,
	proxyActivities,
	workflowInfo,
} from "@temporalio/workflow";
import type { CollectionCommandResult } from "internal-portal-collection/collection-command";
import type * as pipelineActivities from "./activities.ts";
import type { NoticePipelineInput } from "./contracts.ts";
import { NOTICE_PIPELINE_WORKFLOW_ID } from "./identity.ts";

// One window must fit the 60-minute activity limit on a first collection with resource downloads.
export const BACKFILL_WINDOW_DAYS = 30;
// Stop opening windows while classification and publication can still finish in this run.
const BACKFILL_PROCESSING_RESERVE_MS = 2 * 60 * 60 * 1000;

type CollectionResult = CollectionCommandResult;

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
	const collection =
		input.mode === "backfill" && patched("notice-backfill-windows")
			? await backfillInWindows(input.startDate ?? "")
			: await pipelineStages.collectNotices(
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

// Each window saves the maintained range, so a stopped run resumes from the last committed window.
async function backfillInWindows(startDate: string): Promise<CollectionResult> {
	const windows: CollectionResult[] = [];
	let coveredFrom: string | undefined;
	for (;;) {
		const window = await pipelineStages.collectNotices({
			mode: "notice-backfill",
			startDate,
			windowDays: BACKFILL_WINDOW_DAYS,
		});
		windows.push(window);
		const from = window.maintenanceRange?.from;
		const advanced = from !== undefined && (coveredFrom === undefined || from < coveredFrom);
		coveredFrom = from;
		if (
			window.summary.outcome !== "success" ||
			!window.processedRange ||
			!advanced ||
			from <= startDate
		) {
			return mergeBackfillWindows(windows, false);
		}
		if (!hasBackfillTime()) {
			return mergeBackfillWindows(windows, true);
		}
	}
}

function hasBackfillTime(): boolean {
	const info = workflowInfo();
	if (info.executionTimeoutMs === undefined) {
		return true;
	}
	const deadline = info.startTime.getTime() + info.executionTimeoutMs;
	return deadline - Date.now() >= BACKFILL_PROCESSING_RESERVE_MS;
}

function mergeBackfillWindows(
	windows: readonly CollectionResult[],
	incomplete: boolean,
): CollectionResult {
	const last = windows.at(-1) as CollectionResult;
	if (windows.length === 1 && !incomplete) {
		return last;
	}
	const summary: CollectionResult["summary"] = { ...last.summary };
	for (const window of windows.slice(0, -1)) {
		for (const [key, value] of Object.entries(window.summary)) {
			if (typeof value === "number") {
				summary[key] = ((summary[key] as number | undefined) ?? 0) + value;
			}
		}
	}
	// Windows walk backwards from the maintained lower bound, so they are contiguous.
	const first = windows.find((window) => window.processedRange)?.processedRange;
	const lastProcessed = [...windows]
		.reverse()
		.find((window) => window.processedRange)?.processedRange;
	return {
		...last,
		// A failed window keeps the range committed by the windows before it.
		maintenanceRange:
			[...windows].reverse().find((window) => window.maintenanceRange)?.maintenanceRange ?? null,
		processedRange: first && lastProcessed ? { from: lastProcessed.from, to: first.to } : null,
		summary: { ...summary, outcome: incomplete ? "partial" : last.summary.outcome },
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
