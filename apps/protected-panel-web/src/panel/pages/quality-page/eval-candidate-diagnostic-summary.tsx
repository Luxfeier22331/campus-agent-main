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
		outcome.failCloseReason ? `fail_close=${outcome.failCloseReason}` : null,
		outcome.terminalReason ? `terminal=${outcome.terminalReason}` : null,
		outcome.replanReason ? `replan=${outcome.replanReason}` : null,
		outcome.cancelOutcome ? `cancel=${outcome.cancelOutcome}` : null,
		outcome.timeoutOutcome ? `timeout=${outcome.timeoutOutcome}` : null,
		outcome.lateCompletionOutcome ? `late=${outcome.lateCompletionOutcome}` : null,
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
				{`expected: ${compactIdList(diagnostic.expectedDocIds)} · retrieved: ${compactIdList(
					diagnostic.retrievedDocIds,
				)} · supporting: ${compactIdList(diagnostic.supportingDocIds)}`}
			</Typography>
			<Typography color="text.secondary" variant="caption">
				{`shape: ${diagnostic.answerShape ?? PANEL_COPY.none} · presentation: ${
					diagnostic.presentationKind ?? PANEL_COPY.none
				}`}
			</Typography>
			<Typography color="text.secondary" variant="caption">
				{`trajectory: ${trajectory.status} · step: ${trajectory.stepId ?? PANEL_COPY.none} · status: ${
					trajectory.stepStatus ?? PANEL_COPY.none
				} · capability: ${trajectory.capability ?? PANEL_COPY.none}`}
			</Typography>
			<Typography color="text.secondary" variant="caption">
				{`outcome: ${compactOutcome(trajectory.outcome)}`}
			</Typography>
		</Stack>
	);
}
