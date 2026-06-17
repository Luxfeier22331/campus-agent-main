// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { HttpError, testDataProvider, useAuthenticated, useDataProvider } from "react-admin";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OperatorConsoleDataProvider } from "../src/panel/data-provider";
import appSource from "../src/panel/app.tsx?raw";
import domainSource from "../src/panel/pages/eval-coverage-domain.ts?raw";
import { EvalCoveragePage } from "../src/panel/pages/eval-coverage-page";
import pageSource from "../src/panel/pages/eval-coverage-page.tsx?raw";
import layoutSource from "../src/panel/panel-layout.tsx?raw";

const dataProviderMock = testDataProvider({
	getOperatorEvalCoverage: vi.fn(),
}) as OperatorConsoleDataProvider & {
	getOperatorEvalCoverage: ReturnType<typeof vi.fn>;
};

vi.mock("react-admin", async () => {
	const actual = await vi.importActual<typeof import("react-admin")>("react-admin");
	return {
		...actual,
		Title: ({ title }: { title: string }) => createElement("title", null, title),
		useAuthenticated: vi.fn(),
		useDataProvider: vi.fn(),
	};
});

function renderWithQueryClient(element: ReactElement) {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
		},
	});

	return render(createElement(QueryClientProvider, { client: queryClient }, element));
}

describe("Operator Console eval coverage UI", () => {
	beforeEach(() => {
		dataProviderMock.getOperatorEvalCoverage.mockReset();
		vi.mocked(useAuthenticated).mockReturnValue({
			authenticated: true,
			data: true,
			isPending: false,
			isSuccess: true,
			status: "success",
		} as ReturnType<typeof useAuthenticated>);
		vi.mocked(useDataProvider).mockReturnValue(dataProviderMock);
	});

	it("wires eval coverage as a dedicated observability route", () => {
		expect(appSource).toContain("EvalCoveragePage");
		expect(appSource).toContain('path="/observability/eval-coverage"');
		expect(layoutSource).toContain("PANEL_COPY.menu.evalCoverage");
		expect(layoutSource).toContain('to="/observability/eval-coverage"');
	});

	it("keeps eval coverage page on the app-api projection seam", () => {
		expect(pageSource).toContain("getOperatorEvalCoverage");
		expect(pageSource).toContain("qrelsCaseCount");
		expect(pageSource).toContain("uniqueExpectedDocCount");
		expect(pageSource).toContain("releaseAcceptanceCaseCount");
		expect(pageSource).toContain("answerQualityCaseCount");
		expect(pageSource).toContain("goldenQrelsCaseCount");
		expect(pageSource).toContain("knownGapCaseCount");
		expect(pageSource).toContain("ragasDiagnostic");
		expect(pageSource).toContain("lowScoreCases");
		expect(domainSource).toContain("stageDistribution");
		expect(pageSource).toContain("buildQualityEvalCandidateFilterPath");
		expect(pageSource).toContain("lastGate");
		expect(pageSource).not.toMatch(/localStorage|artifactPath|objectKey|bucket|\\.tmp/);
	});

	it("renders a governed empty state when the eval coverage snapshot has not been published", async () => {
		dataProviderMock.getOperatorEvalCoverage.mockRejectedValue(
			new HttpError("Eval coverage snapshot not found.", 404, {
				error: {
					code: "eval_coverage_snapshot_not_found",
					message: "Eval coverage snapshot not found.",
				},
			}),
		);

		renderWithQueryClient(createElement(EvalCoveragePage));

		expect(await screen.findByText("尚未发布评测覆盖快照。")).toBeInTheDocument();
		expect(screen.queryByText("Eval coverage snapshot not found.")).not.toBeInTheDocument();
	});
});
