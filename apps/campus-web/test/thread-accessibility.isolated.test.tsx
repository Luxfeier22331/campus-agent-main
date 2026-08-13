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
				content: "完整回答",
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
});
