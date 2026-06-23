import { readFileSync } from "node:fs";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundPage, RootLayout } from "../src/app/root-layout";
import rootLayoutSource from "../src/app/root-layout.tsx?raw";
import { ConversationPage } from "../src/app/routes/conversation-page";
import { DiningPage } from "../src/app/routes/dining-page";
import diningPageSource from "../src/app/routes/dining-page.tsx?raw";
import { FeedbackPage } from "../src/app/routes/feedback-page";
import feedbackPageSource from "../src/app/routes/feedback-page.tsx?raw";
import { HomePage } from "../src/app/routes/home-page";
import homePageSource from "../src/app/routes/home-page.tsx?raw";
import authSource from "../src/components/auth/auth.tsx?raw";
import qaShellSource from "../src/components/conversation/qa-shell.tsx?raw";
import diningExperienceSource from "../src/components/dining/dining-experience.tsx?raw";
import mapExperienceSource from "../src/components/map/map-experience.tsx?raw";
import assistantRuntimeSource from "../src/features/conversation/assistant-ui-runtime.tsx?raw";
import { mockMapWorkspaceWidth } from "./map-page-test-utils";

const stylesSource = readFileSync("src/styles.css", "utf8");

const diningApiMock = vi.hoisted(() => ({
	getDiningFloor: vi.fn(),
	getDiningHalls: vi.fn(),
}));
const feedbackApiMock = vi.hoisted(() => ({
	submitFeedback: vi.fn(),
}));
const conversationApiMock = vi.hoisted(() => ({
	archiveConversation: vi.fn(),
	createConversationDraft: vi.fn(),
	deleteConversation: vi.fn(),
	getConversationDetail: vi.fn(),
	listConversations: vi.fn(),
	renameConversation: vi.fn(),
	unarchiveConversation: vi.fn(),
}));
const navigateMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/auth/user/user-button", () => ({
	UserButton: () => (
		<button aria-label="账号" type="button">
			账号
		</button>
	),
}));

