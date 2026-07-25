import { readFileSync } from "node:fs";
import { DINING_FLOORPLAN_MANIFEST } from "@campus-agent/dining/floorplans";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
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
import diningReviewImageDialogSource from "../src/components/dining/dining-review-image-dialog.tsx?raw";
import diningReviewsSource from "../src/components/dining/dining-reviews.tsx?raw";
import mapExperienceSource from "../src/components/map/map-experience.tsx?raw";
import assistantRuntimeSource from "../src/features/conversation/assistant-ui-runtime.tsx?raw";
import type {
	DiningFloorResponse,
	DiningReview,
	DiningWindowProjection,
} from "../src/features/dining/model";
import { createCampusQueryClient } from "../src/platform/query/client";
import { mockDiningFixtureApi } from "./dining-fixture-test-utils";
import { mockMapWorkspaceWidth } from "./map-page-test-utils";

const stylesSource = readFileSync("src/styles.css", "utf8");
const sharedThemeSource = readFileSync("../../packages/ui/src/theme.css", "utf8");

const diningApiMock = vi.hoisted(() => ({
	getDiningBootstrap: vi.fn(),
	getDiningFloor: vi.fn(),
	getDiningOfferingReviews: vi.fn(),
	getDiningPublication: vi.fn(),
	searchDining: vi.fn(),
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
}));
const navigateMock = vi.hoisted(() => vi.fn());
const diningRouteSearch = vi.hoisted(() => ({
	notify: null as null | (() => void),
	value: {} as Record<string, string | undefined>,
}));

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

vi.mock("@/platform/auth/client", async () => {
	const actual = await vi.importActual<typeof import("../src/platform/auth/client")>(
		"../src/platform/auth/client",
	);
	return {
		...actual,
		campusAuthClient: {
			...actual.campusAuthClient,
			useSession: () => ({
				data: sessionState.data,
				isPending: sessionState.isPending,
			}),
		},
	};
});

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

function DiningPage() {
	const [queryClient] = useState(createCampusQueryClient);
	const [, setRouteVersion] = useState(0);
	useEffect(() => {
		diningRouteSearch.notify = () => setRouteVersion((version) => version + 1);
		return () => {
			diningRouteSearch.notify = null;
		};
	}, []);
	return (
		<QueryClientProvider client={queryClient}>
			<DiningPageContent />
		</QueryClientProvider>
	);
}

