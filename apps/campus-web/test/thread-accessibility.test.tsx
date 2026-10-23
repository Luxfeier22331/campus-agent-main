import {
	AssistantRuntimeProvider,
	type ChatModelAdapter,
	type ThreadMessageLike,
	useExternalStoreRuntime,
	useLocalRuntime,
} from "@assistant-ui/react";
import { render, screen } from "@testing-library/react";
import type { FC, PropsWithChildren } from "react";
import { describe, expect, it } from "vitest";

import { Thread } from "../src/components/assistant-ui/thread";

const noOpAdapter: ChatModelAdapter = {
	async run() {
		return { content: [] };
	},
};

const RuntimeProvider: FC<PropsWithChildren> = ({ children }) => {
	const runtime = useLocalRuntime(noOpAdapter, {
		initialMessages: [
			{
				content: [{ text: "完整回答", type: "text" }],
				role: "assistant",
				status: { reason: "stop", type: "complete" },
			},
		],
	});

	return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
};

describe("assistant thread accessibility", () => {
	it("keeps streamed messages out of the polite status announcer", async () => {
		render(
			<RuntimeProvider>
				<Thread components={{ AssistantMessage: () => <p>完整回答</p> }} />
			</RuntimeProvider>,
		);

		const answer = await screen.findByText("完整回答");
		const messageLog = screen.getByRole("log", { name: "对话消息" });
		const runStatus = screen.getByRole("status");

		expect(messageLog).toHaveAttribute("aria-live", "off");
		expect(messageLog).toContainElement(answer);
		expect(runStatus).toHaveAttribute("aria-atomic", "true");
		expect(runStatus).toHaveAttribute("aria-live", "polite");
		expect(runStatus).not.toContainElement(answer);
	});

	it("keeps completed messages free of runtime phase and timer UI", async () => {
		render(
			<RuntimeProvider>
				<Thread />
			</RuntimeProvider>,
		);

		await screen.findByText("完整回答");
		expect(screen.queryByRole("region", { name: "回答进度" })).not.toBeInTheDocument();
		expect(screen.queryByText("回答过程")).not.toBeInTheDocument();
		expect(screen.queryByText("5秒")).not.toBeInTheDocument();
	});
});

function RunningThread({
	running = true,
	retrieval,
	connection = "connected",
	text = "",
}: {
	running?: boolean;
	retrieval?: string;
	connection?: string;
	text?: string;
}) {
	const runtime = useExternalStoreRuntime({
		isRunning: running,
		convertMessage: (message: ThreadMessageLike) => message,
		extras: { connection, retrieval: retrieval ? { campus: retrieval } : undefined },
		messages: [
			{ id: "old-answer", role: "assistant", content: [{ type: "text", text: "上一轮回答" }] },
			{ id: "question", role: "user", content: [{ type: "text", text: "查询请假流程" }] },
			...(text
				? [
						{
							id: "answer",
							role: "assistant",
							content: [{ type: "text", text }],
						} as ThreadMessageLike,
					]
				: []),
		] as ThreadMessageLike[],
		onNew: async () => undefined,
		onCancel: async () => undefined,
	});
	return (
		<AssistantRuntimeProvider runtime={runtime}>
			<Thread />
		</AssistantRuntimeProvider>
	);
}

describe("active answer feedback", () => {
	it("places one waiting indicator in the current answer, updates retrieval, and removes it at completion", async () => {
		const { container, rerender } = render(<RunningThread />);
		const waiting = await screen.findByText("正在回答");
		expect(screen.getByRole("log")).toContainElement(waiting);
		expect(waiting.closest('[data-role="assistant"]')).toBe(
			container.querySelectorAll('[data-role="assistant"]')[1],
		);
		expect(container.querySelector(".aui-thread-composer-dock")).not.toContainElement(waiting);
		expect(container.querySelectorAll(".aui-thread-run-status")).toHaveLength(1);
		rerender(<RunningThread retrieval="started" />);
		expect(await screen.findByText("正在检索校内资料")).toBeVisible();
		expect(screen.queryByText("正在回答")).not.toBeInTheDocument();
		rerender(<RunningThread retrieval="completed" text="完整的新回答" />);
		expect(await screen.findByText("完整的新回答")).toBeVisible();
		expect(screen.getByText("已找到校内资料")).toBeVisible();
		rerender(<RunningThread running={false} text="完整的新回答" />);
		expect(container.querySelector(".aui-thread-run-status")).not.toBeInTheDocument();
		expect(screen.getByText("完整的新回答")).toBeVisible();
	});
	it("shows connection recovery in the current answer and clears it when the run stops", async () => {
		const { container, rerender } = render(<RunningThread connection="disconnected" />);
		expect(await screen.findByText("连接已断开")).toBeVisible();
		expect(screen.getByRole("button", { name: "恢复连接" })).toBeVisible();
		rerender(<RunningThread connection="recovering" />);
		expect(await screen.findByText("正在恢复连接")).toBeVisible();
		rerender(<RunningThread running={false} />);
		expect(container.querySelector(".aui-thread-run-status")).not.toBeInTheDocument();
	});
});
