import {
	AssistantRuntimeProvider,
	type ChatModelAdapter,
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

const RunStatusRuntimeProvider: FC<PropsWithChildren> = ({ children }) => {
	const runtime = useLocalRuntime(noOpAdapter, {
		initialMessages: [
			{
				content: [{ text: "完整回答", type: "text" }],
				metadata: {
					custom: {
						campusRequest: {
							acceptedAt: "2026-08-18T07:00:00.000Z",
							completedAt: "2026-08-18T07:00:05.000Z",
							connection: "live",
							durationMs: 5_000,
							phase: "finalizing",
							provisional: false,
							requestId: "req_accessibility",
							sequence: 8,
							startedAt: "2026-08-18T07:00:01.000Z",
							status: "completed",
						},
					},
				},
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

	it("renders stable run metadata through the real assistant-ui selector", async () => {
		render(
			<RunStatusRuntimeProvider>
				<Thread />
			</RunStatusRuntimeProvider>,
		);

		const progress = await screen.findByRole("region", { name: "回答进度" });
		const answer = await screen.findByText("完整回答");

		expect(progress).toBeInTheDocument();
		expect(screen.getByText("回答过程")).toBeInTheDocument();
		expect(screen.queryByText("回答完成")).not.toBeInTheDocument();
		expect(screen.getByText("5秒")).toBeInTheDocument();
		expect(
			progress.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});
});