describe("campus routes", () => {
	beforeEach(() => {
		sessionState.data = { user: { id: "user_01", name: "测试用户" } };
		sessionState.isPending = false;
		diningApiMock.getDiningBootstrap.mockReset();
		diningApiMock.getDiningFloor.mockReset();
		diningApiMock.getDiningOfferingReviews.mockReset();
		diningApiMock.getDiningPublication.mockReset();
		diningApiMock.getDiningPublication.mockResolvedValue({
			catalogReleaseId: "dining_release:test",
			reviewRevision: 1,
			updatedAt: "2026-07-16T00:00:00.000Z",
		});
		diningApiMock.searchDining.mockReset();
		diningFloorplanAssetMock.loadDiningFloorplanAsset.mockReset();
		diningFloorplanAssetMock.loadDiningFloorplanAsset.mockImplementation(
			async (input: { floorplanId: string; sha256: string; svgAssetUrl: string }) => {
				const manifest = DINING_FLOORPLAN_MANIFEST.find(
					(entry) => entry.floorplanId === input.floorplanId,
				);
				if (
					!manifest ||
					manifest.sha256 !== input.sha256 ||
					manifest.svgAssetUrl !== input.svgAssetUrl
				) {
					throw new Error("floorplan asset projection drifted");
				}
				return manifest.svgMarkup;
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

		expect(await screen.findByText("中央民族大学校园问答")).toBeInTheDocument();
		expect(screen.getAllByText("新对话").length).toBeGreaterThanOrEqual(1);
		expect(screen.getByRole("button", { name: "新对话" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "搜索聊天" })).toBeInTheDocument();
		expect(screen.getByText("聊天记录")).toBeInTheDocument();
		expect(screen.queryByPlaceholderText("搜索历史会话")).toBeNull();
		expect(screen.getByRole("link", { name: "文档" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "校园地图" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "食堂" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "反馈" })).toBeInTheDocument();
		expect(await screen.findByTestId("assistant-chat")).toBeInTheDocument();
		expect(screen.getByPlaceholderText("输入校园问题")).toBeInTheDocument();
		await waitFor(() => {
			expect(screen.getByRole("button", { name: "账号" })).toBeInTheDocument();
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
		expect(qaShellSource).toContain("ProductNavActions");
		expect(qaShellSource).toContain("ProductNavMobileMenu");
		expect(qaShellSource).not.toContain("supportNavItems");
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
		expect(qaShellSource).toContain("@/components/auth/auth-dialog");
		expect(qaShellSource).toContain("@/components/auth/user/account-entry");
		expect(qaShellSource).toContain("const AuthDialog = lazy(");
		expect(qaShellSource).not.toContain("SupportNavigation");
		expect(qaShellSource).not.toContain("AccountLoginDialog");
		expect(qaShellSource).not.toContain("getSessionPrincipal");
		expect(qaShellSource).not.toContain("const railActionClass");
		expect(qaShellSource).not.toContain("const railActionIconClass");
		expect(qaShellSource).not.toContain("const railActionShortcutClass");
		expect(qaShellSource).not.toContain("ChatKit 管理");
		expect(qaShellSource).not.toContain("ConversationSidebar");
		expect(qaShellSource).toContain("ThreadListSidebar");
		expect(stylesSource).toContain('@import "tailwindcss";');
		expect(stylesSource).toContain('@import "@campus-agent/ui/theme.css";');
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

	it("registers the campus services status page as a React route", () => {
		const routerSource = readFileSync("src/app/router.tsx", "utf8");

		expect(routerSource).toContain("ServicesPage");
		expect(routerSource).toContain('path: "/services"');
		expect(routerSource).toContain("./routes/services-page");
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
		expect(mapExperienceSource).toContain("@campus-agent/ui");
		expect(mapExperienceSource).not.toContain("@/components/ui/command");
		expect(mapExperienceSource).toContain("@/components/ui/popover");
	});

	it("separates the account entry from the conversation history area", async () => {
		render(<HomePage />);

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "账号" })).toBeInTheDocument();
		});
		expect(screen.queryByRole("button", { name: "登录" })).toBeNull();
		expect(screen.queryByRole("separator", { name: "账号区域" })).toBeNull();
	});

	it("keeps the desktop topbar inside the assistant content inset", async () => {
		render(<HomePage />);

		const assistantChat = await screen.findByTestId("assistant-chat");

		expect(within(assistantChat).getByText("中央民族大学校园问答")).toBeInTheDocument();
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
		expect(openMobileThreadsButton).toHaveClass("size-11");
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
		render(<HomePage />);

		expect(await screen.findByRole("button", { name: "登录" })).toHaveClass("h-11");
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

	it("keeps one feedback navigation entry on non-map support pages", () => {
		window.history.pushState({}, "", "/feedback");
		render(<RootLayout />);

		expect(screen.getByRole("link", { name: "反馈" })).toBeInTheDocument();
		expect(screen.getAllByRole("navigation", { name: "产品导航" })).toHaveLength(1);
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

		expect(screen.getByLabelText("当前页面")).toHaveTextContent("/feedback?source=map");
		expect(screen.queryByRole("textbox", { name: "当前页面" })).toBeNull();
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

	it("keeps dining floor rendering driven by the floor projection contract", () => {
		expect(diningFloorplanSource).not.toContain("getDiningFloorplanByFloor");
		expect(diningFloorplanSource).toContain("diningFloorplanAssetQueryOptions");
		expect(diningFloorplanSource).toContain("floor.floor.floorplan.floorplanId");
		expect(diningFloorplanSource).toContain("dangerouslySetInnerHTML");
		expect(diningFloorplanSource).toContain("[data-dining-anchor-id]");
		expect(diningFloorplanSource).not.toContain("h-full min-h-36");
		expect(diningExperienceSource).not.toContain("DiningReviewList");
		expect(diningReviewsSource).toContain("暂无评价");
		expect(diningReviewsSource).toContain("alt={image.alt}");
		expect(diningReviewsSource).toContain("overflow-x-auto");
		expect(diningControlsSource).toContain("DiningHallSwitcher");
		expect(diningControlsSource).toContain("SelectGroup");
		expect(diningControlsSource).toContain("Popover");
		expect(diningControlsSource).not.toContain("shrink-0 rounded-full");
		expect(diningFloorplanSource).toContain('import("./dining-floorplan-zoom")');
		expect(diningFloorplanZoomSource).toContain("react-zoom-pan-pinch");
		expect(diningFloorplanZoomSource).toContain("maxScale={2}");
		expect(diningFloorplanZoomSource).toContain("wheel={{ step: WHEEL_ZOOM_STEP }}");
		expect(diningFloorplanZoomSource).toContain("doubleClick={{ disabled: true }}");
		expect(diningFloorplanZoomSource).toContain("BUTTON_ZOOM_STEP = 0.16");
		expect(diningFloorplanZoomSource).toContain("WHEEL_ZOOM_STEP = 0.002");
		expect(diningFloorplanZoomSource).toContain("ZOOM_ANIMATION_MS = 220");
		expect(diningFloorplanZoomSource).toContain("RESET_ANIMATION_MS = 280");
		expect(diningFloorplanZoomSource).toContain("prefers-reduced-motion: reduce");
		expect(diningFloorplanZoomSource).toContain('animationType: "easeOutCubic"');
		expect(diningFloorplanZoomSource).toContain("will-change-transform");
		expect(diningFloorplanZoomSource).toContain("disablePadding");
		expect(diningControlsSource).not.toContain("查看地图");
		expect(diningReviewsSource).toContain("lazy(() =>");
		expect(diningReviewsSource).toContain('import("./dining-review-image-dialog")');
		expect(diningReviewsSource).not.toContain('from "../ui/dialog"');
		expect(diningReviewImageDialogSource).toContain("DialogContent");
		expect(diningReviewsSource).toMatch(/aria-label=\{`预览\$\{image\.alt\}`\}/);
		expect(diningFloorplanSource).toContain("parseDiningFloorplanViewBox");
		expect(diningFloorplanSource).toContain("style={{ aspectRatio }}");
		expect(diningExperienceSource).not.toContain("StallList");
		expect(diningFloorplanSource).not.toContain("min-w-0 max-h-[360px]");
		expect(diningFloorplanSource).toContain('"dining-floorplan-surface"');
		expect(diningFloorplanSource).toContain("floorplanKey");
		expect(diningFloorplanSource).toContain("key={floorplanKey}");
		expect(diningFloorplanSource).not.toContain("nearestWindowForPoint");
		expect(diningFloorplanSource).toContain("touch-pan-y");
		expect(diningFloorplanSource).not.toContain("is-unassigned");
		expect(diningFloorplanSource).toContain("matchedWindowIds");
		expect(diningFloorplanSource).toContain("is-dimmed");
		expect(diningFloorplanSource).toContain("useLayoutEffect");
		expect(diningFloorplanSource).toContain("DiningFloorplanSvg");
		expect(diningFloorplanSource).not.toContain("min-w-[640px]");
		expect(diningFloorplanSource).not.toContain("<fieldset");
		expect(diningFloorplanSource).toContain('data-testid="dining-inline-floorplan"');
		expect(diningPageSource).toContain("campusTags");
		expect(diningPageSource).toContain("diningFloorQueryOptions");
		expect(diningPageSource).toContain("diningReviewsQueryOptions");
		expect(diningPageSource).toContain("scrollIntoView");
		expect(diningPageSource).toContain("requestAnimationFrame");
		expect(diningPageSource).toContain("REVIEW_LOADING_DELAY_MS = 150");
		expect(diningPageSource).toContain("matchMedia");
		expect(diningReviewsSource).toContain("DiningReviewsState");
		expect(diningReviewsSource).toContain('status: "pending"');
		expect(diningPageSource).not.toContain('id: "rice-bowl"');
		expect(diningFloorplanSource).not.toContain("x: 56");
		expect(diningFloorplanSource).not.toContain("y: 72");
		expect(diningPageSource).not.toContain("stalls");
		expect(diningExperienceSource).not.toContain("stalls");
		expect(diningExperienceSource).not.toContain("已下架");
		expect(diningExperienceSource).not.toContain('?? "标准"');
	});

	it("renders dining map-first hall selector, interactive stalls, and menu references", async () => {
		const user = userEvent.setup();
		mockDiningFixtureApi(diningApiMock);
		render(<DiningPage />);

		expect(await screen.findByText("食堂")).toBeInTheDocument();
		expect((await screen.findAllByText("海淀一食堂")).length).toBeGreaterThan(0);
		expect((await screen.findAllByText("荟贤食堂")).length).toBeGreaterThan(0);
		expect(screen.getByRole("combobox", { name: "选择食堂" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "海淀一食堂" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect(screen.queryByText("1 层 · 1 个餐饮点")).toBeNull();
		expect(screen.queryByText("9-18 元")).toBeNull();
		expect(await screen.findByRole("button", { name: "选择鱼粉" })).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "选择档口" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "选择鱼粉" })).toHaveAttribute(
			"aria-pressed",
			"false",
		);
		expect(screen.getByTestId("dining-review-panel")).toHaveTextContent("选择菜品查看评价");
		await user.click(screen.getByRole("button", { name: "选择鱼粉" }));
		expect(screen.getByRole("heading", { name: "鱼粉" })).toBeInTheDocument();
		expect(screen.getAllByText("金汤鱼粉")).toHaveLength(1);
		expect(screen.getByText("鱼粉招牌菜")).toBeInTheDocument();
		expect(screen.getByRole("radio", { name: /金汤鱼粉/ })).not.toBeChecked();
		expect(screen.getByTestId("dining-review-panel")).toHaveTextContent("选择菜品查看评价");
		expect(diningApiMock.getDiningOfferingReviews).not.toHaveBeenCalled();
		await user.click(screen.getByRole("radio", { name: /金汤鱼粉/ }));
		expect(await screen.findByLabelText("评价")).toBeInTheDocument();
		expect(screen.getByText("果小生")).toBeInTheDocument();
		expect(screen.getByText("有一点辣，有一点酸。")).toBeInTheDocument();
		expect(screen.queryByText(/Feishu 食堂采集/)).toBeNull();
		expect(screen.queryByRole("img", { name: "金汤鱼粉评价图片" })).toBeNull();
		const mapPanel = screen.getByTestId("dining-map-panel");
		const reviewPanel = screen.getByTestId("dining-review-panel");
		const detailPanel = screen.getByTestId("dining-stall-detail");
		const selectionPanel = screen.getByTestId("dining-selection-panel");
		expect(within(detailPanel).getByRole("heading", { name: "鱼粉" })).toBeInTheDocument();
		expect(reviewPanel).toHaveAttribute("aria-label", "评价");
		expect(within(reviewPanel).getByText("有一点辣，有一点酸。")).toBeInTheDocument();
		expect(within(reviewPanel).queryByText("鱼粉招牌菜")).toBeNull();
		expect(within(reviewPanel).queryByText("汤底清爽。")).toBeNull();
		await user.click(within(detailPanel).getByRole("radio", { name: "清淡鱼粉" }));
		expect(screen.getByTestId("dining-review-panel")).toHaveAttribute("aria-label", "评价");
		expect(
			within(screen.getByTestId("dining-review-panel")).getByText("暂无评价"),
		).toBeInTheDocument();
		expect(within(screen.getByTestId("dining-review-panel")).queryByText("金汤鱼粉")).toBeNull();
		expect(within(screen.getByTestId("dining-review-panel")).queryByText("汤底清爽。")).toBeNull();
		await user.click(within(detailPanel).getByRole("radio", { name: /金汤鱼粉/ }));
		expect(
			within(reviewPanel).getByRole("button", { name: "预览金汤鱼粉评价图片" }),
		).toBeInTheDocument();
		expect(selectionPanel).toContainElement(mapPanel);
		expect(selectionPanel).toContainElement(detailPanel);
		expect(selectionPanel).not.toContainElement(reviewPanel);
		expect(selectionPanel.nextElementSibling).toBe(reviewPanel);
		expect(within(mapPanel).queryByLabelText("评价")).toBeNull();
		expect(within(mapPanel).queryByText("有一点辣，有一点酸。")).toBeNull();
		expect(within(mapPanel).queryByRole("img", { name: "金汤鱼粉评价图片" })).toBeNull();
		expect(within(detailPanel).queryByLabelText("评价")).toBeNull();
		expect(within(detailPanel).queryByText("有一点辣，有一点酸。")).toBeNull();
		expect(within(detailPanel).queryByRole("img", { name: "金汤鱼粉评价图片" })).toBeNull();
		expect(diningApiMock.getDiningBootstrap).toHaveBeenCalledTimes(1);
		expect(diningApiMock.getDiningFloor).not.toHaveBeenCalledWith(
			expect.objectContaining({ hallId: "haidian-canteen-1" }),
		);
		expect(diningApiMock.getDiningOfferingReviews).toHaveBeenCalledWith(
			expect.objectContaining({ offeringId: "offering:rice:1" }),
		);
		expect(screen.queryByText("参考价格")).toBeNull();
		expect(screen.getAllByText("12 元").length).toBeGreaterThan(0);
		expect(screen.queryByText("16 元")).toBeNull();
		expect(screen.queryByText("标准份")).toBeNull();
		expect(screen.queryByText("可售")).toBeNull();
		expect(screen.queryByText("季节供应")).toBeNull();
		expect(screen.queryByText("dining_release:dev_seed")).toBeNull();
		expect(screen.getByLabelText("选择鱼粉")).toBeInTheDocument();
		expect(screen.getByTestId("dining-inline-floorplan").querySelector("svg")).not.toBeNull();
		expect(screen.queryByRole("button", { name: "放大平面图" })).toBeNull();
		expect(screen.queryByRole("button", { name: "缩小平面图" })).toBeNull();
		expect(screen.queryByRole("button", { name: "显示完整平面图" })).toBeNull();
		expect(screen.queryByTestId("dining-selected-map-label")).toBeNull();
		expect(
			within(screen.getByTestId("dining-inline-floorplan")).getByText("鱼粉"),
		).toBeInTheDocument();
		expect(
			within(screen.getByTestId("dining-inline-floorplan")).getByText("螺蛳粉"),
		).toBeInTheDocument();
		expect(
			within(screen.getByTestId("dining-inline-floorplan")).getByText("四川风味"),
		).toBeInTheDocument();
		expect(within(screen.getByTestId("dining-inline-floorplan")).queryByText("01")).toBeNull();
		expect(within(screen.getByTestId("dining-inline-floorplan")).queryByText("02")).toBeNull();
		await user.click(screen.getByTestId("dining-anchor-window-01"));
		expect(screen.getByTestId("dining-anchor-window-01")).toHaveClass("is-selected");
		expect(screen.queryByRole("button", { name: "鱼粉" })).toBeNull();
		const searchInput = screen.getByRole("combobox", { name: "搜索海淀校区的档口或菜品" });
		await user.type(searchInput, "金汤");
		expect(screen.getAllByText("海淀一食堂").length).toBeGreaterThan(0);
		expect(screen.getByRole("button", { name: "荟贤食堂" })).toBeInTheDocument();
		expect(screen.queryByText("当前校区没有匹配结果")).not.toBeInTheDocument();
		expect((await screen.findAllByText("1 个结果")).length).toBeGreaterThan(0);
		expect(screen.getByTestId("dining-anchor-window-01")).toBeInTheDocument();
		expect(screen.getByTestId("dining-anchor-window-02")).toHaveClass("is-dimmed");
		expect(screen.queryByRole("button", { name: "选择二号窗口" })).toBeNull();
		await user.clear(searchInput);
		await user.type(searchInput, "不存在的菜");
		expect(await screen.findByText("当前校区没有匹配结果")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "海淀一食堂" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "荟贤食堂" })).toBeInTheDocument();
		expect(screen.getByTestId("dining-inline-floorplan")).toBeInTheDocument();
		expect(within(detailPanel).getByRole("heading", { name: "选择档口" })).toBeInTheDocument();
		await user.clear(searchInput);
		await user.click(screen.getByRole("button", { name: "筛选餐饮标签" }));
		await user.click(screen.getByRole("radio", { name: "热餐" }));
		expect(await screen.findByRole("button", { name: "选择螺蛳粉" })).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "筛选：热餐" }));
		await user.click(screen.getByRole("radio", { name: "全部" }));
		expect(screen.getByRole("button", { name: "选择鱼粉" })).toBeInTheDocument();

		expect((await screen.findAllByText("海淀一食堂")).length).toBeGreaterThan(0);
		await user.click(await screen.findByRole("button", { name: "荟贤食堂" }));

		expect((await screen.findAllByText("荟贤食堂一层")).length).toBeGreaterThan(0);
		await user.click(screen.getByRole("radio", { name: "二层" }));
		expect((await screen.findAllByText("荟贤食堂二层")).length).toBeGreaterThan(0);
		await user.click(screen.getByRole("button", { name: "海淀一食堂" }));

		expect((await screen.findAllByText("海淀一食堂")).length).toBeGreaterThan(0);
		expect(diningApiMock.getDiningFloor).not.toHaveBeenCalledWith({
			floorId: "fengtai-huixian-canteen-2f",
			hallId: "haidian-canteen-1",
		});
	});

	it("retries dining hall and floor requests without reloading the page", async () => {
		const user = userEvent.setup();
		mockDiningFixtureApi(diningApiMock);
		const getFloor = diningApiMock.getDiningFloor.getMockImplementation();
		diningApiMock.getDiningBootstrap.mockRejectedValueOnce(new Error("halls unavailable"));

		render(<DiningPage />);

		const hallsError = await screen.findByRole("alert", { name: "食堂数据不可用" });
		await user.click(within(hallsError).getByRole("button", { name: "重试" }));
		expect(await screen.findByRole("button", { name: "海淀一食堂" })).toBeInTheDocument();
		expect(diningApiMock.getDiningBootstrap).toHaveBeenCalledTimes(2);

		diningApiMock.getDiningFloor.mockRejectedValue(new Error("floor unavailable"));
		await user.click(await screen.findByRole("button", { name: "荟贤食堂" }));
		const floorError = await screen.findByRole("alert", { name: "食堂地图不可用" });
		expect(floorError).toHaveTextContent("食堂平面图暂时无法打开。");
		expect(screen.queryByText("暂时没有可展示的食堂地图。")).toBeNull();
		diningApiMock.getDiningFloor.mockImplementation(getFloor ?? (() => Promise.reject()));
		await user.click(within(floorError).getByRole("button", { name: "重试" }));
		expect(await screen.findByTestId("dining-inline-floorplan")).toBeInTheDocument();
		expect(diningApiMock.getDiningFloor).toHaveBeenCalledWith(
			expect.objectContaining({
				floorId: "fengtai-huixian-canteen-1f",
				hallId: "fengtai-huixian-canteen",
			}),
		);
	});

	it("keeps the current hall when an earlier floor request resolves late", async () => {
		const user = userEvent.setup();
		mockDiningFixtureApi(diningApiMock);
		const getFloor = diningApiMock.getDiningFloor.getMockImplementation();
		const delayedRequest = {
			floorId: "fengtai-huixian-canteen-1f",
			hallId: "fengtai-huixian-canteen",
		};
		const delayedFloor = await getFloor?.(delayedRequest);
		if (!delayedFloor) {
			throw new Error("Dining fixture did not produce the delayed floor.");
		}
		const pendingFloor = deferred<unknown>();
		diningApiMock.getDiningFloor.mockImplementation((input) =>
			input.hallId === delayedRequest.hallId && input.floorId === delayedRequest.floorId
				? pendingFloor.promise
				: (getFloor?.(input) ?? Promise.reject(new Error("missing dining projection"))),
		);

		render(<DiningPage />);

		expect(await screen.findByTestId("dining-inline-floorplan")).toHaveTextContent("鱼粉");
		await user.click(screen.getByRole("button", { name: "荟贤食堂" }));
		await waitFor(() =>
			expect(diningApiMock.getDiningFloor).toHaveBeenCalledWith(
				expect.objectContaining(delayedRequest),
			),
		);
		await user.click(screen.getByRole("button", { name: "海淀一食堂" }));
		expect(screen.getByTestId("dining-map-panel")).toHaveTextContent("海淀一食堂");

		pendingFloor.resolve(delayedFloor);
		await waitFor(() => {
			expect(screen.getByTestId("dining-map-panel")).toHaveTextContent("海淀一食堂");
			expect(screen.getByTestId("dining-map-panel")).not.toHaveTextContent("荟贤食堂一层");
		});
	});

	it("keeps review loading and retry states inside the review panel", async () => {
		const user = userEvent.setup();
		const pendingReviews = deferred<{ offeringId: string; reviews: [] }>();
		mockDiningFixtureApi(diningApiMock);
		const getReviews = diningApiMock.getDiningOfferingReviews.getMockImplementation();
		diningApiMock.getDiningOfferingReviews.mockImplementation(
			({ offeringId }: { offeringId: string }) =>
				offeringId === "offering:rice:1" ? pendingReviews.promise : getReviews?.({ offeringId }),
		);

		render(<DiningPage />);

		expect(await screen.findByTestId("dining-inline-floorplan")).toBeInTheDocument();
		await user.click(await screen.findByRole("button", { name: "选择鱼粉" }));
		await user.click(screen.getByRole("radio", { name: /金汤鱼粉/ }));
		const reviewPanel = screen.getByTestId("dining-review-panel");
		expect(within(reviewPanel).getByRole("status", { name: "正在读取评价" })).toHaveAttribute(
			"aria-busy",
			"true",
		);
		expect(reviewPanel.querySelector(".animate-pulse")).toBeNull();
		expect(within(reviewPanel).queryByText("暂无评价")).toBeNull();
		await waitFor(() => expect(reviewPanel.querySelector(".animate-pulse")).not.toBeNull(), {
			timeout: 500,
		});

		pendingReviews.reject(new Error("reviews unavailable"));
		expect(await within(reviewPanel).findByText("评价暂时无法读取。")).toBeInTheDocument();
		diningApiMock.getDiningOfferingReviews.mockImplementation(
			getReviews ?? (() => Promise.reject()),
		);
		await user.click(within(reviewPanel).getByRole("button", { name: "重试" }));
		expect(await within(reviewPanel).findByText("有一点辣，有一点酸。")).toBeInTheDocument();
		expect(diningApiMock.getDiningOfferingReviews).toHaveBeenLastCalledWith(
			expect.objectContaining({ offeringId: "offering:rice:1" }),
		);
	});

	it("turns a mismatched floor response into a retryable local error", async () => {
		const user = userEvent.setup();
		mockDiningFixtureApi(diningApiMock);
		const getFloor = diningApiMock.getDiningFloor.getMockImplementation();
		diningApiMock.getDiningFloor.mockImplementation(async (input) => {
			const payload = (await getFloor?.(input)) as DiningFloorResponse;
			return input.hallId === "fengtai-huixian-canteen"
				? { ...payload, floor: { ...payload.floor, hallId: "wrong-hall" } }
				: payload;
		});

		render(<DiningPage />);

		await user.click(await screen.findByRole("button", { name: "荟贤食堂" }));
		const floorError = await screen.findByRole("alert", { name: "食堂地图不可用" });
		expect(floorError).toHaveTextContent("食堂平面图暂时无法打开。");
		expect(screen.queryByRole("status", { name: "正在读取食堂地图" })).toBeNull();
		diningApiMock.getDiningFloor.mockImplementation(getFloor ?? (() => Promise.reject()));
		await user.click(within(floorError).getByRole("button", { name: "重试" }));
		expect(await screen.findByTestId("dining-inline-floorplan")).toBeInTheDocument();
	});

	it("clears an active dish search while switching halls", async () => {
		const user = userEvent.setup();
		mockDiningFixtureApi(diningApiMock);
		const getFloor = diningApiMock.getDiningFloor.getMockImplementation();
		const nextFloor = deferred<DiningFloorResponse>();
		const nextFloorPayload = (await getFloor?.({
			floorId: "fengtai-huixian-canteen-1f",
			hallId: "fengtai-huixian-canteen",
		})) as DiningFloorResponse;
		diningApiMock.getDiningFloor.mockImplementation((input) =>
			input.hallId === "fengtai-huixian-canteen" ? nextFloor.promise : getFloor?.(input),
		);

		render(<DiningPage />);

		expect(await screen.findByTestId("dining-map-panel")).toHaveTextContent("海淀一食堂");
		await user.type(screen.getByRole("combobox", { name: "搜索海淀校区的档口或菜品" }), "金汤");
		await user.click(screen.getByRole("button", { name: "荟贤食堂" }));

		expect(screen.getByRole("status", { name: "正在读取食堂地图" })).toHaveAttribute(
			"aria-busy",
			"true",
		);
		expect(screen.getByTestId("dining-map-skeleton")).toBeInTheDocument();
		expect(screen.getByTestId("dining-detail-skeleton")).toBeInTheDocument();
		expect(screen.queryByTestId("dining-map-panel")).toBeNull();
		nextFloor.resolve(nextFloorPayload);
		expect(await screen.findByTestId("dining-map-panel")).toHaveTextContent("荟贤食堂一层");
		expect(screen.getByTestId("dining-map-panel")).not.toHaveTextContent("海淀一食堂");
		expect(screen.getByRole("combobox", { name: "搜索丰台校区的档口或菜品" })).toHaveValue("");
	});

	it("reuses cached floor and review data when revisiting a hall", async () => {
		const user = userEvent.setup();
		mockDiningFixtureApi(diningApiMock);

		render(<DiningPage />);

		expect(await screen.findByTestId("dining-map-panel")).toHaveTextContent("海淀一食堂");
		await user.click(await screen.findByRole("button", { name: "选择鱼粉" }));
		await user.click(screen.getByRole("radio", { name: /金汤鱼粉/ }));
		expect(await screen.findByText("有一点辣，有一点酸。")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "荟贤食堂" }));
		expect(await screen.findByTestId("dining-map-panel")).toHaveTextContent("荟贤食堂一层");
		await user.click(screen.getByRole("button", { name: "海淀一食堂" }));

		expect(screen.queryByRole("status", { name: "正在读取食堂地图" })).toBeNull();
		expect(screen.getByTestId("dining-map-panel")).toHaveTextContent("海淀一食堂");
		await user.click(await screen.findByRole("button", { name: "选择鱼粉" }));
		await user.click(screen.getByRole("radio", { name: /金汤鱼粉/ }));
		expect(await screen.findByText("有一点辣，有一点酸。")).toBeInTheDocument();
		expect(
			diningApiMock.getDiningFloor.mock.calls.filter(
				([input]) => input.hallId === "haidian-canteen-1",
			),
		).toHaveLength(0);
		expect(
			diningApiMock.getDiningOfferingReviews.mock.calls.filter(
				([input]) => input.offeringId === "offering:rice:1",
			),
		).toHaveLength(1);
	});

	it("preloads sibling floor data and map assets before switching floors", async () => {
		const user = userEvent.setup();
		mockDiningFixtureApi(diningApiMock);

		render(<DiningPage />);

		await user.click(await screen.findByRole("button", { name: "荟贤食堂" }));
		expect(await screen.findByTestId("dining-map-panel")).toHaveTextContent("荟贤食堂一层");
		await waitFor(() =>
			expect(diningApiMock.getDiningFloor).toHaveBeenCalledWith(
				expect.objectContaining({
					floorId: "fengtai-huixian-canteen-2f",
					hallId: "fengtai-huixian-canteen",
				}),
			),
		);
		await waitFor(() =>
			expect(diningFloorplanAssetMock.loadDiningFloorplanAsset).toHaveBeenCalledWith(
				expect.objectContaining({
					floorplanId: "floorplan:fengtai-huixian-canteen:fengtai-huixian-canteen-2f",
				}),
			),
		);
		const floorRequestCount = diningApiMock.getDiningFloor.mock.calls.length;
		const assetRequestCount = diningFloorplanAssetMock.loadDiningFloorplanAsset.mock.calls.length;

		await user.click(screen.getByRole("radio", { name: "二层" }));

		expect(screen.queryByRole("status", { name: "正在读取食堂地图" })).toBeNull();
		expect(screen.getByTestId("dining-map-panel")).toHaveTextContent("荟贤食堂二层");
		expect(diningApiMock.getDiningFloor).toHaveBeenCalledTimes(floorRequestCount);
		expect(diningFloorplanAssetMock.loadDiningFloorplanAsset).toHaveBeenCalledTimes(
			assetRequestCount,
		);
	});

	it("keeps the initial stall detail neutral even when assigned windows exist", async () => {
		const fixture = mockDiningFixtureApi(diningApiMock);
		diningApiMock.getDiningBootstrap.mockResolvedValue({
			halls: fixture.halls,
			initial: {
				floor: {
					...fixture.initialFloor,
					windows: fixture.initialFloor.windows.map((window, index) =>
						index === 0 ? { ...window, assignment: null } : window,
					),
				},
			},
		});

		render(<DiningPage />);

		expect(await screen.findByRole("heading", { name: "选择档口" })).toBeInTheDocument();
		expect(screen.queryByRole("heading", { name: "螺蛳粉" })).toBeNull();
		expect(screen.queryByTestId("dining-anchor-window-01")).toBeNull();
		expect(await screen.findByRole("button", { name: "选择螺蛳粉" })).toHaveAttribute(
			"aria-pressed",
			"false",
		);
	});

	it("keeps generated placeholder anchors interactive without published SVG bindings", async () => {
		const fixture = mockDiningFixtureApi(diningApiMock);
		diningApiMock.getDiningBootstrap.mockResolvedValue({
			halls: fixture.halls,
			initial: {
				floor: {
					...fixture.initialFloor,
					floor: {
						...fixture.initialFloor.floor,
						floorplan: {
							floorplanId: `placeholder:${fixture.initialFloor.floor.hallId}:${fixture.initialFloor.floor.floorId}`,
							kind: "placeholder",
						},
					},
					windows: fixture.initialFloor.windows.map((window) => ({ ...window, svgAnchorId: null })),
				},
			},
		});

		render(<DiningPage />);

		expect(await screen.findByRole("button", { name: "选择鱼粉" })).toBeInTheDocument();
		expect(screen.getByTestId("dining-inline-floorplan")).toHaveTextContent("鱼粉");
		expect(screen.getByTestId("dining-inline-floorplan")).toHaveTextContent("螺蛳粉");
		expect(screen.getByTestId("dining-inline-floorplan")).not.toHaveTextContent("01");
	});

	it("fails closed inside the map when the published floorplan manifest drifts", async () => {
		const fixture = mockDiningFixtureApi(diningApiMock);
		diningApiMock.getDiningBootstrap.mockResolvedValue({
			halls: fixture.halls,
			initial: {
				floor: {
					...fixture.initialFloor,
					floor: {
						...fixture.initialFloor.floor,
						floorplan: {
							floorplanId: "floorplan:unknown:drifted",
							kind: "asset",
						},
					},
				},
			},
		});

		render(<DiningPage />);

		expect(await screen.findByRole("alert", { name: "平面图暂时无法显示" })).toBeInTheDocument();
		expect(screen.getByTestId("dining-stall-detail")).toBeInTheDocument();
	});

	it.each<[string, (windows: DiningWindowProjection[]) => DiningWindowProjection[]]>([
		[
			"missing",
			(windows) =>
				windows.map((window, index) => (index === 0 ? { ...window, svgAnchorId: null } : window)),
		],
		[
			"unknown",
			(windows) =>
				windows.map((window, index) =>
					index === 0 ? { ...window, svgAnchorId: "unknown-window" } : window,
				),
		],
		["duplicate", (windows) => windows.map((window) => ({ ...window, svgAnchorId: "window-01" }))],
	])("fails closed for %s formal floorplan window bindings", async (_case, corruptWindows) => {
		const fixture = mockDiningFixtureApi(diningApiMock);
		diningApiMock.getDiningBootstrap.mockResolvedValue({
			halls: fixture.halls,
			initial: {
				floor: {
					...fixture.initialFloor,
					windows: corruptWindows(fixture.initialFloor.windows),
				},
			},
		});

		render(<DiningPage />);

		expect(await screen.findByRole("alert", { name: "平面图暂时无法显示" })).toBeInTheDocument();
	});

	it("keeps dining review failures scoped to the review panel", async () => {
		const fixture = mockDiningFixtureApi(diningApiMock);
		diningApiMock.getDiningBootstrap.mockResolvedValue({
			halls: fixture.halls,
			initial: { floor: fixture.initialFloor },
		});
		diningApiMock.getDiningOfferingReviews.mockRejectedValue(new Error("reviews unavailable"));

		render(<DiningPage />);

		expect(await screen.findByTestId("dining-inline-floorplan")).toBeInTheDocument();
		await userEvent.setup().click(await screen.findByRole("button", { name: "选择鱼粉" }));
		await userEvent.setup().click(screen.getByRole("radio", { name: /金汤鱼粉/ }));
		expect(screen.getByTestId("dining-stall-detail")).toBeInTheDocument();
		const reviewPanel = await screen.findByTestId("dining-review-panel");
		expect(reviewPanel).toHaveTextContent("评价暂时无法读取。");
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("fails closed when reviews belong to another offering", async () => {
		const fixture = mockDiningFixtureApi(diningApiMock);
		diningApiMock.getDiningBootstrap.mockResolvedValue({
			halls: fixture.halls,
			initial: { floor: fixture.initialFloor },
		});
		diningApiMock.getDiningOfferingReviews.mockResolvedValue({
			offeringId: "wrong-offering",
			reviews: [
				createDiningReviewForTest({
					comment: "错误菜品评价",
					hallId: "haidian-canteen-1",
					label: "错误菜品",
				}),
			],
		});

		render(<DiningPage />);

		await userEvent.setup().click(await screen.findByRole("button", { name: "选择鱼粉" }));
		await userEvent.setup().click(screen.getByRole("radio", { name: /金汤鱼粉/ }));
		const reviewPanel = await screen.findByTestId("dining-review-panel");
		expect(reviewPanel).toHaveTextContent("评价暂时无法读取。");
		expect(reviewPanel).not.toHaveTextContent("错误菜品评价");
	});

	it("opens dining review image previews from the review panel", async () => {
		const user = userEvent.setup();
		mockDiningFixtureApi(diningApiMock);

		render(<DiningPage />);

		expect(await screen.findByTestId("dining-review-panel")).toBeInTheDocument();
		await user.click(await screen.findByRole("button", { name: "选择鱼粉" }));
		await user.click(screen.getByRole("radio", { name: /金汤鱼粉/ }));
		await user.click(screen.getByRole("button", { name: "预览金汤鱼粉评价图片" }));

		expect(await screen.findByRole("dialog", { name: "金汤鱼粉评价图片" })).toBeInTheDocument();
		expect(screen.getByRole("img", { name: "金汤鱼粉评价图片" })).toHaveAttribute(
			"src",
			"/assets/dining/reviews/rec27DpktN6uQn-1.jpg",
		);
	});

	it("keeps mobile stall selection inline without scrolling or transforming the map", async () => {
		const user = userEvent.setup();
		mockDiningFixtureApi(diningApiMock);
		const scrollIntoView = vi.fn();
		HTMLElement.prototype.scrollIntoView = scrollIntoView;

		try {
			render(<DiningPage />);

			expect(await screen.findByRole("button", { name: "选择鱼粉" })).toBeInTheDocument();
			await user.click(screen.getByTestId("dining-anchor-window-02"));
			expect(scrollIntoView).not.toHaveBeenCalled();
			expect(screen.getByRole("heading", { name: "螺蛳粉" })).toBeInTheDocument();
			expect(screen.getByTestId("dining-floorplan-surface")).toHaveClass("touch-pan-y");
			expect(screen.getByTestId("dining-floorplan-surface")).not.toHaveAttribute("style");
		} finally {
			delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
		}
	});

	it("renders dining empty state when no published halls exist", async () => {
		diningApiMock.getDiningBootstrap.mockResolvedValue({ halls: [], initial: null });

		render(<DiningPage />);

		expect(screen.getByRole("status", { name: "正在读取食堂数据" })).toHaveAttribute(
			"aria-busy",
			"true",
		);
		expect(screen.getByTestId("dining-map-skeleton")).toBeInTheDocument();
		expect(screen.getByTestId("dining-detail-skeleton")).toBeInTheDocument();
		expect(await screen.findByText("暂时没有可展示的食堂信息。")).toBeInTheDocument();
		expect(screen.getByRole("status", { name: "暂无内容" })).toHaveTextContent(
			"暂时没有可展示的食堂信息。",
		);
		expect(screen.queryByText("正在读取食堂数据")).not.toBeInTheDocument();
		expect(diningApiMock.getDiningFloor).not.toHaveBeenCalled();
	});

	it("renders the assistant conversation shell as the thread surface", async () => {
		render(<ConversationPage />);

		expect(await screen.findByText("中央民族大学校园问答")).toBeInTheDocument();
		expect(screen.getByText("会话")).toBeInTheDocument();
		expect(await screen.findByTestId("assistant-chat")).toBeInTheDocument();
		expect(conversationApiMock.getConversationDetail).toHaveBeenCalledWith("conv_01");
	});

	it("renders fail-closed not found page", () => {
		render(<NotFoundPage />);

		expect(screen.getByText("页面不存在")).toBeInTheDocument();
	});
});

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((nextResolve, nextReject) => {
		resolve = nextResolve;
		reject = nextReject;
	});
	return { promise, reject, resolve };
}

function createDiningReviewForTest(input: {
	comment: string;
	hallId: string;
	label: string;
}): DiningReview {
	return {
		comment: input.comment,
		contributorName: "测试用户",
		images: [],
		paidPriceLabel: null,
		rating: null,
		reviewId: `review:${input.hallId}`,
		submittedAt: "2026-07-11T08:00:00.000Z",
	};
}
