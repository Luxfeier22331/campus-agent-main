import { readFileSync } from "node:fs";
import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundPage, RootLayout } from "../src/app/root-layout";
import rootLayoutSource from "../src/app/root-layout.tsx?raw";
import { ConversationPage } from "../src/app/routes/conversation-page";
import { DiningPageContent } from "../src/app/routes/dining-page";
import diningPageSource from "../src/app/routes/dining-page.tsx?raw";
import { FeedbackPage } from "../src/app/routes/feedback-page";
import feedbackPageSource from "../src/app/routes/feedback-page.tsx?raw";
import { HomePage } from "../src/app/routes/home-page";
import homePageSource from "../src/app/routes/home-page.tsx?raw";
import authSource from "../src/components/auth/auth.tsx?raw";
import qaShellSource from "../src/components/conversation/qa-shell.tsx?raw";
import diningControlsSource from "../src/components/dining/dining-controls.tsx?raw";
import diningExperienceSource from "../src/components/dining/dining-experience.tsx?raw";
import diningFloorplanSource from "../src/components/dining/dining-floorplan.tsx?raw";
import diningFloorplanZoomSource from "../src/components/dining/dining-floorplan-zoom.tsx?raw";
import { DiningSubmissionExitProvider } from "../src/components/dining/dining-submission-exit";
import mapExperienceSource from "../src/components/map/map-experience.tsx?raw";
import mapPlacePopoverSource from "../src/components/map/map-place-popover.tsx?raw";
import assistantRuntimeSource from "../src/features/conversation/assistant-ui-runtime.tsx?raw";
import assistantControllerSource from "../src/features/conversation/use-assistant-ui-run-controller.ts?raw";
import assistantCoordinatorSource from "../src/features/conversation/use-conversation-run-coordinator.ts?raw";
import { createCampusQueryClient } from "../src/platform/query/client";
import {
	DINING_FIXTURE_ASSETS,
	DINING_FIXTURE_MAP,
	mockDiningFixtureApi,
} from "./dining-fixture-test-utils";
import { mockMapWorkspaceWidth } from "./map-page-test-utils";

const stylesSource = readFileSync("src/styles.css", "utf8");
const campusStylesSource = readFileSync("src/campus-styles.css", "utf8");
const sharedThemeSource = readFileSync("../../packages/ui/src/theme.css", "utf8");

const diningApiMock = vi.hoisted(() => ({
	getDiningMap: vi.fn(),
}));
const diningFloorplanAssetMock = vi.hoisted(() => ({
	loadDiningFloorplanAsset: vi.fn(),
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
	searchConversations: vi.fn(),
	unarchiveConversation: vi.fn(),
}));
const sessionState = vi.hoisted(() => ({
	data: { user: { id: "user_01", name: "测试用户" } } as {
		user: { id: string; name: string };
	} | null,
	isPending: false,
	refresh: vi.fn().mockResolvedValue(undefined),
}));
const navigateMock = vi.hoisted(() => vi.fn());
const diningRouteSearch = vi.hoisted(() => ({
	notify: null as null | (() => void),
	value: {} as Record<string, string | undefined>,
}));

vi.mock("@/components/auth/auth-ui-provider", () => ({
	CampusAuthUIProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/platform/auth/session", () => ({
	useCampusSession: () => ({
		data: sessionState.data,
		error: null,
		isRefreshing: false,
		refresh: sessionState.refresh,
		status: sessionState.data ? "authenticated" : sessionState.isPending ? "loading" : "anonymous",
	}),
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
		useSearch: () => diningRouteSearch.value,
		useBlocker: () => ({ reset: vi.fn(), proceed: vi.fn(), status: "idle" }),
	};
});

vi.mock("../src/features/conversation/api", () => ({
	archiveConversation: conversationApiMock.archiveConversation,
	createConversationDraft: conversationApiMock.createConversationDraft,
	deleteConversation: conversationApiMock.deleteConversation,
	getConversationDetail: conversationApiMock.getConversationDetail,
	listConversations: conversationApiMock.listConversations,
	renameConversation: conversationApiMock.renameConversation,
	searchConversations: conversationApiMock.searchConversations,
	unarchiveConversation: conversationApiMock.unarchiveConversation,
}));