vi.mock("@/components/auth/auth-ui-provider", () => ({
	CampusAuthUIProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@tanstack/react-router", async () => {
	const actual =
		await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
	return {
		...actual,
		Link: ({
			children,
			href,
			to,
			...props
		}: {
			children: React.ReactNode;
			href?: string;
			to?: string;
		}) => (
			<a href={href ?? to ?? "/"} {...props}>
				{children}
			</a>
		),
		Outlet: () => <div>支撑页面内容</div>,
		useParams: () => ({ conversationId: "conv_01" }),
		useLocation: () => ({
			hash: window.location.hash,
			pathname: window.location.pathname,
			search: Object.fromEntries(new URLSearchParams(window.location.search)),
		}),
		useNavigate: () => navigateMock,
	};
});

vi.mock("../src/features/conversation/api", () => ({
	archiveConversation: conversationApiMock.archiveConversation,
	createConversationDraft: conversationApiMock.createConversationDraft,
	deleteConversation: conversationApiMock.deleteConversation,
	getConversationDetail: conversationApiMock.getConversationDetail,
	listConversations: conversationApiMock.listConversations,
	renameConversation: conversationApiMock.renameConversation,
	unarchiveConversation: conversationApiMock.unarchiveConversation,
}));

vi.mock("../src/features/feedback/api", () => feedbackApiMock);

vi.mock("../src/features/dining/api", () => diningApiMock);

describe("campus routes", () => {
	beforeEach(() => {
		diningApiMock.getDiningHalls.mockReset();
		diningApiMock.getDiningFloor.mockReset();
		feedbackApiMock.submitFeedback.mockReset();
		feedbackApiMock.submitFeedback.mockResolvedValue({
			feedback: {
				feedbackId: "feedback_01",
				receivedAt: "2026-06-08T00:00:00.000Z",
			},
		});
		navigateMock.mockReset();
		conversationApiMock.archiveConversation.mockReset();
		conversationApiMock.createConversationDraft.mockReset();
		conversationApiMock.deleteConversation.mockReset();
		conversationApiMock.getConversationDetail.mockReset();
		conversationApiMock.getConversationDetail.mockResolvedValue({
			archivedAt: null,
			createdAt: "2026-06-21T01:00:00.000Z",
			id: "conv_01",
			messages: [],
			pinnedAt: null,
			title: "会话",
			updatedAt: "2026-06-21T01:00:00.000Z",
		});
		conversationApiMock.listConversations.mockReset();
		conversationApiMock.listConversations.mockImplementation(
			(input: { view?: "active" | "archived" } = {}) =>
				Promise.resolve(
					input.view === "archived"
						? [
								{
									archivedAt: "2026-06-21T02:00:00.000Z",
									createdAt: "2026-06-20T01:00:00.000Z",
									id: "conv_archived",
									pinnedAt: null,
									title: "已归档问题",
									updatedAt: "2026-06-20T02:00:00.000Z",
								},
							]
						: [
								{
									archivedAt: null,
									createdAt: "2026-06-21T01:00:00.000Z",
									id: "conv_active",
									pinnedAt: null,
									title: "国家奖学金",
									updatedAt: "2026-06-21T01:02:00.000Z",
								},
							],
				),
		);
		conversationApiMock.renameConversation.mockReset();
		conversationApiMock.unarchiveConversation.mockReset();
	});

	it("renders the assistant Q&A home shell without app launcher debt", async () => {
		render(<HomePage />);

		expect(await screen.findByText("中央民族大学校园问答")).toBeInTheDocument();
		expect(screen.getAllByText("新对话").length).toBeGreaterThanOrEqual(1);
		expect(screen.getByRole("button", { name: "新对话" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "搜索聊天" })).toBeNull();
		expect(screen.getByText("聊天记录")).toBeInTheDocument();
		expect(screen.queryByPlaceholderText("搜索历史会话")).toBeNull();
		expect(screen.getByRole("link", { name: "文档" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "校园地图" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "食堂" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "反馈" })).toBeInTheDocument();
		expect(await screen.findByTestId("assistant-chat")).toBeInTheDocument();
		expect(screen.getByPlaceholderText("输入校园问题")).toBeInTheDocument();
		expect(await screen.findByRole("button", { name: "账号" })).toBeInTheDocument();
		expect(screen.queryByText("需要了解哪件校园事？")).toBeNull();
		expect(screen.queryByText("校园卡")).toBeNull();
		expect(screen.queryByText("查饭堂")).toBeNull();
		expect(screen.queryByText("找地点")).toBeNull();
		expect(
			screen.queryByText("历史会话只用于找回之前的问题；文档、校园地图和食堂保留在顶部导航中。"),
		).toBeNull();
		expect(
			screen.queryByText("回答会在对话中给出，并在需要时打开文档、校园地图或食堂。"),
		).toBeNull();
		expect(screen.queryByText("登录后会在这里显示历史会话。")).toBeNull();
		expect(screen.queryByText("信息以原始来源和现场情况为准。")).toBeNull();
		expect(screen.queryByText("中央民族大学")).toBeNull();
		expect(screen.queryByText("民")).toBeNull();
		expect(screen.queryByText("校园助手")).toBeNull();
		expect(screen.queryByText("常用校园事务")).toBeNull();
		expect(screen.queryByText("问政策、查地点、看食堂，都从这里开始。")).toBeNull();
		expect(screen.queryByText("搜索地点、查询饭堂、查看办事指南，或直接向助手提问。")).toBeNull();
	});

	it("keeps Q&A shell source aligned with the v1.3 design map", () => {
		expect(homePageSource).not.toContain("appCards");
		expect(homePageSource).not.toContain("SupportCard");
		expect(homePageSource).not.toContain("常用校园事务");
		expect(homePageSource).not.toContain("rounded-full");
		expect(qaShellSource).toContain("食堂");
		expect(qaShellSource).not.toContain("饭堂分布图");
		expect(qaShellSource).toContain("ThreadListSidebar");
		expect(qaShellSource).toContain("@/components/assistant-ui/threadlist-sidebar");
		expect(qaShellSource).not.toContain("@assistant-ui/react-ui");
		expect(qaShellSource).not.toContain("@assistant-ui/react-data-stream");
		expect(qaShellSource).not.toContain("/api/chat/assistant-ui");
		expect(assistantRuntimeSource).toContain("useExternalStoreRuntime");
		expect(assistantRuntimeSource).toContain("submitChatRequestStream");
		expect(assistantRuntimeSource).not.toContain("@assistant-ui/react-data-stream");
		expect(assistantRuntimeSource).not.toContain("/api/chat/assistant-ui");
		expect(qaShellSource).toContain("@/components/auth/user/user-button");
		expect(qaShellSource).not.toContain("SupportNavigation");
		expect(qaShellSource).not.toContain("AccountLoginDialog");
		expect(qaShellSource).not.toContain("QAAccountEntry");
		expect(qaShellSource).not.toContain("getSessionPrincipal");
		expect(qaShellSource).not.toContain("const railActionClass");
		expect(qaShellSource).not.toContain("const railActionIconClass");
		expect(qaShellSource).not.toContain("const railActionShortcutClass");
		expect(qaShellSource).not.toContain("ChatKit 管理");
		expect(qaShellSource).not.toContain("ConversationSidebar");
		expect(qaShellSource).not.toContain("搜索历史会话");
		expect(stylesSource).toContain("@layer base");
		expect(stylesSource).toContain("font: inherit");
		expect(rootLayoutSource).not.toContain("移动端主导航");
	});

	it("does not register the canonical docs reader as a React route", () => {
		const routerSource = readFileSync("src/app/router.tsx", "utf8");

		expect(routerSource).not.toContain("DocsPage");
		expect(routerSource).not.toContain('path: "/docs"');
		expect(routerSource).not.toContain('path: "/docs/$"');
		expect(routerSource).not.toContain("./routes/docs-page");
	});

	it("keeps product pages on mature UI primitives instead of bespoke controls", () => {
		expect(feedbackPageSource).toContain("react-hook-form");
		expect(feedbackPageSource).toContain("zod");
		expect(feedbackPageSource).not.toContain("<select");
		expect(feedbackPageSource).not.toContain('type="submit"');
		expect(authSource).not.toContain("<input");
		expect(diningPageSource).not.toContain('role="tablist"');
		expect(mapExperienceSource).not.toContain("handleSearchKeyDown");
		expect(mapExperienceSource).not.toContain('role="dialog"');
		expect(mapExperienceSource).toContain("@/components/ui/command");
		expect(mapExperienceSource).toContain("@/components/ui/popover");
	});

	it("separates the account entry from the conversation history area", async () => {
		render(<HomePage />);

		expect(await screen.findByRole("button", { name: "账号" })).toBeInTheDocument();
		expect(screen.queryByRole("separator", { name: "账号区域" })).toBeNull();
	});

	it("keeps the desktop topbar inside the assistant content inset", async () => {
		render(<HomePage />);

		const assistantChat = await screen.findByTestId("assistant-chat");

		expect(within(assistantChat).getByText("中央民族大学校园问答")).toBeInTheDocument();
		expect(within(assistantChat).getByRole("region", { name: "校园问答" })).toBeInTheDocument();
		expect(within(assistantChat).queryByRole("heading", { name: "聊天记录" })).toBeNull();
	});

	it("keeps the sidebar free of local chat search", async () => {
		render(<HomePage />);

		const newConversationButton = await screen.findByRole("button", { name: "新对话" });

		expect(newConversationButton).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "搜索聊天" })).toBeNull();
		expect(screen.queryByPlaceholderText("搜索历史会话")).toBeNull();
	});

	it("keeps the mobile thread list scoped to conversation history", async () => {
		mockMapWorkspaceWidth(false, vi.fn);
		render(<HomePage />);

		fireEvent.click(screen.getByRole("button", { name: "打开聊天记录" }));
		const mobileMenu = screen.getByRole("dialog", { name: "聊天记录" });
		const closeMobileMenuButton = within(mobileMenu).getByRole("button", {
			name: "关闭聊天记录",
		});
		expect(closeMobileMenuButton).toBeInTheDocument();

		expect(within(mobileMenu).queryByRole("button", { name: "登录" })).toBeNull();
		expect(await within(mobileMenu).findByRole("button", { name: "国家奖学金" }));
		fireEvent.click(closeMobileMenuButton);
		expect(screen.queryByRole("button", { name: "关闭聊天记录" })).toBeNull();
	});

	it("does not wrap the map route in the generic support page header", () => {
		window.history.pushState({}, "", "/map");
		render(<RootLayout />);

		expect(screen.getByText("支撑页面内容")).toBeInTheDocument();
		expect(screen.queryByText("中央民族大学校园问答")).toBeNull();
		expect(screen.queryByText("MUC Campus Q&A")).toBeNull();
		expect(screen.queryByRole("link", { name: "文档" })).toBeNull();
		expect(screen.queryByRole("link", { name: "校园地图" })).toBeNull();
		expect(screen.queryByRole("link", { name: "食堂" })).toBeNull();
		expect(screen.queryByRole("link", { name: "反馈" })).toBeNull();
		expect(screen.queryByText("民")).toBeNull();
	});

	it("does not wrap account routes in the generic support page header", () => {
		window.history.pushState({}, "", "/account/login");
		render(<RootLayout />);

		expect(screen.getByText("支撑页面内容")).toBeInTheDocument();
		expect(screen.queryByText("中央民族大学校园问答")).toBeNull();
		expect(screen.queryByText("MUC Campus Q&A")).toBeNull();
		expect(screen.queryByRole("navigation", { name: "支撑页面导航" })).toBeNull();
		expect(screen.queryByRole("link", { name: "文档" })).toBeNull();
		expect(screen.queryByRole("link", { name: "校园地图" })).toBeNull();
		expect(screen.queryByRole("link", { name: "食堂" })).toBeNull();
		expect(screen.queryByRole("link", { name: "反馈" })).toBeNull();
	});

	it("keeps account UI provider out of the root shell bundle", () => {
		expect(rootLayoutSource).not.toContain("CampusAuthUIProvider");
		expect(rootLayoutSource).not.toContain("@/components/auth/auth-ui-provider");
	});

	it("does not wrap legal routes in the generic support page header", () => {
		window.history.pushState({}, "", "/legal/terms");
		render(<RootLayout />);

		expect(screen.getByText("支撑页面内容")).toBeInTheDocument();
		expect(screen.queryByText("中央民族大学校园问答")).toBeNull();
		expect(screen.queryByText("MUC Campus Q&A")).toBeNull();
		expect(screen.queryByRole("navigation", { name: "支撑页面导航" })).toBeNull();
		expect(screen.queryByRole("link", { name: "文档" })).toBeNull();
		expect(screen.queryByRole("link", { name: "校园地图" })).toBeNull();
		expect(screen.queryByRole("link", { name: "食堂" })).toBeNull();
		expect(screen.queryByRole("link", { name: "反馈" })).toBeNull();
	});

	it("keeps feedback navigation visible on non-map support pages", () => {
		window.history.pushState({}, "", "/feedback");
		render(<RootLayout />);

		expect(screen.getAllByRole("link", { name: "反馈" })).toHaveLength(2);
	});

	it("renders global feedback form", () => {
		render(<FeedbackPage />);

		expect(screen.getByRole("heading", { name: "反馈" })).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "提交反馈" })).toBeInTheDocument();
		expect(screen.getByLabelText("问题描述")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "提交反馈" })).toBeDisabled();
	});

	it("defaults feedback route context to the current route", () => {
		window.history.pushState({}, "", "/feedback?source=map");
		render(<FeedbackPage />);

		expect(screen.getByLabelText("当前页面")).toHaveValue("/feedback?source=map");
	});

	it("submits feedback with the current route context and shows received status", async () => {
		window.history.pushState({}, "", "/feedback?source=map");
		render(<FeedbackPage />);

		fireEvent.change(screen.getByLabelText("问题描述"), {
			target: { value: "地图地点名称需要更新。" },
		});
		fireEvent.click(screen.getByRole("button", { name: "提交反馈" }));

		expect(await screen.findByText("已收到：feedback_01")).toBeInTheDocument();
		expect(feedbackApiMock.submitFeedback).toHaveBeenCalledWith(
			expect.objectContaining({
				body: "地图地点名称需要更新。",
				routeContext: "/feedback?source=map",
			}),
		);
	});

	it("keeps dining floor rendering driven by the floor projection contract", () => {
		expect(diningExperienceSource).toContain("getDiningFloorplanByFloor");
		expect(diningExperienceSource).toContain("floor.floor.floorplan.floorplanId");
		expect(diningExperienceSource).toContain("dangerouslySetInnerHTML");
		expect(diningExperienceSource).toContain("[data-dining-anchor-id]");
		expect(diningExperienceSource).not.toContain("h-full min-h-36");
		expect(diningExperienceSource).toContain("min-h-16");
		expect(diningExperienceSource).toContain("flex-wrap justify-start");
		expect(diningExperienceSource).toContain("min-w-0 rounded-xl");
		expect(diningExperienceSource).toContain("min-w-0 max-h-[360px]");
		expect(diningExperienceSource).toContain("!w-full !max-w-full");
		expect(diningExperienceSource).toContain("floorplanKey");
		expect(diningExperienceSource).toContain("key={floorplanKey}");
		expect(diningExperienceSource).toContain("maxScale={1.32}");
		expect(diningExperienceSource).toContain("zoomToElement(selector, 1.08");
		expect(diningExperienceSource).toContain("matchedWindowIds");
		expect(diningExperienceSource).toContain("is-dimmed");
		expect(diningExperienceSource).not.toContain("maxScale={3}");
		expect(diningExperienceSource).not.toContain("maxScale={1.7}");
		expect(diningExperienceSource).not.toContain("zoomToElement(selector, 1.35");
		expect(diningExperienceSource).not.toContain("min-w-[640px]");
		expect(diningExperienceSource).not.toContain("<fieldset");
		expect(diningExperienceSource).not.toContain("<img");
		expect(diningPageSource).toContain("floor.filters.tags");
		expect(diningPageSource).toContain("payload.windows");
		expect(diningPageSource).not.toContain('id: "rice-bowl"');
		expect(diningExperienceSource).not.toContain("x: 56");
		expect(diningExperienceSource).not.toContain("y: 72");
		expect(diningPageSource).not.toContain("stalls");
		expect(diningExperienceSource).not.toContain("stalls");
		expect(diningExperienceSource).not.toContain("已下架");
		expect(diningExperienceSource).not.toContain('?? "标准"');
	});

	it("renders dining map-first hall selector, interactive stalls, and menu references", async () => {
		diningApiMock.getDiningHalls.mockResolvedValue({
			halls: [
				{
					campus: "海淀校区",
					floors: [{ floorId: "haidian-canteen-1-1f", label: "一层" }],
					hallId: "haidian-canteen-1",
					name: "海淀一食堂",
				},
				{
					campus: "丰台校区",
					floors: [
						{ floorId: "fengtai-huixian-canteen-1f", label: "一层" },
						{ floorId: "fengtai-huixian-canteen-2f", label: "二层" },
					],
					hallId: "fengtai-huixian-canteen",
					name: "荟贤食堂",
				},
			],
		});
		diningApiMock.getDiningFloor.mockImplementation(
			({ floorId, hallId }: { floorId: string; hallId: string }) => {
				const projections = {
					"fengtai-huixian-canteen:fengtai-huixian-canteen-1f": "荟贤食堂一层",
					"fengtai-huixian-canteen:fengtai-huixian-canteen-2f": "荟贤食堂二层",
					"haidian-canteen-1:haidian-canteen-1-1f": "海淀一食堂一层",
				} as const;
				const label = projections[`${hallId}:${floorId}` as keyof typeof projections];
				if (!label) {
					return Promise.reject(new Error("missing dining projection"));
				}
				return Promise.resolve(createDiningFloorPayload({ floorId, hallId, label }));
			},
		);
		render(<DiningPage />);

		expect(await screen.findByText("食堂")).toBeInTheDocument();
		expect(screen.getByRole("radio", { name: "全部校区" })).toHaveAttribute("aria-checked", "true");
		expect(await screen.findByText("海淀一食堂")).toBeInTheDocument();
		expect(await screen.findByText("荟贤食堂")).toBeInTheDocument();
		expect(screen.queryByText("1 层 · 1 个餐饮点")).toBeNull();
		expect(screen.queryByText("9-18 元")).toBeNull();
		expect(await screen.findByRole("button", { name: "选择盖饭窗口" })).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "盖饭窗口" })).toBeInTheDocument();
		expect(screen.getByText("番茄牛腩饭")).toBeInTheDocument();
		expect(screen.getAllByText("参考价格").length).toBeGreaterThan(0);
		expect(screen.getByText("18 元")).toBeInTheDocument();
		expect(screen.queryByText("标准份")).toBeNull();
		expect(screen.queryByText("可售")).toBeNull();
		expect(screen.queryByText("季节供应")).toBeNull();
		expect(screen.queryByText("dining_release:initial")).toBeNull();
		expect(screen.getByLabelText("选择盖饭窗口")).toBeInTheDocument();
		expect(screen.getByTestId("dining-inline-floorplan").querySelector("svg")).not.toBeNull();
		expect(screen.getByRole("button", { name: "放大平面图" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "缩小平面图" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "适配平面图" })).toBeInTheDocument();
		fireEvent.click(screen.getByTestId("dining-anchor-window-01"));
		expect(screen.getByTestId("dining-anchor-window-01")).toHaveClass("is-selected");
		expect(screen.getByRole("button", { name: "盖饭窗口" })).toHaveClass(
			"bg-[var(--sys-brand-interactive-subtle)]",
		);
		fireEvent.change(screen.getByPlaceholderText("搜索食堂、档口、菜品"), {
			target: { value: "牛腩" },
		});
		expect(screen.getByText("海淀一食堂")).toBeInTheDocument();
		expect(screen.queryByText("没有匹配的食堂、档口或菜品")).not.toBeInTheDocument();
		expect(screen.getByText("番茄牛腩饭")).toBeInTheDocument();
		expect(screen.getByTestId("dining-anchor-window-01")).toBeInTheDocument();
		expect(screen.getByTestId("dining-anchor-window-02")).toHaveClass("is-dimmed");
		expect(screen.queryByRole("button", { name: "选择二号窗口" })).toBeNull();
		fireEvent.change(screen.getByPlaceholderText("搜索食堂、档口、菜品"), {
			target: { value: "不存在的菜" },
		});
		expect(screen.getByText("没有匹配的食堂、档口或菜品")).toBeInTheDocument();
		expect(screen.queryByTestId("dining-inline-floorplan")).toBeNull();
		expect(screen.queryByText("番茄牛腩饭")).toBeNull();
		fireEvent.change(screen.getByPlaceholderText("搜索食堂、档口、菜品"), {
			target: { value: "" },
		});
		fireEvent.click(screen.getByRole("radio", { name: "热餐" }));
		expect(screen.getByRole("button", { name: "选择盖饭窗口" })).toBeInTheDocument();
		fireEvent.click(screen.getByRole("radio", { name: "全部" }));
		expect(screen.getByRole("button", { name: "选择盖饭窗口" })).toBeInTheDocument();

		expect((await screen.findAllByText("海淀一食堂一层")).length).toBeGreaterThan(0);
		fireEvent.click(screen.getByRole("radio", { name: "丰台校区" }));

		expect((await screen.findAllByText("荟贤食堂一层")).length).toBeGreaterThan(0);
		fireEvent.click(screen.getByText("二层"));
		expect((await screen.findAllByText("荟贤食堂二层")).length).toBeGreaterThan(0);
		fireEvent.click(screen.getByRole("radio", { name: "海淀校区" }));

		expect((await screen.findAllByText("海淀一食堂一层")).length).toBeGreaterThan(0);
		expect(diningApiMock.getDiningFloor).not.toHaveBeenCalledWith({
			floorId: "fengtai-huixian-canteen-2f",
			hallId: "haidian-canteen-1",
		});
	});

	it("renders dining empty state when no published halls exist", async () => {
		diningApiMock.getDiningHalls.mockResolvedValue({ halls: [] });

		render(<DiningPage />);

		expect(await screen.findByText("当前没有已发布的食堂数据。")).toBeInTheDocument();
		expect(screen.queryByText("正在读取食堂数据")).not.toBeInTheDocument();
		expect(diningApiMock.getDiningFloor).not.toHaveBeenCalled();
	});

	it("renders the assistant conversation shell as the thread surface", async () => {
		render(<ConversationPage />);

		expect(await screen.findByText("中央民族大学校园问答")).toBeInTheDocument();
		expect(screen.getByText("会话")).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "搜索聊天" })).toBeNull();
		expect(await screen.findByTestId("assistant-chat")).toBeInTheDocument();
		expect(conversationApiMock.getConversationDetail).toHaveBeenCalledWith("conv_01");
	});

	it("renders fail-closed not found page", () => {
		render(<NotFoundPage />);

		expect(screen.getByText("页面不存在")).toBeInTheDocument();
	});
});

