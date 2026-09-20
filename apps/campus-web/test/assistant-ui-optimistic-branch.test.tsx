// @vitest-environment jsdom

import {
	AssistantRuntimeProvider,
	BranchPickerPrimitive,
	type ThreadMessageLike,
	ThreadPrimitive,
	useExternalStoreRuntime,
} from "@assistant-ui/react";
import { act, render, screen } from "@testing-library/react";
import { type FC, useState } from "react";
import { describe, expect, it } from "vitest";

interface TestMessage {
	id: string;
	role: "assistant" | "user";
	text: string;
	optimistic?: boolean;
}

const convertMessage = (message: TestMessage): ThreadMessageLike => ({
	content: [{ text: message.text, type: "text" }],
	id: message.id,
	metadata: message.optimistic ? { isOptimistic: true } : undefined,
	role: message.role,
});

let replaceMessages: ((messages: TestMessage[]) => void) | undefined;
let updateMessages: ((isRunning: boolean, messages: TestMessage[]) => void) | undefined;

const AssistantMessage: FC = () => (
	<div data-testid="assistant-branch-count">
		<BranchPickerPrimitive.Count />
	</div>
);

const UserMessage: FC = () => (
	<div data-testid="user-branch-count">
		<BranchPickerPrimitive.Count />
	</div>
);

function Probe() {
	const [state, setState] = useState<{ isRunning: boolean; messages: TestMessage[] }>({
		isRunning: true,
		messages: [
			{ id: "local-user", optimistic: true, role: "user" as const, text: "hihi" },
			{
				id: "local-assistant",
				optimistic: true,
				role: "assistant" as const,
				text: "",
			},
		],
	});
	updateMessages = (isRunning, messages) => setState({ isRunning, messages });
	replaceMessages = (messages) => updateMessages?.(false, messages);
	const runtime = useExternalStoreRuntime({
		convertMessage,
		isRunning: state.isRunning,
		messages: state.messages,
		onNew: async () => undefined,
	});

	return (
		<AssistantRuntimeProvider runtime={runtime}>
			<ThreadPrimitive.MessageByIndex components={{ Message: UserMessage }} index={0} />
			<ThreadPrimitive.MessageByIndex components={{ Message: AssistantMessage }} index={1} />
		</AssistantRuntimeProvider>
	);
}

describe("assistant-ui optimistic message reconciliation", () => {
	it("does not retain a failed provisional assistant as a second branch", async () => {
		render(<Probe />);
		expect(screen.getByTestId("assistant-branch-count").textContent).toBe("1");
		expect(screen.getByTestId("user-branch-count").textContent).toBe("1");

		await act(async () => {
			replaceMessages?.([
				{ id: "user", role: "user", text: "hihi" },
				{ id: "local-error", role: "assistant", text: "回答连接已中断，请重试。" },
			]);
		});

		expect(screen.getByTestId("assistant-branch-count").textContent).toBe("1");
		expect(screen.getByTestId("user-branch-count").textContent).toBe("1");
	});

	it("keeps the canonical user and answer on one branch after streamed id migration", async () => {
		render(<Probe />);

		await act(async () => {
			updateMessages?.(true, [
				{ id: "local-user", optimistic: true, role: "user", text: "hihi" },
				{ id: "local-assistant", optimistic: true, role: "assistant", text: "hello" },
			]);
		});
		await act(async () => {
			updateMessages?.(false, [
				{ id: "user", role: "user", text: "hihi" },
				{ id: "answer", role: "assistant", text: "hello" },
			]);
		});

		expect(screen.getByTestId("user-branch-count").textContent).toBe("1");
		expect(screen.getByTestId("assistant-branch-count").textContent).toBe("1");
	});
});
