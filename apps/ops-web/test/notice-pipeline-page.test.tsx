import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpsWebApp } from "../src/app/ops-web-app";

describe("notice pipeline page", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("starts only the fixed notice operations and shows recent summaries", async () => {
		const requests: unknown[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = new URL(
					typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
					"https://ops.example.test",
				);
				if (init?.method === "POST") {
					requests.push(JSON.parse(String(init.body)));
					return Response.json(
						{ job: job("notice-classify-one", "pending", null) },
						{ status: 201 },
					);
				}
				if (url.pathname === "/api/ops/notice-pipeline/jobs") {
					return Response.json({
						jobs: [job("notice-sync", "succeeded", { noticesProcessed: 8, objectsWritten: 8 })],
					});
				}
				return new Response(null, { status: 404 });
			}),
		);

		render(<OpsWebApp initialPath="/notice-pipeline" />);

		expect(await screen.findByRole("heading", { name: "通知管线" })).toBeInTheDocument();
		expect(await screen.findByText("noticesProcessed: 8 · objectsWritten: 8")).toBeInTheDocument();
		fireEvent.change(screen.getByRole("spinbutton", { name: "分类通知 ID" }), {
			target: { value: "354516" },
		});
		fireEvent.click(screen.getByRole("button", { name: "分类这一条" }));

		await waitFor(() =>
			expect(requests).toContainEqual({ noticeId: 354516, operation: "notice-classify-one" }),
		);
	});
});

function job(
	operation: "notice-sync" | "notice-classify-one",
	status: "pending" | "succeeded",
	summary: Record<string, number> | null,
) {
	return {
		completedAt: status === "succeeded" ? "2026-08-23T10:01:00.000Z" : null,
		createdAt: "2026-08-23T10:00:00.000Z",
		error: null,
		jobName: `${operation}-abc12`,
		operation,
		startedAt: "2026-08-23T10:00:01.000Z",
		status,
		summary,
	};
}