function createDiningFloorPayload(input: { floorId: string; hallId: string; label: string }) {
	return {
		filters: { tags: ["主食", "热餐"] },
		floor: {
			canvas: { height: 420, width: 720 },
			floorId: input.floorId,
			floorplan: toDiningFloorplanRef(input),
			hallId: input.hallId,
			label: input.label,
			svgAssetUrl: `/assets/dining/${input.hallId}-${input.floorId}.svg`,
		},
		source: {
			label: "校园食堂平面图整理",
			updatedAt: "2026-06-08T00:00:00.000Z",
		},
		windows: [
			{
				assignment: {
					assignmentId: `assignment:${input.hallId}:${input.floorId}:window-01`,
					offerings: [
						{
							menuItemId: "menu:rice:1",
							name: "番茄牛腩饭",
							offeringId: "offering:rice:1",
							priceLabel: "18 元",
							tags: ["主食", "热餐"],
						},
						{
							menuItemId: "menu:rice:2",
							name: "鸡腿盖饭",
							offeringId: "offering:rice:2",
							priceLabel: "16 元",
							tags: ["主食"],
						},
					],
					stallProfile: {
						displayName: "盖饭窗口",
						stallProfileId: "stall:rice",
						stallType: "hot_meal",
						tags: ["主食"],
					},
				},
				geometry: { height: 72, width: 150, x: 64, y: 72 },
				label: "一号窗口",
				locationLabel: "入口侧",
				svgAnchorId: "window-01",
				status: "active",
				tags: ["主食", "热餐"],
				windowId: `${input.hallId}:${input.floorId}:window-01`,
			},
			{
				assignment: {
					assignmentId: `assignment:${input.hallId}:${input.floorId}:window-02`,
					offerings: [
						{
							menuItemId: "menu:noodle:1",
							name: "番茄鸡蛋面",
							offeringId: "offering:noodle:1",
							priceLabel: "12 元",
							tags: ["面食"],
						},
					],
					stallProfile: {
						displayName: "面食窗口",
						stallProfileId: "stall:noodle",
						stallType: "noodle",
						tags: ["面食"],
					},
				},
				geometry: { height: 72, width: 150, x: 240, y: 72 },
				label: "二号窗口",
				locationLabel: "中部",
				svgAnchorId: "window-02",
				status: "active",
				tags: ["面食"],
				windowId: `${input.hallId}:${input.floorId}:window-02`,
			},
		],
	};
}

