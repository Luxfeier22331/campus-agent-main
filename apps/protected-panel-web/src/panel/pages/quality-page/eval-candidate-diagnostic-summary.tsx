import { Stack, Typography } from "@mui/material";

import { PANEL_COPY } from "../../panel-copy";
import type { OperatorQualityEvalCandidateRecord } from "../../types";
import { formatRagasDiagnosticStageLabel } from "../eval-coverage-domain";

function compactIdList(values: string[]) {
	if (values.length === 0) {
		return PANEL_COPY.none;
	}
	if (values.length <= 3) {
		return values.join(", ");
	}
	return `${values.slice(0, 3).join(", ")} +${values.length - 3}`;
}

export function EvalCandidateDiagnosticSummary(props: {
	candidate: OperatorQualityEvalCandidateRecord;
}) {
	const diagnostic = props.candidate.diagnostic;
	if (!diagnostic) {
		return null;
	}

	return (
		<Stack spacing={0.5} sx={{ mt: 0.75 }}>
			<Typography color="text.secondary" variant="caption">
				{`${diagnostic.caseId} · ${diagnostic.metricName} ${diagnostic.score.toFixed(
					2,
				)}/${diagnostic.threshold.toFixed(2)} · ${formatRagasDiagnosticStageLabel(
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
		</Stack>
	);
}
