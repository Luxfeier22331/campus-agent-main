import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TasksPage } from "../src/app/tasks-page";

const task = {
	id: "notice-classifier",
	label: "通知分类",
	runtime: "kubernetes",
	canSchedule: true,
	canRun: true,
	enabled: false,
	intervalMinutes: 15,
	schedule: "*/15 * * * *",
	running: false,
	problemCount: 2,
	runs: [],
	error: null,
};
beforeEach(() => {
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {
				/* jsdom does not measure layout. */
			}
			unobserve() {
				/* jsdom does not measure layout. */
			}
			disconnect() {
				/* jsdom does not measure layout. */
			}
		},
	);
});
describe("tasks page", () => {
	it("keeps separate rows for multiple runs with the same workflow ID", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({
					tasks: [
						{
							...task,
							id: "notice-pipeline",
							runtime: "temporal",
							runs: ["first", "second"].map((id) => ({
								id,
								runId: id,
								workflowId: "notice-pipeline-workflow",
								startedAt: id,
								status: "completed",
								outcome: "success",
								details: { collection: id },
							})),
						},
					],
				}),
			),
		);
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		const view = render(
			<QueryClientProvider client={client}>
				<TasksPage />
			</QueryClientProvider>,
		);
		await screen.findByText(/first · completed/);
		expect(screen.getByText(/second · completed/)).toBeTruthy();
		expect(view.container.querySelectorAll("details")).toHaveLength(2);
		client.clear();
	});
	it("retains operator draft on failed save and displays persistent problems", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_url, init) =>
				init?.method === "PUT"
					? Response.json({ message: "patch denied" }, { status: 503 })
					: Response.json({ tasks: [task] }),
			),
		);
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
		});
		render(
			<QueryClientProvider client={client}>
				<TasksPage />
			</QueryClientProvider>,
		);
		await screen.findByText(/待处理问题：2/);
		fireEvent.click(screen.getByRole("checkbox"));
		fireEvent.change(screen.getByRole("combobox"), { target: { value: "30" } });
		fireEvent.click(screen.getByText("保存设置"));
		await screen.findByText("patch denied");
		expect(screen.getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
		expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("30");
		await waitFor(() => expect(screen.getByText(/已暂停/)).toBeTruthy());
		client.clear();
	});
});