function toDiningFloorplanRef(input: { floorId: string; hallId: string }) {
	const shaByFloor = {
		"fengtai-huixian-canteen-1f":
			"sha256:1f02bf778c9c11ec7c9ce0426fa63bfff0ba1ec6dc9dc0be20b26a9a6a5b710a",
		"fengtai-huixian-canteen-2f":
			"sha256:2641cf62e78b00690f4a03d265d161613fd475bef5c86ecb3bd139728ec3c3e2",
		"haidian-canteen-1-1f":
			"sha256:c55f08aa63157e174970361c07811678f54727179b317901c20b1b2f25df6929",
	} as const;
	const sha256 = shaByFloor[input.floorId as keyof typeof shaByFloor];
	if (!sha256) {
		throw new Error(`missing dining floorplan test fixture: ${input.hallId}/${input.floorId}`);
	}
	return {
		anchorInventory: [
			{ anchorId: "window-01", label: "一号窗口", role: "window" },
			{ anchorId: "window-02", label: "二号窗口", role: "window" },
			{ anchorId: "window-03", label: "三号窗口", role: "window" },
			{ anchorId: "window-04", label: "四号窗口", role: "window" },
			{ anchorId: "window-05", label: "五号窗口", role: "window" },
		],
		floorId: input.floorId,
		floorplanId: `floorplan:${input.hallId}:${input.floorId}`,
		hallId: input.hallId,
		sha256,
		svgAssetUrl: `/assets/dining/${input.hallId}-${input.floorId}.svg`,
	};
}
