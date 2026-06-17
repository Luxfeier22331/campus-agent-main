import { formatPanelMicrousd, PANEL_COPY } from "../panel-copy";
import type { RequestRuntimeRunSummary } from "../types";

import type { RequestStepTrajectoryEntry } from "./request-formatters";

function formatDuration(durationMs: number | null) {
	if (durationMs === null || !Number.isFinite(durationMs)) {
		return PANEL_COPY.pending;
	}

	if (durationMs < 1000) {
		return `${durationMs} ms`;
	}

	return `${(durationMs / 1000).toFixed(2)} s`;
}

function formatTokenCostSummary(input: {
	estimatedCostMicrousd: number;
	inputTokens: number;
	outputTokens: number;
}) {
	const inputTokens = Number.isFinite(input.inputTokens) ? input.inputTokens : 0;
	const outputTokens = Number.isFinite(input.outputTokens) ? input.outputTokens : 0;
	const estimatedCostMicrousd = Number.isFinite(input.estimatedCostMicrousd)
		? input.estimatedCostMicrousd
		: 0;
	const cost = estimatedCostMicrousd > 0 ? formatPanelMicrousd(estimatedCostMicrousd) : "成本 0";
	return `输入/输出 ${inputTokens}/${outputTokens} · ${cost}`;
}

type OperatorStep = NonNullable<
	RequestRuntimeRunSummary["operatorStepTrajectory"]
>["steps"][number];
type SummaryStep = NonNullable<RequestRuntimeRunSummary["stepTrajectory"]>["steps"][number];
type AnyStep = OperatorStep | SummaryStep;

export function buildRequestStepTrajectoryEntries(
	trajectory:
		| RequestRuntimeRunSummary["operatorStepTrajectory"]
		| RequestRuntimeRunSummary["stepTrajectory"]
		| null
		| undefined,
) {
	if (!trajectory) {
		return [];
	}

	const attemptCount =
		"attemptCount" in trajectory
			? trajectory.attemptCount
			: trajectory.steps.reduce((total, step) => total + step.attemptCount, 0);
	const resultCount =
		"resultCount" in trajectory
			? trajectory.resultCount
			: trajectory.steps.reduce((total, step) => total + step.resultCount, 0);
	return [
		{
			kind: "summary" as const,
			metrics: `${trajectory.steps.length} 个步骤 · 尝试 ${attemptCount} · 结果 ${resultCount}`,
		},
		...trajectory.steps.map((step) => {
			const diagnosticGroups = buildStepDiagnosticGroups(step);
			const diagnostics = diagnosticGroups.flatMap((group) => group.items);
			return {
				attempts: `尝试 ${step.attemptCount} · 结果 ${step.resultCount}`,
				capability: step.capability || PANEL_COPY.unknown,
				diagnosticGroups,
				diagnostics,
				duration: `排队 ${formatDuration(step.queueWaitMs)} · 执行 ${formatDuration(step.durationMs)}`,
				kind: "step" as const,
				latestResultRef: step.latestResultRef || PANEL_COPY.none,
				model: formatStepModel(step),
				providerRequestRef: stepProviderRequestRef(step),
				status: step.status || PANEL_COPY.unknown,
				stepId: step.stepId,
				stepKind: step.stepKind || step.stepId,
				taskQueue: step.taskQueue || PANEL_COPY.unknown,
				tokenCost: formatStepTokenCostSummary(step),
				workerId: step.workerId || PANEL_COPY.unknown,
			};
		}),
	] satisfies RequestStepTrajectoryEntry[];
}

function buildStepDiagnosticGroups(
	step: AnyStep,
): Extract<RequestStepTrajectoryEntry, { kind: "step" }>["diagnosticGroups"] {
	const runtime = [
		`取消=${step.cancelOutcome || PANEL_COPY.none}`,
		`超时=${step.timeoutOutcome || PANEL_COPY.none}`,
		`迟到完成=${step.lateCompletionOutcome || PANEL_COPY.none}`,
	];
	const terminal: string[] = [];
	if ("terminalReason" in step && step.terminalReason) {
		terminal.push(`终态=${step.terminalReason}`);
	}
	if (step.failCloseReason) {
		terminal.push(`拒绝保护=${step.failCloseReason}`);
	}
	const replan = step.replanReason ? [`重规划=${step.replanReason}`] : [];
	const agent: string[] = [];
	if (step.agentTerminalReason) {
		agent.push(`模型代理终态=${step.agentTerminalReason}`);
	}
	if (step.agentSelectedTools && step.agentSelectedTools.length > 0) {
		agent.push(`模型代理工具=${step.agentSelectedTools.join(",")}`);
	}
	if (step.agentSdkTraceRef) {
		agent.push(`模型代理追踪=${step.agentSdkTraceRef}`);
	}
	if (step.agentToolResultRefs && step.agentToolResultRefs.length > 0) {
		agent.push(`工具结果=${step.agentToolResultRefs.join(",")}`);
	}
	return [
		{ kind: "runtime" as const, items: runtime },
		{ kind: "terminal" as const, items: terminal },
		{ kind: "replan" as const, items: replan },
		{ kind: "agent" as const, items: agent },
	].filter((group) => group.items.length > 0);
}

function formatStepModel(step: AnyStep) {
	if (!("modelProvider" in step && "modelName" in step)) {
		return PANEL_COPY.notAvailable;
	}
	return step.modelProvider && step.modelName
		? `${step.modelProvider}/${step.modelName}`
		: PANEL_COPY.notAvailable;
}

function stepProviderRequestRef(step: AnyStep) {
	if (!("providerRequestRef" in step)) {
		return PANEL_COPY.none;
	}
	return step.providerRequestRef || PANEL_COPY.none;
}

function formatStepTokenCostSummary(step: AnyStep) {
	if (!("estimatedCostMicrousd" in step && "inputTokens" in step && "outputTokens" in step)) {
		return PANEL_COPY.notAvailable;
	}
	return formatTokenCostSummary(step);
}
