import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatConversationPage } from "../src/app/chat-conversation-page";
import { ConversationsPage } from "../src/app/conversations-page";

const at = "2026-09-14T00:00:00.000Z";
const row = {
	id: "conv-1",
	title: "测试会话",
	owner: { id: "owner", email: "owner@example.test", displayName: null },
	createdAt: at,
	updatedAt: at,
	messageCount: 0,
	turnCount: 1,
	latestQuestionPreview: "问题",
	latestAnswerPreview: null,
	latestRequestId: "req-1",
	latestStatus: "RUNNING",
	hasFailures: false,
	hasFeedback: false,
};

async function openPage(
	path = "/conversations",
	owner: { id: string; email: string | null; displayName: string | null } = row.owner,
) {
	const urls: URL[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string) => {
			const url = new URL(input, "https://ops.example.test");
			if (url.pathname.endsWith("/conv-1")) {
				return Response.json({
					id: "conv-1",
					title: "测试会话",
					createdAt: at,
					updatedAt: at,
					activeRequestId: null,
					messages: [],
				});
			}
			urls.push(url);
			return Response.json({
				data: [{ ...row, owner }],
				page: { nextCursor: "next" },
				generatedAt: at,
				filters: { from: url.searchParams.get("from"), to: url.searchParams.get("to") },
			});
		}),
	);
	const root = createRootRoute({ component: Outlet });
	const list = createRoute({
		getParentRoute: () => root,
		path: "/conversations",
		validateSearch: (search: Record<string, unknown>) => search,
		component: () => <ConversationsPage search={list.useSearch()} />,
	});
	const detail = createRoute({
		getParentRoute: () => root,
		path: "/conversations/$conversationId",
		validateSearch: (search: Record<string, unknown>) => ({
			from: typeof search.from === "string" ? search.from : undefined,
		}),
		component: () => (
			<ChatConversationPage
				conversationId={detail.useParams().conversationId}
				from={detail.useSearch().from}
			/>
		),
	});
	const history = createMemoryHistory({ initialEntries: [path] });
	const router = createRouter({ routeTree: root.addChildren([list, detail]), history });
	const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
	render(
		<QueryClientProvider client={client}>
			<RouterProvider router={router} />
		</QueryClientProvider>,
	);
	await screen.findByRole("heading", { name: "历史会话" });
	return { history, urls };
}

