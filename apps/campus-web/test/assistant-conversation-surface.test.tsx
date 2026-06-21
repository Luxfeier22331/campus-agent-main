import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AssistantConversationSurface } from "../src/components/conversation/assistant-conversation-surface";

vi.mock("../src/components/assistant-ui/thread", () => ({
	Thread: () => <div data-testid="official-assistant-ui-thread" />,
}));

describe("AssistantConversationSurface", () => {
	it("mounts the assistant-ui Thread without owning message or composer primitives", () => {
		render(<AssistantConversationSurface />);

		expect(screen.getByRole("region", { name: "校园问答" })).toBeInTheDocument();
		expect(screen.getByTestId("official-assistant-ui-thread")).toBeInTheDocument();
	});
});
