import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
	createProfileMemoryCorrection: vi.fn(),
	eraseProfileMemory: vi.fn(),
	getProfileMemory: vi.fn(),
	getProfileMemoryProfile: vi.fn(),
	retryProfileMemoryOperation: vi.fn(),
	setProfileMemoryEnabled: vi.fn(),
}));
const auth = vi.hoisted(() => ({ userId: "user_1" }));
vi.mock("@/features/profile-memory/api", () => api);
vi.mock("@/platform/auth/session", () => ({
	useCampusSession: () => ({ data: { user: { id: auth.userId } } }),
}));

import { ProfileMemorySettings } from "@/features/profile-memory/profile-memory-settings";

const state = { lifecycleState: "active", syncStatus: "synced", operations: [] };
const profile = {
	content: "偏好简洁的回答，先用中文交流。",
	generating: false,
	isStale: false,
	lastRefreshedAt: "2026-09-20T10:00:00Z",
};
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
	afterEach(() => vi.useRealTimers());
	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(window.matchMedia).mockImplementation((query) => ({
			matches: false,
			media: query,
			onchange: null,
			addListener: vi.fn(),
			removeListener: vi.fn(),
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			dispatchEvent: vi.fn(),
		}));
		auth.userId = "user_1";
		api.getProfileMemory.mockResolvedValue(state);
		api.getProfileMemoryProfile.mockResolvedValue(profile);
		for (const name of [
			"createProfileMemoryCorrection",
			"setProfileMemoryEnabled",
			"eraseProfileMemory",
			"retryProfileMemoryOperation",
		] as const) {
			api[name].mockResolvedValue({ commandId: "cmd", ...state });
		}
	});
	it("shows the synthesized profile and pauses without optimistic success", async () => {
		setup();
		expect(await screen.findByText("偏好简洁的回答，先用中文交流。")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("switch", { name: "启用个性化记忆" }));
		await waitFor(() =>
			expect(api.setProfileMemoryEnabled).toHaveBeenCalledWith(false, expect.anything()),
		);
		expect(screen.getByText("已启用")).toBeInTheDocument();
	});
	it("submits a natural-language correction", async () => {
		setup();
		await screen.findByText("偏好简洁的回答，先用中文交流。");
		fireEvent.change(screen.getByLabelText("纠正画像"), {
			target: { value: "我更偏好先看到结论" },
		});
		fireEvent.click(screen.getByRole("button", { name: "提交纠正" }));
		await waitFor(() =>
			expect(api.createProfileMemoryCorrection.mock.calls[0]?.[0]).toEqual({
				text: "我更偏好先看到结论",
			}),
		);
		expect(screen.getByLabelText("纠正画像")).toHaveValue("");
	});
	it("shows the generating state before the first profile exists", async () => {
		api.getProfileMemoryProfile.mockResolvedValue({
			content: "",
			generating: true,
			isStale: false,
			lastRefreshedAt: "",
		});
		setup();
		expect(await screen.findByText("画像生成中，完成后会自动显示。")).toBeInTheDocument();
	});
	it("renders headings, lists, emphasis and tables as Markdown", async () => {
		api.getProfileMemoryProfile.mockResolvedValue({
			...profile,
			content: "## 偏好\n\n- **简洁**\n\n| 项目 | 内容 |\n| --- | --- |\n| 语言 | 中文 |",
		});
		setup();
		expect(await screen.findByRole("heading", { name: "偏好" })).toBeInTheDocument();
		expect(screen.getByText("简洁").tagName).toBe("STRONG");
		expect(screen.getByRole("list")).toBeInTheDocument();
		expect(screen.getByRole("table")).toHaveTextContent("中文");
	});
	it("polls a generating profile and stops when it completes", async () => {
		vi.useFakeTimers();
		api.getProfileMemoryProfile
			.mockResolvedValueOnce({ ...profile, content: "", generating: true })
			.mockResolvedValue(profile);
		setup();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(100);
		});
		expect(screen.getByText("画像生成中，完成后会自动显示。")).toBeInTheDocument();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(2200);
		});
		expect(screen.getByText(profile.content)).toBeInTheDocument();
		expect(screen.queryByText("生成中")).not.toBeInTheDocument();
		const calls = api.getProfileMemoryProfile.mock.calls.length;
		await act(async () => {
			await vi.advanceTimersByTimeAsync(6000);
		});
		expect(api.getProfileMemoryProfile).toHaveBeenCalledTimes(calls);
	});
	it("stops polling after a generation read fails", async () => {
		vi.useFakeTimers();
		api.getProfileMemoryProfile
			.mockResolvedValueOnce({ ...profile, content: "", generating: true })
			.mockRejectedValue(new Error("refresh failed"));
		setup();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(2300);
		});
		expect(screen.getByText("无法读取画像")).toBeInTheDocument();
		const calls = api.getProfileMemoryProfile.mock.calls.length;
		await act(async () => {
			await vi.advanceTimersByTimeAsync(6000);
		});
		expect(api.getProfileMemoryProfile).toHaveBeenCalledTimes(calls);
	});
	it("keeps lifecycle controls usable when profile reads fail", async () => {
		api.getProfileMemoryProfile.mockRejectedValue(new Error("provider offline"));
		setup();
		expect(await screen.findByText("无法读取画像")).toBeInTheDocument();
		expect(screen.getByRole("switch", { name: "启用个性化记忆" })).toBeEnabled();
	});
	it("shows the erased state without reading the profile", async () => {
		api.getProfileMemory.mockResolvedValue({ ...state, lifecycleState: "erased" });
		setup();
		expect(await screen.findByText("记忆已清除，画像为空。")).toBeInTheDocument();
		expect(api.getProfileMemoryProfile).not.toHaveBeenCalled();
	});
	it("requires confirmation and can retry a failed erase", async () => {
		api.getProfileMemory.mockResolvedValue({
			...state,
			lifecycleState: "erased",
			syncStatus: "failed",
		});
		setup();
		await screen.findByText("记忆已清除，画像为空。");
		fireEvent.click(screen.getByRole("button", { name: "清除全部记忆" }));
		expect(api.eraseProfileMemory).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "确认清除" }));
		await waitFor(() => expect(api.eraseProfileMemory).toHaveBeenCalledTimes(1));
	});
	it("clears previous-user content and cache when the account changes", async () => {
		const view = setup();
		await screen.findByText("偏好简洁的回答，先用中文交流。");
		auth.userId = "user_2";
		view.rerender(
			<QueryClientProvider client={view.client}>
				<ProfileMemorySettings />
			</QueryClientProvider>,
		);
		await waitFor(() =>
			expect(api.getProfileMemoryProfile.mock.calls.at(-1)?.length).toBeDefined(),
		);
		expect(view.client.getQueriesData({ queryKey: ["profile-memory", "user_1"] })).toEqual([]);
	});
});
