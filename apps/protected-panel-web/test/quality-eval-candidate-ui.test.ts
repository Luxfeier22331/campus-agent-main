import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { formatQualityEvalCandidateSource } from "../src/panel/pages/quality-domain";

const __dirname = dirname(fileURLToPath(import.meta.url));
const qualityCardsSource = readFileSync(
	join(__dirname, "../src/panel/pages/quality-page/cards.tsx"),
	"utf8",
);
const diagnosticSummarySource = readFileSync(
	join(__dirname, "../src/panel/pages/quality-page/eval-candidate-diagnostic-summary.tsx"),
	"utf8",
);

describe("quality eval candidate UI", () => {
	it("labels RAGAS diagnostic candidates as diagnostic review sources", () => {
		expect(formatQualityEvalCandidateSource("ragas_diagnostic")).toBe("RAGAS diagnostic");
		expect(formatQualityEvalCandidateSource("negative_feedback")).toBe("负反馈");
		expect(formatQualityEvalCandidateSource("operator_badcase")).toBe("Badcase");
	});

	it("does not build request detail links for candidates without runtime request identity", () => {
		expect(qualityCardsSource).toContain("candidate.requestId ? (");
		expect(qualityCardsSource).toContain("buildRequestShowPath(candidate.requestId)");
		expect(qualityCardsSource).toContain("candidate.diagnostic?.caseId");
	});

	it("shows durable run backlinks as review metadata without turning them into execution truth", () => {
		expect(qualityCardsSource).toContain("PANEL_COPY.qualityPage.queueColumns.runId");
		expect(qualityCardsSource).toContain("candidate.runId ?? PANEL_COPY.pending");
		expect(qualityCardsSource).toContain("props.selectedBadcase.runId ?? PANEL_COPY.pending");
	});

	it("renders RAGAS diagnostic review metadata without raw runtime links", () => {
		expect(diagnosticSummarySource).toContain("diagnostic.failureStage");
		expect(diagnosticSummarySource).toContain("diagnostic.expectedDocIds");
		expect(diagnosticSummarySource).toContain("diagnostic.supportingDocIds");
		expect(diagnosticSummarySource).toContain("diagnostic.answerShape");
		expect(diagnosticSummarySource).toContain("diagnostic.trajectoryAttribution");
		expect(diagnosticSummarySource).toContain("trajectory.stepId");
		expect(diagnosticSummarySource).toContain("trajectory.stepStatus");
		expect(`${qualityCardsSource}\n${diagnosticSummarySource}`).not.toMatch(
			/rawPrompt|rawAnswer|transcript|artifactPath/,
		);
	});
});
