import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CitationFailurePanel, similarFailurePath } from "../src/app/citation-failure-panel";
import { OpsWebApp } from "../src/app/ops-web-app";
import { toExecutionDiagnostics } from "../src/server/ops-status/mapping/execution";
import { toRequestSummary } from "../src/server/ops-status/mapping/request";
import { opsRequestDetailFixture, opsRequestListFixture } from "../src/shared/ops-fixtures";
import {
	requestRow,
	runAttemptRow,
	runDiagnostics,
	runStepRow,
} from "./ops-status-store-test-helpers";

const citation = {
	schema_version: 1,
	validation_stage: "provider_annotation",
	field: "end_index",
	item_index: 0,
	start: 0,
	end: 9,
	text_length: 4,
	offset_unit: "utf16_code_unit",
} as const;
const failure = {
	code: "citation_validation_failed",
	reason: "span_out_of_bounds",
	citation,
	citationState: "recorded" as const,
	operation: "workflow.solve",
	detail: "引用区间超出正文",
	httpStatus: null,
	invocationId: null,
};
describe("citation failure diagnosis", () => {
	it.each([
		{
			reason: "missing_evidence",
			citationStage: "future_stage",
			expectedReason: "missing_evidence",
			expectedStage: null,
		},
		{
			reason: 42,
			citationStage: "provider_annotation",
			expectedReason: null,
			expectedStage: "provider_annotation",
		},
	])(
		"keeps matched failure identity when optional diagnosis is invalid: %j",
		({ reason, citationStage, expectedReason, expectedStage }) => {
			const matchedFailure = {
				code: failure.code,
				reason,
				citationStage,
				scope: "stage",
				stepId: "solve.initial",
				occurredAt: "2026-09-19T00:00:00.000Z",
			};
			const result = toRequestSummary({ ...requestRow(), matchedFailure });
			expect(result.matchedFailure).toEqual({
				...matchedFailure,
				sourceCode: null,
				reason: expectedReason,
				citationStage: expectedStage,
				diagnosticState: "invalid",
			});
		},
	);
	it("shows original citation diagnosis under the synthesis terminal category", () => {
		render(
			<CitationFailurePanel
				failure={{ ...failure, code: "answer_synthesis_failed", sourceCode: failure.code }}
			/>,
		);
		expect(screen.getByText("citation_validation_failed")).toBeInTheDocument();
		expect(screen.getByText("UTF-16 code unit")).toBeInTheDocument();
		const href = screen.getByRole("link", { name: "查看同类请求" }).getAttribute("href") ?? "";
		expect(href).toContain("failureCode=answer_synthesis_failed");
		expect(href).toContain("failureReason=span_out_of_bounds");
	});
	it("does not borrow facts from a different stage with the same error code", () => {
		const diagnostics = runDiagnostics({
			steps: [
				runStepRow({
					stepId: "finalization.write",
					status: "failed",
					sanitizedPayloadJson: {
						failure: { code: failure.code, operation: "finalization.write" },
					},
				}),
			],
			attempts: [
				runAttemptRow({
					stepId: "solve.initial",
					status: "failed",
					sanitizedPayloadJson: { failure },
				}),
			],
		});
		const result = toExecutionDiagnostics(requestRow(), diagnostics);
		expect(result.failure).toMatchObject({ code: failure.code, reason: null, citation: null });
		expect(result.stages[0]?.failure).toMatchObject({
			code: failure.code,
			citationState: "not_recorded",
		});
	});
	it("does not borrow facts from another activity attempt", () => {
		const result = toExecutionDiagnostics(
			requestRow(),
			runDiagnostics({
				steps: [
					runStepRow({
						activityAttempt: 2,
						sanitizedPayloadJson: { failure: { code: failure.code } },
					}),
				],
				attempts: [
					runAttemptRow({
						activityAttempt: 1,
						status: "failed",
						sanitizedPayloadJson: { failure },
					}),
				],
			}),
		);
		expect(result.failure.reason).toBeNull();
	});
	it.each([undefined, { schema_version: 2 }])(
		"keeps the original failure when diagnostics are absent or invalid: %s",
		(citation) => {
			const result = toExecutionDiagnostics(
				requestRow(),
				runDiagnostics({
					steps: [runStepRow({ sanitizedPayloadJson: { failure: { ...failure, citation } } })],
					attempts: [],
				}),
			);
			expect(result.failure.code).toBe(failure.code);
			expect(result.failure.citationState).toBe(citation ? "invalid" : "not_recorded");
		},
	);
	it("shows zero positions and units, and preserves the query time range", () => {
		render(
			<CitationFailurePanel
				failure={failure}
				from="/requests?from=2026-09-17T00%3A00%3A00Z&to=2026-09-18T00%3A00%3A00Z&cursor=old"
			/>,
		);
		expect(screen.getByText("UTF-16 code unit")).toBeInTheDocument();
		expect(screen.getAllByText("0")).toHaveLength(2);
		const href = screen.getByRole("link", { name: "查看同类请求" }).getAttribute("href") ?? "";
		const query = new URL(href, "https://ops.local").searchParams;
		expect(query.get("failureReason")).toBe("span_out_of_bounds");
		expect(query.get("from")).toBe("2026-09-17T00:00:00Z");
		expect(query.has("cursor")).toBe(false);
		expect(similarFailurePath(failure)).toContain("failureScope=any");
	});
	it("preserves failure filters in detail links and applies changed filters", async () => {
		const original = globalThis.fetch;
		const fetch = vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			return Response.json(
				url.includes(`/requests/${opsRequestDetailFixture.request.requestId}`)
					? opsRequestDetailFixture
					: {
							...opsRequestListFixture,
							data: opsRequestListFixture.data.map((row, index) =>
								index === 0
									? {
											...row,
											matchedFailure: {
												code: failure.code,
												reason: null,
												citationStage: null,
												scope: "stage",
												stepId: "solve.initial",
												occurredAt: row.startedAt,
												diagnosticState: "invalid",
											},
										}
									: row,
							),
						},
			);
		});
		vi.stubGlobal("fetch", fetch);
		try {
			render(
				<OpsWebApp initialPath="/requests?failureCode=citation_validation_failed&failureReason=span_out_of_bounds&citationStage=provider_annotation&failureScope=stage" />,
			);
			await screen.findByRole("heading", { name: "运行诊断" });
			expect(await screen.findAllByText(/部分诊断无法解析/)).not.toHaveLength(0);
			expect(screen.getByRole("combobox", { name: "失败原因" })).toHaveValue("span_out_of_bounds");
			await waitFor(() =>
				expect(
					fetch.mock.calls.some(([url]) =>
						String(url).includes("failureReason=span_out_of_bounds"),
					),
				).toBe(true),
			);
			const link = screen.getAllByRole("link", {
				name: opsRequestListFixture.data[0]?.question.preview ?? "",
			})[0];
			expect(link?.getAttribute("href")).toContain("failureReason%3Dspan_out_of_bounds");
			fireEvent.change(screen.getByRole("combobox", { name: "失败原因" }), {
				target: { value: "missing_evidence" },
			});
			fireEvent.click(screen.getByRole("button", { name: /应用/ }));
			await waitFor(() =>
				expect(
					fetch.mock.calls.some(([url]) => String(url).includes("failureReason=missing_evidence")),
				).toBe(true),
			);
		} finally {
			vi.stubGlobal("fetch", original);
		}
	});
});