function change(label: string, value: string) {
	fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
function submit() {
	fireEvent.click(screen.getByRole("button", { name: "搜索" }));
}

afterEach(() => vi.unstubAllEnvs());

describe("conversation filters", () => {
	it("shortens an unresolved owner while retaining the full ID in the title", async () => {
		await openPage("/conversations", {
			id: "anonymous-owner-123456789",
			email: null,
			displayName: null,
		});
		expect(await screen.findByText("用户：anonym...6789")).toHaveAttribute(
			"title",
			"anonymous-owner-123456789",
		);
	});
	it("applies drafts only on submit and clears both fields and pagination", async () => {
		const { urls } = await openPage("/conversations?cursor=previous");
		const before = urls.length;
		change("搜索会话", "奖学金");
		change("搜索用户", "  学生@example.test  ");
		change("最新一轮状态", "RUNNING");
		change("反馈状态", "WITH_FEEDBACK");
		change("包含失败请求", "false");
		change("时间范围", "custom");
		change("开始日期", "2026-09-14");
		change("结束日期", "2026-09-14");
		expect(urls).toHaveLength(before);
		fireEvent.click(screen.getByRole("button", { name: "应用日期" }));
		await waitFor(() => expect(urls.at(-1)?.searchParams.has("from")).toBe(true));
		expect(urls.at(-1)?.searchParams.has("q")).toBe(false);
		expect(screen.getByLabelText("搜索会话")).toHaveValue("奖学金");
		submit();
		await waitFor(() => expect(urls.at(-1)?.searchParams.get("q")).toBe("奖学金"));
		expect(Object.fromEntries(urls.at(-1)?.searchParams ?? [])).toMatchObject({
			status: "RUNNING",
			ownerQuery: "学生@example.test",
			feedback: "WITH_FEEDBACK",
			hasFailures: "false",
			from: "2026-09-13T16:00:00.000Z",
			to: "2026-09-14T16:00:00.000Z",
		});
		expect(urls.at(-1)?.searchParams.has("cursor")).toBe(false);
		fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
		await waitFor(() => expect(urls.at(-1)?.search).toBe(""));
		for (const label of ["搜索用户", "搜索会话", "最新一轮状态", "反馈状态", "包含失败请求"]) {
			expect(screen.getByLabelText(label)).toHaveValue("");
		}
		submit();
		expect(urls.at(-1)?.search).toBe("");
	});

	it("keeps user search across pagination and reading, removes it independently", async () => {
		const { urls, history } = await openPage(
			"/conversations?ownerQuery=Alice&q=materials&window=30d",
		);
		await waitFor(() => expect(urls.at(-1)?.searchParams.get("ownerQuery")).toBe("Alice"));
		fireEvent.click(await screen.findByRole("link", { name: "测试会话" }));
		await screen.findByRole("heading", { name: "测试会话" });
		expect(new URLSearchParams(history.location.search).get("ownerQuery")).toBe("Alice");
		fireEvent.click(screen.getByRole("button", { name: "返回历史会话" }));
		fireEvent.click(await screen.findByRole("button", { name: "下一页" }));
		await waitFor(() => expect(urls.at(-1)?.searchParams.get("cursor")).toBe("next"));
		expect(urls.at(-1)?.searchParams.get("ownerQuery")).toBe("Alice");
		fireEvent.click(screen.getByRole("button", { name: "移除用户筛选" }));
		await waitFor(() => expect(urls.at(-1)?.searchParams.has("ownerQuery")).toBe(false));
		expect(urls.at(-1)?.searchParams.has("cursor")).toBe(false);
		expect(urls.at(-1)?.searchParams.get("q")).toBe("materials");
		expect(screen.getByLabelText("搜索用户")).toHaveValue("");
	});

	it("restores applied fields on back and forward and retains drafts on refresh", async () => {
		const { history, urls } = await openPage();
		change("搜索会话", "first");
		submit();
		await waitFor(() => expect(urls.at(-1)?.searchParams.get("q")).toBe("first"));
		change("搜索会话", "second");
		change("包含失败请求", "false");
		submit();
		await waitFor(() => expect(urls.at(-1)?.searchParams.get("q")).toBe("second"));
		await act(async () => history.back());
		await waitFor(() => expect(screen.getByLabelText("搜索会话")).toHaveValue("first"));
		expect(screen.getByLabelText("包含失败请求")).toHaveValue("");
		await act(async () => history.forward());
		await waitFor(() => expect(screen.getByLabelText("搜索会话")).toHaveValue("second"));
		expect(screen.getByLabelText("包含失败请求")).toHaveValue("false");
		change("搜索会话", "unsaved");
		const before = urls.length;
		fireEvent.click(screen.getByRole("button", { name: "刷新历史会话" }));
		await waitFor(() => expect(urls.length).toBeGreaterThan(before));
		expect(screen.getByLabelText("搜索会话")).toHaveValue("unsaved");
		expect(urls.at(-1)?.searchParams.get("q")).toBe("second");
	});

	it("applies presets immediately and waits for explicit custom date confirmation", async () => {
		const { urls } = await openPage();
		change("搜索会话", "unsaved");
		change("时间范围", "this-week");
		await waitFor(() => expect(urls.at(-1)?.searchParams.get("window")).toBe("this-week"));
		expect(urls.at(-1)?.searchParams.has("q")).toBe(false);
		expect(screen.getByLabelText("搜索会话")).toHaveValue("unsaved");
		change("时间范围", "custom");
		change("开始日期", "2026-09-14");
		change("结束日期", "2026-09-14");
		expect(urls.at(-1)?.searchParams.get("window")).toBe("this-week");
		fireEvent.click(screen.getByRole("button", { name: "应用日期" }));
		await waitFor(() =>
			expect(urls.at(-1)?.searchParams.get("from")).toBe("2026-09-13T16:00:00.000Z"),
		);
		expect(urls.at(-1)?.searchParams.get("to")).toBe("2026-09-14T16:00:00.000Z");
		expect(urls.at(-1)?.searchParams.has("window")).toBe(false);
	});

	it("restores window from URL search", async () => {
		const { urls } = await openPage("/conversations?window=30d");
		expect(screen.getByLabelText("时间范围")).toHaveValue("30d");
		await waitFor(() => expect(urls.at(-1)?.searchParams.get("window")).toBe("30d"));
	});

	it.each(["2026-09-14", "2026-10-01", "2027-01-01"])(
		"round-trips Beijing date %s through detail navigation outside China",
		async (date) => {
			vi.stubEnv("TZ", "America/Los_Angeles");
			const from = new Date(`${date}T00:00:00.000+08:00`).toISOString();
			const to = new Date(`${date}T23:59:59.999+08:00`).toISOString();
			const { history, urls } = await openPage(
				`/conversations?${new URLSearchParams({ from, to })}`,
			);
			expect(screen.getByLabelText("开始日期")).toHaveValue(date);
			expect(screen.getByLabelText("结束日期")).toHaveValue(date);
			fireEvent.click(await screen.findByRole("link", { name: "测试会话" }));
			await screen.findByRole("heading", { name: "测试会话" });
			expect(history.location.search).toContain("conversationId=conv-1");
			expect(new URLSearchParams(history.location.search).get("from")).toBe(from);
			await act(async () => history.back());
			await screen.findByRole("heading", { name: "历史会话" });
			expect(screen.getByLabelText("开始日期")).toHaveValue(date);
			submit();
			expect(urls.at(-1)?.searchParams.get("from")).toBe(from);
			expect(urls.at(-1)?.searchParams.get("to")).toBe(to);
		},
	);
});
