import type { UseChatKitOptions } from "@openai/chatkit-react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundPage, RootLayout } from "../src/app/root-layout";
import rootLayoutSource from "../src/app/root-layout.tsx?raw";
import { ConversationPage } from "../src/app/routes/conversation-page";
import { DiningPage } from "../src/app/routes/dining-page";
import diningPageSource from "../src/app/routes/dining-page.tsx?raw";
import { DocsPage } from "../src/app/routes/docs-page";
import { FeedbackPage } from "../src/app/routes/feedback-page";
import { HomePage } from "../src/app/routes/home-page";
import homePageSource from "../src/app/routes/home-page.tsx?raw";
import qaAccountEntrySource from "../src/components/conversation/qa-account-entry.tsx?raw";
import qaShellSource from "../src/components/conversation/qa-shell.tsx?raw";
import diningExperienceSource from "../src/components/dining/dining-experience.tsx?raw";
import { UnauthorizedError } from "../src/platform/api/client";

const diningApiMock = vi.hoisted(() => ({
	getDiningFloor: vi.fn(),
	getDiningHalls: vi.fn(),
}));
const docsApiMock = vi.hoisted(() => ({
	getDocsNavigation: vi.fn(),
	resolveDocument: vi.fn(),
}));
const feedbackApiMock = vi.hoisted(() => ({
	submitFeedback: vi.fn(),
}));
const conversationApiMock = vi.hoisted(() => ({
	getSessionPrincipal: vi.fn(),
}));
const useChatKitMock = vi.hoisted(() =>
	vi.fn((_: UseChatKitOptions) => ({ control: { id: "control" }, showHistory: vi.fn() })),
);
const navigateMock = vi.hoisted(() => vi.fn());

vi.mock("@openai/chatkit-react", () => ({
	ChatKit: ({ className, control }: { className?: string; control: unknown }) => (
		<div className={className} data-control={JSON.stringify(control)} data-testid="chatkit" />
	),
	useChatKit: useChatKitMock,
}));

function getLastChatKitOptions(): UseChatKitOptions {
	const call = useChatKitMock.mock.calls.at(-1);
	if (!call) {
		throw new Error("useChatKit was not called.");
	}
	return call[0] as UseChatKitOptions;
}

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
			search: window.location.search,
		}),
		useNavigate: () => navigateMock,
	};
});

vi.mock("../src/features/conversation/api", () => ({
	getSessionPrincipal: conversationApiMock.getSessionPrincipal,
}));

vi.mock("../src/features/docs/api", () => docsApiMock);
vi.mock("../src/features/feedback/api", () => feedbackApiMock);

vi.mock("../src/features/dining/api", () => diningApiMock);

