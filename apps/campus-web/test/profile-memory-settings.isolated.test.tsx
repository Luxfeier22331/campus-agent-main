import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
	createProfileMemoryItem: vi.fn(),
	deleteProfileMemoryItem: vi.fn(),
	eraseProfileMemory: vi.fn(),
	getProfileMemory: vi.fn(),
	setProfileMemoryEnabled: vi.fn(),
	updateProfileMemoryItem: vi.fn(),
}));

vi.mock("@/features/profile-memory/api", () => api);

import { ProfileMemorySettings } from "@/features/profile-memory/profile-memory-settings";

const state = {
	itemCount: 1,
	items: [
		{
			itemId: "mem_01",
			key: "answer_style",
			revision: 1,
			state: "synced",
			updatedAt: "2026-07-14T00:00:00Z",
			value: "先给结论",
		},
	],
	lifecycleState: "active",
	syncStatus: "synced",
} as const;

function renderSettings() {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={queryClient}>
			<ProfileMemorySettings />
		</QueryClientProvider>,
	);
}

describe("profile memory settings", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		api.getProfileMemory.mockResolvedValue(state);
		api.setProfileMemoryEnabled.mockResolvedValue({
			...state,
			lifecycleState: "paused",
			syncStatus: "pending",
		});
	});

	it("renders durable memory state and pauses without optimistic success", async () => {
		renderSettings();
		expect(await screen.findByText("answer_style")).toBeInTheDocument();
		expect(screen.getByText("先给结论")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("switch", { name: "启用个性化记忆" }));
		await waitFor(() => expect(api.setProfileMemoryEnabled.mock.calls[0]?.[0]).toBe(false));
		expect(screen.getByText("已启用")).toBeInTheDocument();
	});

	it("requires explicit confirmation before erase", async () => {
		renderSettings();
		await screen.findByText("answer_style");
		fireEvent.click(screen.getByRole("button", { name: "清除全部记忆" }));
		expect(screen.getByRole("heading", { name: "确认清除全部记忆？" })).toBeInTheDocument();
		expect(api.eraseProfileMemory).not.toHaveBeenCalled();
	});
});