vi.mock("../src/features/feedback/api", () => feedbackApiMock);

vi.mock("../src/features/dining/api", () => diningApiMock);

vi.mock("../src/features/dining/floorplan-asset", () => diningFloorplanAssetMock);

function DiningPage({ queryClient: providedQueryClient }: { queryClient?: QueryClient } = {}) {
	const [queryClient] = useState(() => providedQueryClient ?? createCampusQueryClient());
	const [, setRouteVersion] = useState(0);
	useEffect(() => {
		diningRouteSearch.notify = () => setRouteVersion((version) => version + 1);
		return () => {
			diningRouteSearch.notify = null;
		};
	}, []);
	return (
		<QueryClientProvider client={queryClient}>
			<DiningSubmissionExitProvider>
				<DiningPageContent />
			</DiningSubmissionExitProvider>
		</QueryClientProvider>
	);
}

describe("campus routes", () => {
	beforeEach(() => {
		sessionState.data = { user: { id: "user_01", name: "测试用户" } };
		sessionState.isPending = false;
		diningApiMock.getDiningMap.mockReset();
		diningFloorplanAssetMock.loadDiningFloorplanAsset.mockReset();
		diningFloorplanAssetMock.loadDiningFloorplanAsset.mockImplementation(
			async (input: { floorplanId: string; sha256: string; svgAssetUrl: string }) => {
				const asset = DINING_FIXTURE_ASSETS.find(
					(entry) => entry.floorplanId === input.floorplanId,
				);
				if (
					!asset ||
					asset.sha256 !== input.sha256 ||
					input.svgAssetUrl !== `/api/dining/floorplans/${input.sha256.slice("sha256:".length)}.svg`
				) {
					throw new Error("floorplan asset projection drifted");
				}
				return asset.svgMarkup;
			},
		);
		feedbackApiMock.submitFeedback.mockReset();
		feedbackApiMock.submitFeedback.mockResolvedValue({
			feedback: {
				feedbackId: "feedback_01",
				receivedAt: "2026-06-08T00:00:00.000Z",
			},
		});
		navigateMock.mockReset();
		diningRouteSearch.value = {};
		navigateMock.mockImplementation(
			(input: {
				replace?: boolean;
				search?:
					| Record<string, string | undefined>
					| ((previous: Record<string, string | undefined>) => Record<string, string | undefined>);
			}) => {
				const nextSearch =
					typeof input.search === "function"
						? input.search(diningRouteSearch.value)
						: (input.search ?? diningRouteSearch.value);
				diningRouteSearch.value = Object.fromEntries(
					Object.entries(nextSearch).filter(
						(entry): entry is [string, string] => entry[1] !== undefined,
					),
				);
				const params = new URLSearchParams(diningRouteSearch.value as Record<string, string>);
				window.history[input.replace ? "replaceState" : "pushState"](
					{},
					"",
					`/dining${params.size > 0 ? `?${params}` : ""}`,
				);
				diningRouteSearch.notify?.();
				return Promise.resolve();
			},
		);
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
		conversationApiMock.searchConversations.mockReset();
		conversationApiMock.searchConversations.mockResolvedValue({ conversations: [], query: "" });
		conversationApiMock.renameConversation.mockReset();
		conversationApiMock.unarchiveConversation.mockReset();
	});

	it("renders the assistant Q&A home shell without app launcher debt", async () => {
		render(<HomePage />);

		expect((await screen.findAllByText("新对话")).length).toBeGreaterThanOrEqual(1);
		expect(screen.getByRole("button", { name: "新对话" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "搜索聊天" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "校园问答" })).toBeInTheDocument();
		expect(screen.queryByPlaceholderText("搜索历史会话")).toBeNull();
		expect(screen.getByRole("link", { name: "文档" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "校园地图" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "食堂" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "反馈" })).toBeInTheDocument();
		expect(await screen.findByTestId("assistant-chat")).toBeInTheDocument();
		expect(screen.getByPlaceholderText("输入校园问题")).toBeInTheDocument();
		await waitFor(() => {
			expect(screen.getAllByRole("button", { name: "账号" })).toHaveLength(1);
		});
		expect(screen.queryByRole("button", { name: "登录" })).toBeNull();
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
		expect(qaShellSource).toContain("CampusTopNav");
		expect(qaShellSource).not.toContain("supportNavItems");
		expect(qaShellSource).not.toContain("饭堂分布图");
		expect(qaShellSource).toContain("ThreadListSidebar");
		expect(qaShellSource).toContain("@/components/assistant-ui/threadlist-sidebar");
		expect(qaShellSource).not.toContain("@assistant-ui/react-ui");
		expect(qaShellSource).not.toContain("@assistant-ui/react-data-stream");
		expect(qaShellSource).not.toContain("/api/chat/assistant-ui");
		expect(assistantRuntimeSource).toContain("useExternalStoreRuntime");
		expect(assistantControllerSource).toContain("useAssistantUiRunController");
		expect(assistantCoordinatorSource).toContain("submitChatRequestStream");
		expect(
			assistantRuntimeSource + assistantControllerSource + assistantCoordinatorSource,
		).not.toContain("@assistant-ui/react-data-stream");
		expect(
			assistantRuntimeSource + assistantControllerSource + assistantCoordinatorSource,
		).not.toContain("/api/chat/assistant-ui");
		expect(qaShellSource).toContain("@/components/auth/auth-dialog");
		expect(qaShellSource).toContain("@/components/auth/user/account-entry");
		expect(qaShellSource).not.toContain("const AuthDialog = lazy(");
		expect(qaShellSource).toContain('density="compact"');
		expect(qaShellSource).not.toContain("SupportNavigation");
		expect(qaShellSource).not.toContain("AccountLoginDialog");
		expect(qaShellSource).not.toContain("getSessionPrincipal");
		expect(qaShellSource).toContain('loginRequired={session.status === "anonymous"}');
		expect(qaShellSource).not.toContain("const railActionClass");
		expect(qaShellSource).not.toContain("const railActionIconClass");
		expect(qaShellSource).not.toContain("const railActionShortcutClass");
		expect(qaShellSource).not.toContain("ChatKit 管理");
		expect(qaShellSource).not.toContain("ConversationSidebar");
		expect(qaShellSource).toContain("ThreadListSidebar");
		expect(stylesSource).toContain('@import "tailwindcss";');
		expect(stylesSource).toContain('@import "./campus-styles.css";');
		expect(campusStylesSource).toContain('@import "@campus-agent/ui/theme.css";');
		expect(sharedThemeSource).toContain("@layer base");
		expect(sharedThemeSource).toContain("font: inherit");
		expect(rootLayoutSource).not.toContain("移动端主导航");
		expect(rootLayoutSource).not.toContain("supportNavItems");
	});

	it("does not register the canonical docs reader as a React route", () => {
		const routerSource = readFileSync("src/app/router.tsx", "utf8");

		expect(routerSource).not.toContain("DocsPage");
		expect(routerSource).not.toContain('path: "/docs"');
		expect(routerSource).not.toContain('path: "/docs/$"');
		expect(routerSource).not.toContain("./routes/docs-page");
	});

	it("registers a visible route pending skeleton for cold route chunks", () => {
		const routerSource = readFileSync("src/app/router.tsx", "utf8");

		expect(routerSource).toContain("defaultPendingComponent: RoutePending");
		expect(routerSource).toContain("defaultPendingMinMs: 200");
		expect(routerSource).toContain("defaultPendingMs: 100");
		expect(routerSource).toContain("pendingComponent: DiningRoutePending");
		expect(rootLayoutSource).toContain('aria-label="正在加载页面"');
	});

	it("keeps product pages on mature UI primitives instead of bespoke controls", () => {
		expect(feedbackPageSource).toContain("react-hook-form");
		expect(feedbackPageSource).toContain("zod");
		expect(feedbackPageSource).not.toContain("<select");
		expect(feedbackPageSource).toContain('type="submit"');
		expect(authSource).not.toContain("<input");
		expect(diningPageSource).not.toContain('role="tablist"');
		expect(mapExperienceSource).not.toContain("handleSearchKeyDown");
		expect(mapExperienceSource).not.toContain('role="dialog"');
		expect(mapExperienceSource).toContain("@campus-agent/ui");
		expect(mapExperienceSource).not.toContain("@/components/ui/command");
		expect(mapPlacePopoverSource).toContain("@/components/ui/popover");
	});

	it("separates the account entry from the conversation history area", async () => {
		render(<HomePage />);

		const footer = document.querySelector('[data-sidebar="footer"]');
		expect(footer).not.toBeNull();
		await waitFor(() => {
			expect(
				within(footer as HTMLElement).getByRole("button", { name: "账号" }),
			).toBeInTheDocument();
		});
		expect(footer?.previousElementSibling).toHaveAttribute("data-sidebar", "content");
		expect(screen.getAllByRole("button", { name: "账号" })).toHaveLength(1);
		expect(screen.queryByRole("button", { name: "登录" })).toBeNull();
		expect(screen.queryByRole("separator", { name: "账号区域" })).toBeNull();
	});

	it("keeps the desktop topbar inside the assistant content inset", async () => {
		render(<HomePage />);

		const assistantChat = await screen.findByTestId("assistant-chat");

		expect(within(assistantChat).getAllByText("新对话").length).toBeGreaterThanOrEqual(1);
		expect(within(assistantChat).getByRole("region", { name: "校园问答" })).toBeInTheDocument();
		expect(within(assistantChat).queryByRole("heading", { name: "聊天记录" })).toBeNull();
	});

	it("keeps conversation search closed until the user opens it", async () => {
		render(<HomePage />);

		const newConversationButton = await screen.findByRole("button", { name: "新对话" });

		expect(newConversationButton).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "搜索聊天" })).toBeInTheDocument();
		expect(screen.queryByPlaceholderText("搜索历史会话")).toBeNull();
	});

	it("keeps the mobile thread list scoped to conversation history", async () => {
		const user = userEvent.setup();
		mockMapWorkspaceWidth(false, vi.fn);
		render(<HomePage />);

		const openMobileThreadsButton = screen.getByRole("button", { name: "打开聊天记录" });
		expect(openMobileThreadsButton).toHaveClass("size-12");
		await user.click(openMobileThreadsButton);
		const mobileMenu = screen.getByRole("dialog", { name: "聊天记录" });
		const closeMobileMenuButton = within(mobileMenu).getByRole("button", {
			name: "关闭聊天记录",
		});
		expect(closeMobileMenuButton).toBeInTheDocument();
		expect(mobileMenu.className).toContain("max-w-[calc(100vw-1rem)]");

		expect(within(mobileMenu).queryByRole("button", { name: "登录" })).toBeNull();
		expect(await within(mobileMenu).findByRole("button", { name: "国家奖学金" }));
		await user.click(closeMobileMenuButton);
		expect(screen.queryByRole("button", { name: "关闭聊天记录" })).toBeNull();
	});

	it("keeps signed-out Q&A account entry large enough for touch", async () => {
		sessionState.data = null;
		mockMapWorkspaceWidth(true, vi.fn);
		render(<HomePage />);

		expect(await screen.findByRole("button", { name: "登录" })).toHaveClass(
			"min-h-11",
			"lg:min-h-10",
		);
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

	it("uses the focused header on account routes without product navigation", () => {
		sessionState.data = null;
		window.history.pushState({}, "", "/account/login");
		render(<RootLayout />);

		expect(screen.getByText("支撑页面内容")).toBeInTheDocument();
		expect(screen.getByText("中央民族大学校园问答")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /外观，当前/u })).toBeInTheDocument();
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

	it("uses the focused header on legal routes without product navigation", () => {
		window.history.pushState({}, "", "/legal/terms");
		render(<RootLayout />);

		expect(screen.getByText("支撑页面内容")).toBeInTheDocument();
		expect(screen.getByText("中央民族大学校园问答")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /外观，当前/u })).toBeInTheDocument();
		expect(screen.queryByText("MUC Campus Q&A")).toBeNull();
		expect(screen.queryByRole("navigation", { name: "支撑页面导航" })).toBeNull();
		expect(screen.queryByRole("link", { name: "文档" })).toBeNull();
		expect(screen.queryByRole("link", { name: "校园地图" })).toBeNull();
		expect(screen.queryByRole("link", { name: "食堂" })).toBeNull();
		expect(screen.queryByRole("link", { name: "反馈" })).toBeNull();
	});

	it("keeps one feedback navigation entry on non-map support pages", () => {
		window.history.pushState({}, "", "/feedback");
		render(<RootLayout />);

		const activeLink = screen.getByRole("link", { name: "反馈" });
		expect(activeLink).toHaveClass("bg-selected", "text-selected-foreground");
		expect(activeLink).not.toHaveClass("bg-primary", "text-primary-foreground");
		expect(screen.getAllByRole("navigation", { name: "产品导航" })).toHaveLength(1);
	});

	it("renders global feedback form", () => {
		render(<FeedbackPage />);

		expect(screen.getByRole("heading", { name: "反馈" })).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "提交反馈" })).toBeInTheDocument();
		expect(screen.getByLabelText("问题描述")).toBeRequired();
		expect(screen.getByRole("button", { name: "提交反馈" })).toBeEnabled();
	});

	it("captures and labels the initial feedback source", () => {
		window.history.pushState({}, "", "/feedback?source=map");
		render(<FeedbackPage />);

		expect(screen.getByLabelText("反馈来源")).toHaveTextContent("校园地图");
		expect(screen.queryByRole("textbox", { name: "反馈来源" })).toBeNull();
	});

	it("submits feedback with the current route context and shows received status", async () => {
		const user = userEvent.setup();
		window.history.pushState({}, "", "/feedback?source=map");
		render(<FeedbackPage />);

		await user.type(screen.getByLabelText("问题描述"), "地图地点名称需要更新。");
		await user.click(screen.getByRole("button", { name: "提交反馈" }));

		const receivedStatus = await screen.findByText("反馈已提交。");
		expect(receivedStatus).toBeInTheDocument();
		expect(receivedStatus.closest("[aria-live]")).toHaveAttribute("aria-live", "polite");
		expect(feedbackApiMock.submitFeedback).toHaveBeenCalledWith(
			expect.objectContaining({
				body: "地图地点名称需要更新。",
				routeContext: "/feedback?source=map",
			}),
		);
	});

	it("keeps the Dining surface limited to one map projection and immutable SVG assets", () => {
		expect(diningPageSource).toContain("diningMapQueryOptions");
		expect(diningPageSource).not.toContain("diningReviewsQueryOptions");
		expect(diningPageSource).not.toContain("getDiningFloor");
		expect(diningPageSource).not.toContain("preview");
		expect(diningExperienceSource).not.toContain("DiningReviewList");
		expect(diningControlsSource).toContain("DiningHallSwitcher");
		expect(diningControlsSource).toContain("搜索窗口");
		expect(diningFloorplanSource).toContain("diningFloorplanAssetQueryOptions");
		expect(diningFloorplanSource).toContain("dangerouslySetInnerHTML");
		expect(diningFloorplanSource).toContain("[data-dining-anchor-id]");
		expect(diningFloorplanSource).toContain('import("./dining-floorplan-zoom")');
		expect(diningFloorplanZoomSource).toContain("react-zoom-pan-pinch");
		expect(diningFloorplanSource).toContain("parseDiningFloorplanViewBox");
		expect(diningFloorplanSource).toContain("matchedWindowIds");
		expect(diningFloorplanSource).toContain("is-dimmed");
	});

	it("renders the published map and selects windows without additional data requests", async () => {
		const user = userEvent.setup();
		const fixture = mockDiningFixtureApi(diningApiMock);
		const hall = fixture.halls[0];
		const floor = hall?.floors[0];
		const diningWindow = floor?.windows[0];
		if (!(hall && floor && diningWindow)) {
			throw new Error("Dining fixture is incomplete.");
		}

		render(<DiningPage />);

		expect(await screen.findByRole("radio", { name: hall.name })).toHaveAttribute(
			"aria-checked",
			"true",
		);
		const windowButton = await screen.findByRole("button", {
			name: `选择${diningWindow.name}`,
		});
		expect(screen.getByRole("heading", { name: "选择窗口" })).toBeInTheDocument();
		await user.click(windowButton);
		expect(screen.getByRole("heading", { name: diningWindow.name })).toBeInTheDocument();
		expect(screen.getByText(floor.label)).toBeInTheDocument();
		expect(diningApiMock.getDiningMap).toHaveBeenCalledOnce();
		expect(diningFloorplanAssetMock.loadDiningFloorplanAsset).toHaveBeenCalledWith(
			expect.objectContaining({ floorplanId: floor.floorplan.floorplanId }),
		);
	});

	it("searches published window names in the browser", async () => {
		const user = userEvent.setup();
		const fixture = mockDiningFixtureApi(diningApiMock);
		const floor = fixture.halls[0]?.floors[0];
		const diningWindow = floor?.windows[0];
		const otherWindow = floor?.windows[1];
		if (!(diningWindow && otherWindow)) {
			throw new Error("Dining fixture needs two windows.");
		}

		render(<DiningPage />);
		await screen.findByTestId(`dining-anchor-${diningWindow.svgAnchorId}`);
		await user.type(screen.getByPlaceholderText("搜索窗口"), diningWindow.name);

		expect(
			await screen.findByRole("option", { name: new RegExp(diningWindow.name) }),
		).toBeInTheDocument();
		expect(screen.getByTestId(`dining-anchor-${otherWindow.svgAnchorId}`)).toHaveClass("is-dimmed");
		expect(diningApiMock.getDiningMap).toHaveBeenCalledOnce();
	});

	it("switches halls and floors from the same published map", async () => {
		const user = userEvent.setup();
		const fixture = mockDiningFixtureApi(diningApiMock);
		const hall = fixture.halls.find((item) => item.floors.length > 1);
		const floor = hall?.floors[1];
		if (!(hall && floor)) {
			throw new Error("Dining fixture needs a multi-floor hall.");
		}

		render(<DiningPage />);
		await user.click(await screen.findByRole("radio", { name: hall.name }));
		await user.click(await screen.findByText(floor.label));
		await user.click(screen.getByRole("radio", { name: floor.label }));
		await user.click(screen.getByRole("radio", { name: hall.name }));
		expect(screen.getByRole("radio", { name: hall.name })).toBeChecked();
		expect(screen.getByRole("radio", { name: floor.label })).toBeChecked();

		await waitFor(() => {
			expect(diningFloorplanAssetMock.loadDiningFloorplanAsset).toHaveBeenCalledWith(
				expect.objectContaining({ floorplanId: floor.floorplan.floorplanId }),
			);
		});
		expect(diningRouteSearch.value).toMatchObject({ floor: floor.floorId, hall: hall.hallId });
		expect(diningApiMock.getDiningMap).toHaveBeenCalledOnce();
	});

	it("retries a failed map read without reloading the page", async () => {
		const user = userEvent.setup();
		diningApiMock.getDiningMap
			.mockRejectedValueOnce(new Error("map unavailable"))
			.mockResolvedValueOnce(DINING_FIXTURE_MAP);

		render(<DiningPage />);

		const error = await screen.findByRole("alert");
		expect(error).toHaveTextContent("食堂地图不可用");
		await user.click(within(error).getByRole("button", { name: "重试" }));
		expect(await screen.findByTestId("dining-map-panel")).toBeInTheDocument();
		expect(diningApiMock.getDiningMap).toHaveBeenCalledTimes(2);
	});

	it("keeps an invalid floorplan failure inside the map panel", async () => {
		mockDiningFixtureApi(diningApiMock);
		diningFloorplanAssetMock.loadDiningFloorplanAsset.mockRejectedValueOnce(
			new Error("checksum mismatch"),
		);

		render(<DiningPage />);

		expect(await screen.findByRole("alert")).toHaveTextContent("平面图暂时无法显示");
		expect(screen.getByTestId("dining-window-detail")).toBeInTheDocument();
	});

	it("renders the empty state when no map has been published", async () => {
		diningApiMock.getDiningMap.mockResolvedValue({
			halls: [],
			releaseId: "dining_release:empty",
			updatedAt: "2026-07-16T00:00:00.000Z",
		});

		render(<DiningPage />);

		expect(await screen.findByText("暂无食堂地图")).toBeInTheDocument();
		expect(screen.queryByTestId("dining-map-panel")).toBeNull();
	});

	it("renders the assistant conversation shell as the thread surface", async () => {
		render(<ConversationPage />);

		const assistantChat = await screen.findByTestId("assistant-chat");
		expect(within(assistantChat).getAllByText("会话").length).toBeGreaterThanOrEqual(1);
		expect(conversationApiMock.getConversationDetail).toHaveBeenCalledWith("conv_01");
	});

	it("renders fail-closed not found page", () => {
		render(<NotFoundPage />);

		expect(screen.getByText("页面不存在")).toBeInTheDocument();
	});
	it("validates feedback before calling the API and exposes the field error", async () => {
		render(<FeedbackPage />);
		fireEvent.click(screen.getByRole("button", { name: "提交反馈" }));
		expect(await screen.findByRole("alert")).toHaveTextContent("请填写问题描述。");
		expect(screen.getByLabelText("问题描述")).toHaveAttribute("aria-invalid", "true");
		expect(screen.getByLabelText("问题描述")).toHaveAttribute(
			"aria-describedby",
			"feedback-body-error",
		);
		expect(feedbackApiMock.submitFeedback).not.toHaveBeenCalled();
	});

	it("submits the selected feedback category and trimmed contact, then clears only the body", async () => {
		const user = userEvent.setup();
		render(<FeedbackPage />);
		screen.getByRole("combobox", { name: "问题类型" }).focus();
		await user.keyboard("{Enter}");
		screen.getByRole("option", { name: "地图问题" }).focus();
		await user.keyboard("{Enter}");
		fireEvent.change(screen.getByLabelText("问题描述"), {
			target: { value: "地图点位需要更新。" },
		});
		fireEvent.change(screen.getByLabelText("联系方式（可选）"), {
			target: { value: "  student@example.edu  " },
		});
		await user.click(screen.getByRole("button", { name: "提交反馈" }));
		await waitFor(() => expect(screen.getByText("反馈已提交。")).toBeVisible());
		expect(feedbackApiMock.submitFeedback).toHaveBeenCalledWith(
			expect.objectContaining({
				category: "map_issue",
				contact: "student@example.edu",
				body: "地图点位需要更新。",
			}),
		);
		expect(screen.getByLabelText("问题描述")).toHaveValue("");
		expect(screen.getByRole("combobox", { name: "问题类型" })).toHaveTextContent("地图问题");
	});

	it("keeps feedback available after a failed submission", async () => {
		feedbackApiMock.submitFeedback.mockRejectedValueOnce(new Error("unavailable"));
		render(<FeedbackPage />);
		fireEvent.change(screen.getByLabelText("问题描述"), { target: { value: "再次提交失败。" } });
		fireEvent.click(screen.getByRole("button", { name: "提交反馈" }));
		await waitFor(() => expect(screen.getByText("反馈暂时没有提交成功。")).toBeVisible());
		expect(screen.getByLabelText("问题描述")).toHaveValue("再次提交失败。");
		expect(screen.getByRole("button", { name: "提交反馈" })).toBeEnabled();
		expect(screen.queryByText("反馈已提交。")).toBeNull();
	});

	it("shows the Dining map skeleton until the projection arrives", async () => {
		let release: (value: typeof DINING_FIXTURE_MAP) => void = () => undefined;
		diningApiMock.getDiningMap.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					release = resolve;
				}),
		);
		render(<DiningPage />);
		expect(screen.getByRole("status", { name: "正在读取食堂数据" })).toBeVisible();
		expect(screen.getByTestId("dining-map-skeleton")).toBeInTheDocument();
		await act(async () => release(DINING_FIXTURE_MAP));
		expect(await screen.findByTestId("dining-map-panel")).toBeInTheDocument();
	});
});
