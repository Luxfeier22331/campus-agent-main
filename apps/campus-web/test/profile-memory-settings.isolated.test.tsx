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
const auth = vi.hoisted(() => ({ userId: "user_1" }));

vi.mock("@/features/profile-memory/api", () => api);
vi.mock("@/platform/auth/session", () => ({
	useCampusSession: () => ({ data: { user: { id: auth.userId } } }),
}));

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

function renderSettings(
	queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
	return {
		queryClient,
		...render(
			<QueryClientProvider client={queryClient}>
				<ProfileMemorySettings />
			</QueryClientProvider>,
		),
	};
}

describe("profile memory settings", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		auth.userId = "user_1";
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

	it("uses a separate query cache entry after the authenticated user changes", async () => {
		api.getProfileMemory
			.mockResolvedValueOnce(state)
			.mockResolvedValueOnce({ ...state, items: [], itemCount: 0 });
		const view = renderSettings();
		expect(await screen.findByText("answer_style")).toBeInTheDocument();

		auth.userId = "user_2";
		view.rerender(
			<QueryClientProvider client={view.queryClient}>
				<ProfileMemorySettings />
			</QueryClientProvider>,
		);

		expect(await screen.findByText("还没有可管理的记忆")).toBeInTheDocument();
		expect(api.getProfileMemory).toHaveBeenCalledTimes(2);
	});

	it("submits the active item values after switching between editors", async () => {
		const secondItem = {
			...state.items[0],
			itemId: "mem_02",
			key: "major",
			value: "计算机科学",
		};
		api.getProfileMemory.mockResolvedValue({
			...state,
			itemCount: 2,
			items: [state.items[0], secondItem],
		});
		api.updateProfileMemoryItem.mockResolvedValue(state);
		const view = renderSettings();
		await screen.findByText("answer_style");

		fireEvent.click(screen.getAllByRole("button", { name: "编辑记忆" })[0]!);
		fireEvent.change(screen.getByLabelText("键名"), { target: { value: "临时键" } });
		fireEvent.change(screen.getByLabelText("内容"), { target: { value: "临时值" } });
		fireEvent.click(screen.getByRole("button", { name: "取消" }));

		view.rerender(
			<QueryClientProvider client={view.queryClient}>
				<ProfileMemorySettings />
			</QueryClientProvider>,
		);
		fireEvent.click(screen.getAllByRole("button", { name: "编辑记忆" })[1]!);
		expect(screen.getByLabelText("键名")).toHaveValue("major");
		expect(screen.getByLabelText("内容")).toHaveValue("计算机科学");
		expect(screen.getByLabelText("键名")).not.toHaveAttribute("maxlength");
		fireEvent.click(screen.getByRole("button", { name: "保存" }));

		await waitFor(() => expect(api.updateProfileMemoryItem).toHaveBeenCalled());
		expect(api.updateProfileMemoryItem.mock.calls[0]?.[0]).toEqual({
			itemId: "mem_02",
			key: "major",
			value: "计算机科学",
		});
	});

	it("allows retrying an erase that failed after entering the erasing lifecycle", async () => {
		const failedState = {
			...state,
			lifecycleState: "erasing" as const,
			syncStatus: "failed" as const,
		};
		api.getProfileMemory.mockResolvedValue(failedState);
		api.eraseProfileMemory.mockResolvedValue({
			...failedState,
			syncStatus: "pending" as const,
		});
		renderSettings();
		await screen.findByText("answer_style");

		expect(screen.getByText("同步失败")).toBeInTheDocument();
		expect(screen.queryByText("正在清除")).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: "清除全部记忆" })).toBeEnabled();

		fireEvent.click(screen.getByRole("button", { name: "清除全部记忆" }));
		fireEvent.click(screen.getByRole("button", { name: "确认清除" }));
		await waitFor(() => expect(api.eraseProfileMemory).toHaveBeenCalledTimes(1));
	});
});
