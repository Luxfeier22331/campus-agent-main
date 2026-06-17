import { Stack, Typography } from "@mui/material";

import { PANEL_COPY } from "../../panel-copy";
import type { OperatorQualityEvalCandidateRecord } from "../../types";
import { formatDiagnosticStageLabel } from "../eval-coverage-domain";

function compactIdList(values: string[]) {
	if (values.length === 0) {
		return PANEL_COPY.none;
	}
	if (values.length <= 3) {
		return values.join(", ");
	}
	return `${values.slice(0, 3).join(", ")} +${values.length - 3}`;
}

function compactOutcome(
	outcome: NonNullable<
		OperatorQualityEvalCandidateRecord["diagnostic"]
	>["trajectoryAttribution"]["outcome"],
) {
	const values = [
		outcome.failCloseReason ? `拒绝保护=${outcome.failCloseReason}` : null,
		outcome.terminalReason ? `终态=${outcome.terminalReason}` : null,
		outcome.replanReason ? `重规划=${outcome.replanReason}` : null,
		outcome.cancelOutcome ? `取消=${outcome.cancelOutcome}` : null,
		outcome.timeoutOutcome ? `超时=${outcome.timeoutOutcome}` : null,
		outcome.lateCompletionOutcome ? `迟到完成=${outcome.lateCompletionOutcome}` : null,
	].filter((value): value is string => Boolean(value));
	return values.length > 0 ? values.join(" · ") : PANEL_COPY.none;
}

export function EvalCandidateDiagnosticSummary(props: {
	candidate: OperatorQualityEvalCandidateRecord;
}) {
	const diagnostic = props.candidate.diagnostic;
	if (!diagnostic) {
		return null;
	}
	const trajectory = diagnostic.trajectoryAttribution;

	return (
		<Stack spacing={0.5} sx={{ mt: 0.75 }}>
			<Typography color="text.secondary" variant="caption">
				{`${diagnostic.caseId} · ${diagnostic.metricName} ${diagnostic.score.toFixed(
					2,
				)}/${diagnostic.threshold.toFixed(2)} · ${formatDiagnosticStageLabel(
					diagnostic.failureStage,
				)}`}
			</Typography>
			<Typography color="text.secondary" variant="caption">
				{`期望: ${compactIdList(diagnostic.expectedDocIds)} · 召回: ${compactIdList(
					diagnostic.retrievedDocIds,
				)} · 支撑: ${compactIdList(diagnostic.supportingDocIds)}`}
			</Typography>
			<Typography color="text.secondary" variant="caption">
				{`答案形态: ${diagnostic.answerShape ?? PANEL_COPY.none} · 展示类型: ${
					diagnostic.presentationKind ?? PANEL_COPY.none
				}`}
			</Typography>
			<Typography color="text.secondary" variant="caption">
				{`处理轨迹: ${trajectory.status} · 步骤: ${trajectory.stepId ?? PANEL_COPY.none} · 状态: ${
					trajectory.stepStatus ?? PANEL_COPY.none
				} · 目标: ${trajectory.capability ?? PANEL_COPY.none}`}
			</Typography>
			<Typography color="text.secondary" variant="caption">
				{`结果: ${compactOutcome(trajectory.outcome)}`}
			</Typography>
		</Stack>
	);
}