describe("campus routes", () => {
	beforeEach(() => {
		conversationApiMock.getSessionPrincipal.mockReset();
		conversationApiMock.getSessionPrincipal.mockResolvedValue({
			permissions: {
				chat: true,
				operator: false,
			},
			principal: {
				displayName: "测试用户",
				email: "user@muc.edu.cn",
				principalId: "principal_01",
				type: "campus_member",
			},
			session: {
				expiresAt: "2026-06-09T12:00:00.000Z",
				sessionId: "session_01",
			},
		});
		diningApiMock.getDiningHalls.mockReset();
		diningApiMock.getDiningFloor.mockReset();
		docsApiMock.getDocsNavigation.mockReset();
		docsApiMock.resolveDocument.mockReset();
		docsApiMock.getDocsNavigation.mockResolvedValue({
			collection: {
				collection: "student_rules",
				corpus: "regulations",
				displayName: "学生手册",
			},
			nodes: [
				{
					canonicalUrl: "/docs/regulations/student_rules/index",
					documentSlug: "index",
					isCurrent: true,
					kind: "document",
					title: "总则",
				},
			],
		});
		docsApiMock.resolveDocument.mockResolvedValue({
			document: {
				canonicalUrl: "/docs/regulations/student_rules/index",
				collection: "student_rules",
				corpus: "regulations",
				docId: "doc_01",
				documentSlug: "index",
				title: "学生手册",
				updatedAt: "2026-06-08T00:00:00.000Z",
				versionId: "version_01",
				versionSlug: "2026",
			},
			readerAsset: {
				canonicalUrl: "/docs/regulations/student_rules/index",
				contentUrl: "/assets/docs/student-rules.html",
				deliveryMode: "public_static_asset",
				outlineUrl: "/assets/docs/student-rules-outline.json",
			},
			readerState: {
				anchor: "general",
				highlightRootUnitIds: ["unit_award"],
			},
			resolvedVersion: {
				isCurrent: true,
				label: "2026",
				versionId: "version_01",
				versionSlug: "2026",
			},
		});
		feedbackApiMock.submitFeedback.mockReset();
		feedbackApiMock.submitFeedback.mockResolvedValue({
			feedback: {
				feedbackId: "feedback_01",
				receivedAt: "2026-06-08T00:00:00.000Z",
			},
		});
		navigateMock.mockReset();
		useChatKitMock.mockClear();
	});

	it("renders the v1.3 Q&A home shell without app launcher debt", async () => {
		render(<HomePage />);

		expect(await screen.findByText("中央民族大学校园问答")).toBeInTheDocument();
		expect(screen.getByText("MUC Campus Q&A")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "新对话" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "搜索聊天" })).toBeInTheDocument();
		expect(screen.queryByText("聊天记录")).toBeNull();
		expect(screen.queryByPlaceholderText("搜索历史会话")).toBeNull();
		expect(screen.getByRole("link", { name: "文档" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "校园地图" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "饭堂分布图" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "反馈" })).toBeInTheDocument();
		expect(screen.getByTestId("chatkit")).toBeInTheDocument();
		expect(useChatKitMock).toHaveBeenCalledWith(
			expect.objectContaining({
				api: expect.objectContaining({ url: "/api/chatkit" }),
				initialThread: null,
			}),
		);
		expect(await screen.findByText("测试用户")).toBeInTheDocument();
		expect(screen.getByText("user@muc.edu.cn")).toBeInTheDocument();
		expect(screen.queryByRole("menu", { name: "账号" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "测试用户 user@muc.edu.cn" }));
		expect(screen.getByRole("menu", { name: "账号" })).toBeInTheDocument();
		expect(screen.getByRole("menuitem", { name: "账号设置" })).toBeInTheDocument();
		expect(screen.getByRole("menuitem", { name: "个性化" })).toBeInTheDocument();
		expect(screen.getByRole("menuitem", { name: "帮助与反馈" })).toHaveAttribute(
			"href",
			"/feedback",
		);
		expect(screen.getByRole("menuitem", { name: "退出登录" })).toBeInTheDocument();
		fireEvent.click(screen.getByRole("menuitem", { name: "账号设置" }));
		expect(await screen.findByRole("dialog", { name: "账号设置" })).toBeInTheDocument();
		expect(getLastChatKitOptions().startScreen).toEqual({
			greeting: expect.stringMatching(
				/今天想查什么校园信息？|需要了解哪件校园事？|想问什么校园问题？|有什么校园问题想确认？/,
			),
			prompts: [],
		});
		expect(getLastChatKitOptions().disclaimer).toBeUndefined();
		expect(screen.queryByText("校园卡")).toBeNull();
		expect(screen.queryByText("食堂")).toBeNull();
		expect(screen.queryByText("找地点")).toBeNull();
		expect(
			screen.queryByText(
				"历史会话只用于找回之前的问题；文档、校园地图和饭堂分布图保留在顶部导航中。",
			),
		).toBeNull();
		expect(
			screen.queryByText("回答会在对话中给出，并在需要时打开文档、校园地图或饭堂分布图。"),
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
		expect(qaAccountEntrySource).not.toContain("rounded-full bg-[var(--sys-brand-identity)]");
		expect(qaAccountEntrySource).not.toContain(">民<");
		expect(qaAccountEntrySource).toContain("UserRound");
		expect(qaAccountEntrySource).toContain('role="menu"');
		expect(qaAccountEntrySource).toContain("ChevronUp");
		expect(qaAccountEntrySource).not.toContain("关闭账号面板");
		expect(qaShellSource).toContain("饭堂分布图");
		expect(qaShellSource).not.toContain("ChatKit 管理");
		expect(qaShellSource).not.toContain("ConversationSidebar");
		expect(qaShellSource).not.toContain("rounded-lg px-3 text-sm font-medium");
		expect(rootLayoutSource).not.toContain("移动端主导航");
	});

	it("closes the account menu when clicking outside it", async () => {
		render(<HomePage />);

		const accountButton = await screen.findByRole("button", {
			name: "测试用户 user@muc.edu.cn",
		});
		fireEvent.click(accountButton);

		expect(screen.getByRole("menu", { name: "账号" })).toBeInTheDocument();
		fireEvent.pointerDown(document.body);
		expect(screen.queryByRole("menu", { name: "账号" })).toBeNull();
	});

	it("separates the account entry from the conversation history area", async () => {
		render(<HomePage />);

		expect(await screen.findByRole("separator", { name: "账号区域" })).toBeInTheDocument();
	});

	it("places the new conversation action before chat search in the sidebar", async () => {
		render(<HomePage />);

		const newConversationLink = await screen.findByRole("link", { name: "新对话" });
		const searchButton = screen.getByRole("button", { name: "搜索聊天" });

		expect(
			newConversationLink.compareDocumentPosition(searchButton) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(screen.queryByPlaceholderText("搜索历史会话")).toBeNull();
	});

	it("opens the same inline login dialog from the signed-out account menu", async () => {
		conversationApiMock.getSessionPrincipal.mockRejectedValue(new UnauthorizedError());
		render(<HomePage />);

		fireEvent.click(await screen.findByRole("button", { name: "登录" }));
		fireEvent.click(screen.getByRole("menuitem", { name: "登录" }));

		expect(await screen.findByRole("dialog", { name: "登录" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "创建账号" })).toHaveAttribute(
			"href",
			"/account/register",
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
		expect(screen.queryByRole("link", { name: "饭堂分布图" })).toBeNull();
		expect(screen.queryByRole("link", { name: "反馈" })).toBeNull();
		expect(screen.queryByText("民")).toBeNull();
	});

	it("keeps feedback navigation visible on non-map support pages", () => {
		window.history.pushState({}, "", "/docs/regulations/student_rules/index");
		render(<RootLayout />);

		expect(screen.getAllByRole("link", { name: "反馈" })).toHaveLength(2);
	});

	it("renders the account menu as same-context login actions when signed out", async () => {
		conversationApiMock.getSessionPrincipal.mockRejectedValue(new Error("unauthorized"));
		render(<HomePage />);

		expect(await screen.findByRole("button", { name: "账号" })).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "账号" }));

		expect(screen.getByRole("menu", { name: "账号" })).toBeInTheDocument();
		expect(screen.getByRole("menuitem", { name: "登录" })).not.toHaveAttribute("href");
		expect(screen.getByRole("menuitem", { name: "创建账号" })).toHaveAttribute(
			"href",
			"/account/register",
		);
		expect(screen.queryByRole("menuitem", { name: "账号设置" })).toBeNull();
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

	it("keeps docs route as a reader handoff without custom search or developer targets", async () => {
		window.history.pushState(
			{},
			"",
			"/docs/regulations/student_rules/index/v/2025-history?hl=unit_award#general",
		);
		const { unmount } = render(<DocsPage />);

		expect(await screen.findByText("正在打开文档")).toBeInTheDocument();
		expect(docsApiMock.resolveDocument).toHaveBeenCalledWith(
			expect.objectContaining({
				anchor: "general",
				documentSlug: "index",
				highlightRootUnitIds: ["unit_award"],
				versionSlug: "2025-history",
			}),
		);
		expect(screen.queryByText("学生应按时参加教学活动。")).toBeNull();
		expect(screen.queryByText("奖学金评定需要满足对应条件。")).toBeNull();
		expect(screen.getByRole("link", { name: "继续打开" })).toHaveAttribute(
			"href",
			"/docs/regulations/student_rules/index?hl=unit_award#general",
		);
		expect(screen.queryByText("阅读目标")).toBeNull();
		expect(screen.queryByText("/docs/regulations/student_rules/index")).toBeNull();
		expect(screen.queryByLabelText("搜索文档")).toBeNull();
		expect(screen.queryByRole("button", { name: "搜索" })).toBeNull();
		expect(screen.queryByRole("link", { name: "打开原文" })).toBeNull();
		expect(screen.queryByText("完整正文可在文档页面中查看。")).toBeNull();

		docsApiMock.getDocsNavigation.mockRejectedValueOnce(new Error("network"));
		docsApiMock.resolveDocument.mockRejectedValueOnce(new Error("network"));
		unmount();
		render(<DocsPage />);
		expect(await screen.findByText("文档暂时无法打开。")).toBeInTheDocument();
		expect(screen.queryByText("正在读取文档")).not.toBeInTheDocument();
	});

	it("keeps dining floor rendering driven by the floor projection contract", () => {
		expect(diningExperienceSource).toContain("floor.floor.svgMarkup");
		expect(diningExperienceSource).toContain("dangerouslySetInnerHTML");
		expect(diningExperienceSource).toContain("[data-dining-anchor-id]");
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

	it("renders dining hall grid, floor tabs, interactive windows, and menu offerings", async () => {
		diningApiMock.getDiningHalls.mockResolvedValue({
			halls: [
				{
					campus: "海淀校区",
					floors: [{ floorId: "1f", label: "一层" }],
					hallId: "haidian-canteen-1",
					name: "海淀一食堂",
					offeringCount: 2,
					priceRangeLabel: "9-18 元",
					stallCount: 1,
					tags: ["主食", "热餐"],
				},
				{
					campus: "丰台校区",
					floors: [
						{ floorId: "1f", label: "一层" },
						{ floorId: "2f", label: "二层" },
					],
					hallId: "fengtai-huixian-canteen",
					name: "荟贤食堂",
					offeringCount: 1,
					priceRangeLabel: "12 元",
					stallCount: 1,
					tags: ["面食"],
				},
			],
		});
		diningApiMock.getDiningFloor.mockImplementation(
			({ floorId, hallId }: { floorId: string; hallId: string }) => {
				const projections = {
					"fengtai-huixian-canteen:1f": "荟贤食堂一层",
					"fengtai-huixian-canteen:2f": "荟贤食堂二层",
					"haidian-canteen-1:1f": "海淀一食堂一层",
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
		expect(await screen.findByText("海淀一食堂")).toBeInTheDocument();
		expect(screen.getByText("1 层 · 1 个餐饮点")).toBeInTheDocument();
		expect(await screen.findByRole("button", { name: "选择盖饭窗口" })).toBeInTheDocument();
		expect(screen.getByText("番茄牛腩饭")).toBeInTheDocument();
		expect(screen.getByText("18 元")).toBeInTheDocument();
		expect(screen.getByLabelText("选择盖饭窗口")).toBeInTheDocument();
		expect(screen.getByTestId("dining-inline-floorplan").querySelector("svg")).not.toBeNull();
		expect(screen.getByRole("button", { name: "放大平面图" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "缩小平面图" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "适配平面图" })).toBeInTheDocument();
		fireEvent.click(screen.getByTestId("dining-anchor-window-01"));
		expect(screen.getByTestId("dining-anchor-window-01")).toHaveClass("is-selected");
		expect(screen.getAllByText("入口侧")[0]?.closest("button")).toHaveClass(
			"bg-[var(--sys-brand-interactive-subtle)]",
		);
		fireEvent.change(screen.getByPlaceholderText("搜索食堂、餐饮点、菜品"), {
			target: { value: "牛腩" },
		});
		expect(screen.getByText("海淀一食堂")).toBeInTheDocument();
		expect(screen.queryByText("没有匹配的食堂。")).not.toBeInTheDocument();
		expect(screen.getByText("番茄牛腩饭")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "热餐" }));
		expect(screen.getByRole("button", { name: "选择盖饭窗口" })).toBeInTheDocument();

		expect(await screen.findByText("海淀一食堂一层")).toBeInTheDocument();
		fireEvent.click(screen.getByText("丰台校区"));

		expect(await screen.findByText("荟贤食堂一层")).toBeInTheDocument();
		fireEvent.click(screen.getByText("二层"));
		expect(await screen.findByText("荟贤食堂二层")).toBeInTheDocument();
		fireEvent.click(screen.getByText("海淀校区"));

		expect(await screen.findByText("海淀一食堂一层")).toBeInTheDocument();
		expect(diningApiMock.getDiningFloor).not.toHaveBeenCalledWith({
			floorId: "2f",
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

	it("renders the v1.3 conversation shell with ChatKit as the thread surface", async () => {
		render(<ConversationPage />);

		expect(await screen.findByText("中央民族大学校园问答")).toBeInTheDocument();
		expect(screen.getByText("MUC Campus Q&A")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "搜索聊天" })).toBeInTheDocument();
		expect(screen.getByTestId("chatkit")).toBeInTheDocument();
		expect(useChatKitMock).toHaveBeenLastCalledWith(
			expect.objectContaining({
				api: expect.objectContaining({ url: "/api/chatkit" }),
				initialThread: "conv_01",
			}),
		);
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
			hallId: input.hallId,
			label: input.label,
			svgMarkup:
				'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 420"><g data-dining-role="window" data-dining-anchor-id="window-01"><rect x="64" y="72" width="150" height="72" /><text x="80" y="110">盖饭窗口</text></g></svg>',
			svgAssetUrl: `/assets/dining/${input.hallId}-${input.floorId}.svg`,
		},
		source: {
			label: "校园食堂平面图整理",
			releaseId: "dining_release:initial",
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
							saleStatus: "available",
							specLabel: "标准份",
							tags: ["主食", "热餐"],
						},
						{
							menuItemId: "menu:rice:2",
							name: "鸡腿盖饭",
							offeringId: "offering:rice:2",
							priceLabel: "16 元",
							saleStatus: "seasonal",
							specLabel: "标准份",
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
		],
	};
}
