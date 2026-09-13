import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
	createProfileMemoryItem: vi.fn(),
	eraseProfileMemory: vi.fn(),
	getProfileMemory: vi.fn(),
	getProfileMemoryItem: vi.fn(),
	listProfileMemories: vi.fn(),
	retryProfileMemoryOperation: vi.fn(),
	setProfileMemoryEnabled: vi.fn(),
	updateProfileMemoryItem: vi.fn(),
}));
const auth = vi.hoisted(() => ({ userId: "user_1" }));
vi.mock("@/features/profile-memory/api", () => api);
vi.mock("@/platform/auth/session", () => ({
	useCampusSession: () => ({ data: { user: { id: auth.userId } } }),
}));

import { ProfileMemorySettings } from "@/features/profile-memory/profile-memory-settings";

const fact = {
	memoryId: "fact1",
	text: "先给结论",
	kind: "fact",
	state: "active",
	origin: "conversation",
	mentionedAt: null,
	editedAt: null,
};
const state = { lifecycleState: "active", syncStatus: "synced", operations: [] };
const page = { items: [fact], total: 1, limit: 20, offset: 0 };
function setup() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return {
		client,
		...render(
			<QueryClientProvider client={client}>
				<ProfileMemorySettings />
			</QueryClientProvider>,
		),
	};
}
describe("native memory management", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		auth.userId = "user_1";
		api.getProfileMemory.mockResolvedValue(state);
		api.listProfileMemories.mockResolvedValue(page);
		api.getProfileMemoryItem.mockResolvedValue(fact);
		for (const name of [
			"createProfileMemoryItem",
			"updateProfileMemoryItem",
			"setProfileMemoryEnabled",
			"eraseProfileMemory",
			"retryProfileMemoryOperation",
		] as const) {
			api[name].mockResolvedValue({ commandId: "cmd", ...state });
		}
	});
	it("shows automatically retained memories and pauses without optimistic success", async () => {
		setup();
		expect(await screen.findByText("先给结论")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("switch", { name: "启用个性化记忆" }));
		await waitFor(() =>
			expect(api.setProfileMemoryEnabled).toHaveBeenCalledWith(false, expect.anything()),
		);
		expect(screen.getByText("已启用")).toBeInTheDocument();
	});
	it("saves the edited natural-language text", async () => {
		setup();
		await screen.findByText("先给结论");
		fireEvent.click(screen.getByRole("button", { name: "编辑记忆" }));
		fireEvent.change(screen.getByLabelText("内容"), { target: { value: "请先列出步骤" } });
		fireEvent.click(screen.getByRole("button", { name: "保存" }));
		await waitFor(() =>
			expect(api.updateProfileMemoryItem.mock.calls[0]?.[0]).toEqual({
				memoryId: "fact1",
				text: "请先列出步骤",
			}),
		);
	});
	it("deactivates and offers restoration through the inactive filter", async () => {
		setup();
		await screen.findByText("先给结论");
		fireEvent.click(screen.getByRole("button", { name: "停用" }));
		await waitFor(() =>
			expect(api.updateProfileMemoryItem.mock.calls[0]?.[0]).toEqual({
				memoryId: "fact1",
				state: "inactive",
			}),
		);
		api.listProfileMemories.mockResolvedValue({ ...page, items: [{ ...fact, state: "inactive" }] });
		fireEvent.change(screen.getByLabelText("记忆状态"), { target: { value: "inactive" } });
		fireEvent.click(await screen.findByRole("button", { name: "恢复" }));
		await waitFor(() =>
			expect(api.updateProfileMemoryItem.mock.calls.at(-1)?.[0]).toEqual({
				memoryId: "fact1",
				state: "active",
			}),
		);
	});
	it("shows derived memories as read-only and loads supporting facts on demand", async () => {
		const summary = {
			...fact,
			memoryId: "summary1",
			kind: "summary",
			origin: "derived",
			text: "喜欢简洁回答",
		};
		api.listProfileMemories.mockResolvedValue({ ...page, items: [summary] });
		api.getProfileMemoryItem.mockResolvedValue({ ...summary, sourceMemories: [fact] });
		setup();
		await screen.findByText("喜欢简洁回答");
		expect(screen.queryByRole("button", { name: "编辑记忆" })).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "查看支持事实" }));
		expect(await screen.findByText("先给结论")).toBeInTheDocument();
		expect(api.getProfileMemoryItem.mock.calls[0]?.[0]).toBe("summary1");
	});
	it("keeps lifecycle controls usable when bank reads fail", async () => {
		api.listProfileMemories.mockRejectedValue(new Error("provider offline"));
		setup();
		expect(await screen.findByText("无法读取记忆内容")).toBeInTheDocument();
		expect(screen.getByRole("switch", { name: "启用个性化记忆" })).toBeEnabled();
	});
	it("requires confirmation and can retry a failed erase", async () => {
		api.getProfileMemory.mockResolvedValue({
			...state,
			lifecycleState: "erasing",
			syncStatus: "failed",
		});
		setup();
		await screen.findByText("先给结论");
		fireEvent.click(screen.getByRole("button", { name: "清除全部记忆" }));
		expect(api.eraseProfileMemory).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "确认清除" }));
		await waitFor(() => expect(api.eraseProfileMemory).toHaveBeenCalledTimes(1));
	});
	it("clears previous-user content and cache when the account changes", async () => {
		const view = setup();
		await screen.findByText("先给结论");
		api.listProfileMemories.mockResolvedValue({ ...page, items: [], total: 0 });
		auth.userId = "user_2";
		view.rerender(
			<QueryClientProvider client={view.client}>
				<ProfileMemorySettings />
			</QueryClientProvider>,
		);
		await screen.findByText("没有匹配的记忆");
		expect(screen.queryByText("先给结论")).not.toBeInTheDocument();
		expect(view.client.getQueriesData({ queryKey: ["profile-memory", "user_1"] })).toEqual([]);
	});
});
