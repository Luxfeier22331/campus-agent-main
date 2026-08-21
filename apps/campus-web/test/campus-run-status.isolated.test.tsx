import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatRunStep } from "../src/features/conversation/run-client";
import type { CampusRunViewState } from "../src/features/conversation/run-view-state";

const testMocks = vi.hoisted(() => ({
	getRunSteps: vi.fn(),
	resumeRun: vi.fn(),
}));

vi.mock("@assistant-ui/react", () => ({
	useAui: () => ({ thread: { resumeRun: testMocks.resumeRun } }),
}));

vi.mock("../src/features/conversation/run-client", () => ({
	getRunSteps: testMocks.getRunSteps,
}));

import {
	CampusRunStatus,
	formatCampusRunTimestamp,
} from "../src/components/conversation/campus-run-status";
import {
	formatRunDuration,
	projectCampusRunSteps,
} from "../src/components/conversation/campus-run-steps";

const RUN: CampusRunViewState = {
	acceptedAt: "2026-08-18T07:00:00.000Z",
	completedAt: null,
	connection: "live",
	durationMs: 5_000,
	operationId: 1,
	phase: "retrieving",
	provisional: false,
	requestId: "req_01",
	runId: "run_01",
	sequence: 4,
	startedAt: "2026-08-18T07:00:01.000Z",
	status: "running",
};

const COMPLETED_RUN: CampusRunViewState = {
	...RUN,
	completedAt: "2026-08-18T07:00:05.000Z",
	phase: "finalizing",
	sequence: 8,
	status: "completed",
};

const FIVE_STEPS: ChatRunStep[] = (
	["queued", "preparing", "retrieving", "generating", "finalizing"] as const
).map((phase) => ({
	completedAt: null,
	durationMs: null,
	phase,
	startedAt: null,
	status: phase === "retrieving" ? "running" : "pending",
}));

describe("CampusRunStatus", () => {
	beforeEach(() => {
		testMocks.getRunSteps.mockReset();
		testMocks.resumeRun.mockReset();
		testMocks.resumeRun.mockResolvedValue(undefined);
	});

	it("formats timestamps and durations for the chat status surface", () => {
		const now = new Date("2026-06-18T12:30:00");

		expect(formatCampusRunTimestamp("2026-06-18T09:05:00", now)).toBe("09:05");
		expect(formatCampusRunTimestamp("2025-06-18T09:05:00", now)).toBe("2025年6月18日 09:05");
		expect(formatRunDuration(0)).toBe("<1秒");
		expect(formatRunDuration(65_000)).toBe("1分5秒");
	});

	it("projects the queued runtime fact into the preparing phase", () => {
		const steps = projectCampusRunSteps([
			{
				completedAt: "2026-08-18T07:00:01.000Z",
				durationMs: 1_000,
				phase: "queued",
				startedAt: "2026-08-18T07:00:00.000Z",
				status: "completed",
			},
			{
				completedAt: null,
				durationMs: null,
				phase: "preparing",
				startedAt: "2026-08-18T07:00:01.000Z",
				status: "running",
			},
		]);

		expect(steps).toEqual([
			{
				completedAt: null,
				durationMs: null,
				phase: "preparing",
				startedAt: "2026-08-18T07:00:00.000Z",
				status: "running",
			},
		]);
	});

	it("shows queued runs as one preparing-answer stage", () => {
		render(
			<CampusRunStatus
				run={{
					...RUN,
					phase: "queued",
					startedAt: null,
					status: "queued",
				}}
			/>,
		);

		expect(screen.getByText("正在准备回答")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: /查看回答过程/u }));
		expect(screen.getByRole("list", { name: "回答过程" })).toBeInTheDocument();
		expect(screen.getByText("准备回答")).toBeInTheDocument();
		expect(screen.queryByText("排队")).not.toBeInTheDocument();
	});

	it("shows one live phase by default without fetching process history", () => {
		render(<CampusRunStatus run={RUN} />);

		expect(testMocks.getRunSteps).not.toHaveBeenCalled();
		expect(screen.getByRole("region", { name: "回答进度" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /查看回答过程/u })).toHaveAttribute(
			"aria-expanded",
			"false",
		);
		expect(screen.getByText("正在查找校园资料")).toBeInTheDocument();
		expect(screen.queryByRole("list", { name: "回答过程" })).not.toBeInTheDocument();
		expect(screen.queryByText("排队")).not.toBeInTheDocument();
		expect(screen.queryByText("准备")).not.toBeInTheDocument();
		expect(screen.queryByText("生成回答")).not.toBeInTheDocument();
		expect(screen.queryByText("整理回答")).not.toBeInTheDocument();
	});

	it("loads precise phase history only after a completed process is opened", async () => {
		testMocks.getRunSteps.mockResolvedValue({ run: COMPLETED_RUN, steps: FIVE_STEPS });
		render(<CampusRunStatus run={COMPLETED_RUN} />);

		expect(screen.getByText("回答过程")).toBeInTheDocument();
		expect(screen.queryByText("回答完成")).not.toBeInTheDocument();
		expect(testMocks.getRunSteps).not.toHaveBeenCalled();
		expect(screen.queryByRole("list", { name: "回答过程" })).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: /查看回答过程/u }));
		await waitFor(() =>
			expect(testMocks.getRunSteps).toHaveBeenCalledWith({
				runId: "run_01",
				signal: expect.any(AbortSignal),
			}),
		);
		const process = await screen.findByRole("list", { name: "回答过程" });
		expect(process.querySelectorAll("li")).toHaveLength(4);
		expect(screen.getAllByText("准备回答")).toHaveLength(1);
		expect(screen.queryByText("排队")).not.toBeInTheDocument();
	});

	it("offers retry when the process disclosure fails to load", async () => {
		testMocks.getRunSteps
			.mockRejectedValueOnce(new Error("网络暂时不可用"))
			.mockResolvedValueOnce({ run: COMPLETED_RUN, steps: FIVE_STEPS });
		render(<CampusRunStatus run={COMPLETED_RUN} />);

		fireEvent.click(screen.getByRole("button", { name: /查看回答过程/u }));
		await screen.findByText("回答过程暂时无法加载。");
		fireEvent.click(screen.getByRole("button", { name: "重试加载回答过程" }));
		await waitFor(() => expect(testMocks.getRunSteps).toHaveBeenCalledTimes(2));
		await waitFor(() => expect(screen.getByRole("list", { name: "回答过程" })).toBeInTheDocument());
	});

	it("collapses the live timeline when the run completes", async () => {
		const { rerender } = render(<CampusRunStatus run={RUN} />);
		expect(screen.getByRole("button", { name: /查看回答过程/u })).toBeInTheDocument();

		rerender(<CampusRunStatus run={COMPLETED_RUN} />);

		await waitFor(() =>
			expect(screen.getByRole("button", { name: /查看回答过程/u })).toHaveAttribute(
				"aria-expanded",
				"false",
			),
		);
		expect(screen.queryByRole("list", { name: "回答过程" })).not.toBeInTheDocument();
	});

	it("reconnects a disconnected active run through assistant-ui", async () => {
		render(<CampusRunStatus run={{ ...RUN, connection: "disconnected" }} />);

		fireEvent.click(screen.getByRole("button", { name: "重新连接" }));
		await waitFor(() => expect(testMocks.resumeRun).toHaveBeenCalledWith({ parentId: null }));
	});
});
