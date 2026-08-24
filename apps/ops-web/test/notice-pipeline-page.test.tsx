import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpsWebApp } from "../src/app/ops-web-app";

describe("notice pipeline page", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("starts only the fixed notice operations and separates active jobs from history", async () => {
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
						jobs: [
							job("notice-classify-one", "running", null),
							job("notice-sync", "succeeded", {
								noticesProcessed: 8,
								objectsWritten: 8,
							}),
						],
					});
				}
				return new Response(null, { status: 404 });
			}),
		);

		render(<OpsWebApp initialPath="/notice-pipeline" />);

		expect(await screen.findByRole("heading", { name: "通知管线" })).toBeInTheDocument();
		const activeJobs = (await screen.findByRole("heading", { name: "活动任务" })).closest(
			"section",
		);
		const history = (await screen.findByRole("heading", { name: "历史结果" })).closest("section");
		expect(activeJobs).not.toBeNull();
		expect(history).not.toBeNull();
		expect(
			within(activeJobs as HTMLElement).getByText("notice-classify-one-abc12"),
		).toBeInTheDocument();
		expect(
			within(history as HTMLElement).getByText("noticesProcessed: 8 · objectsWritten: 8"),
		).toBeInTheDocument();
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
	status: "pending" | "running" | "succeeded" | "failed",
	summary: Record<string, number> | null,
) {
	return {
		completedAt: status === "succeeded" || status === "failed" ? "2026-08-23T10:01:00.000Z" : null,
		createdAt: "2026-08-23T10:00:00.000Z",
		error: null,
		jobName: `${operation}-abc12`,
		operation,
		startedAt: "2026-08-23T10:00:01.000Z",
		status,
		summary,
	};
}
