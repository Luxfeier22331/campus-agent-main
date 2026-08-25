import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpsWebApp } from "../src/app/ops-web-app";

describe("notice maintenance page", () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("lists notices and starts a fixed single-notice classification job", async () => {
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
					return Response.json({ job: job() }, { status: 201 });
				}
				if (url.pathname === "/api/ops/notices/jobs") {
					return Response.json({ jobs: [] });
				}
				if (url.pathname === "/api/ops/notices/354516") {
					return Response.json({ notice: notice() });
				}
				if (url.pathname === "/api/ops/notices") {
					return Response.json({ items: [notice()], page: 1, totalItems: 1, totalPages: 1 });
				}
				return new Response(null, { status: 404 });
			}),
		);

		render(<OpsWebApp initialPath="/notices" />);

		expect(await screen.findByRole("heading", { name: "通知维护" })).toBeInTheDocument();
		expect(await screen.findByText("尚无分类结果")).toBeInTheDocument();
		fireEvent.click((await screen.findAllByText("测试通知"))[0] as HTMLElement);
		expect(await screen.findByRole("option", { name: "请选择分类" })).toBeInTheDocument();
		fireEvent.click(await screen.findByRole("button", { name: "使用模型分类" }));
		await waitFor(() =>
			expect(requests).toContainEqual({ noticeId: 354516, operation: "notice-classify-one" }),
		);
	});

	it.each(["succeeded", "failed"] as const)(
		"refreshes the notice list and open detail when a job enters %s",
		async (terminalStatus) => {
			vi.useFakeTimers({ shouldAdvanceTime: true });
			let jobFinished = false;
			let jobsRequests = 0;
			let noticesRequests = 0;
			let detailRequests = 0;
			vi.stubGlobal(
				"fetch",
				vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
					const url = new URL(
						typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
						"https://ops.example.test",
					);
					if (url.pathname === "/api/ops/notices/jobs") {
						jobsRequests += 1;
						return Response.json({
							jobs: jobFinished
								? [
										job({
											completedAt: "2026-08-23T10:01:00.000Z",
											error: terminalStatus === "failed" ? "任务执行失败" : null,
											jobName: "notice-classify-one-active",
											status: terminalStatus,
											summary: terminalStatus === "succeeded" ? { classified: 1 } : null,
										}),
										job({ jobName: "notice-publish-pending-active", status: "running" }),
									]
								: [
										job({ jobName: "notice-classify-one-active", status: "running" }),
										job({ jobName: "notice-publish-pending-active", status: "pending" }),
									],
						});
					}
					if (url.pathname === "/api/ops/notices/354516") {
						detailRequests += 1;
						return Response.json({
							notice: jobFinished
								? notice({ category: "campus_operations", state: "needs_publication" })
								: notice(),
						});
					}
					if (url.pathname === "/api/ops/notices") {
						noticesRequests += 1;
						return Response.json({
							items: [
								jobFinished
									? notice({ category: "campus_operations", state: "needs_publication" })
									: notice(),
							],
							page: 1,
							totalItems: 1,
							totalPages: 1,
						});
					}
					if (init?.method === "POST") {
						return Response.json({ job: job() }, { status: 201 });
					}
					return new Response(null, { status: 404 });
				}),
			);

			render(<OpsWebApp initialPath="/notices" />);

			expect(await screen.findByRole("heading", { name: "通知维护" })).toBeInTheDocument();
			expect(await screen.findByText("尚无分类结果")).toBeInTheDocument();
			fireEvent.click((await screen.findAllByText("测试通知"))[0] as HTMLElement);
			expect(await screen.findByRole("option", { name: "请选择分类" })).toBeInTheDocument();

			jobFinished = true;
			await vi.advanceTimersByTimeAsync(3_000);
			await waitFor(() => {
				expect(jobsRequests).toBeGreaterThan(1);
				expect(noticesRequests).toBeGreaterThan(1);
				expect(detailRequests).toBeGreaterThan(1);
			});
			expect(screen.getAllByText("校园服务与运行").length).toBeGreaterThan(0);
			expect(screen.getAllByText("待发布").length).toBeGreaterThan(0);
			if (terminalStatus === "failed") {
				expect(screen.getByText("任务执行失败")).toBeInTheDocument();
			}
		},
	);
});

function notice(overrides: Record<string, unknown> = {}) {
	return {
		category: null,
		externalUrl: null,
		isExternal: false,
		noticeId: 354516,
		noticeType: { id: 5, name: "办公通知" },
		organization: { id: "org-1", name: "教务处" },
		releasedAt: "2026-08-23T10:00:00.000Z",
		state: "needs_classification",
		title: "测试通知",
		...overrides,
	};
}

function job(overrides: Record<string, unknown> = {}) {
	return {
		completedAt: null,
		createdAt: "2026-08-23T10:00:00.000Z",
		error: null,
		jobName: "notice-classify-one-abc12",
		operation: "notice-classify-one",
		startedAt: null,
		status: "pending",
		summary: null,
		...overrides,
	};
}
