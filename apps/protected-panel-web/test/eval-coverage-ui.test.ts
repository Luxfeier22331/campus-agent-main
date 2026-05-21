import { describe, expect, it } from "vitest";

import appSource from "../src/panel/app.tsx?raw";
import pageSource from "../src/panel/pages/eval-coverage-page.tsx?raw";
import layoutSource from "../src/panel/panel-layout.tsx?raw";

describe("protected panel eval coverage UI", () => {
	it("wires eval coverage as a dedicated observability route", () => {
		expect(appSource).toContain("EvalCoveragePage");
		expect(appSource).toContain('path="/observability/eval-coverage"');
		expect(layoutSource).toContain("PANEL_COPY.menu.evalCoverage");
		expect(layoutSource).toContain('to="/observability/eval-coverage"');
	});

	it("keeps eval coverage page on the app-api projection seam", () => {
		expect(pageSource).toContain("getOperatorEvalCoverage");
		expect(pageSource).toContain("qrelsCaseCount");
		expect(pageSource).toContain("releaseAcceptanceCaseCount");
		expect(pageSource).toContain("answerQualityCaseCount");
		expect(pageSource).toContain("knownGapCaseCount");
		expect(pageSource).toContain("ragasDiagnostic");
		expect(pageSource).toContain("lastGate");
		expect(pageSource).not.toMatch(/localStorage|artifactPath|objectKey|bucket|\\.tmp/);
	});
});
