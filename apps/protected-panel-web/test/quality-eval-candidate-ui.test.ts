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
});
