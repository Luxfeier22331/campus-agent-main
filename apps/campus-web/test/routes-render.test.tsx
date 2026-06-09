import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundPage } from "../src/app/root-layout";
import rootLayoutSource from "../src/app/root-layout.tsx?raw";
import { ConversationPage } from "../src/app/routes/conversation-page";
import { DiningPage } from "../src/app/routes/dining-page";
import diningPageSource from "../src/app/routes/dining-page.tsx?raw";
import { FeedbackPage } from "../src/app/routes/feedback-page";
import { HomePage } from "../src/app/routes/home-page";
import homePageSource from "../src/app/routes/home-page.tsx?raw";
import { MapPage } from "../src/app/routes/map-page";
import { MessageList } from "../src/components/conversation/message-list";
import qaShellSource from "../src/components/conversation/qa-shell.tsx?raw";
import diningExperienceSource from "../src/components/dining/dining-experience.tsx?raw";
import type { ChatRequestStreamEvent } from "../src/features/conversation/model";

const diningApiMock = vi.hoisted(() => ({
	getDiningFloor: vi.fn(),
	getDiningHalls: vi.fn(),
}));
const navigateMock = vi.hoisted(() => vi.fn());

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
		useParams: () => ({ conversationId: "conv_01" }),
		useNavigate: () => navigateMock,
	};
});

vi.mock("../src/features/conversation/api", () => ({
	getConversationDetail: vi.fn().mockResolvedValue({
		createdAt: "2026-06-08T00:00:00.000Z",
		id: "conv_01",
		messages: [],
		title: "测试会话",
		updatedAt: "2026-06-08T00:00:00.000Z",
	}),
	listConversations: vi.fn().mockResolvedValue([
		{
			createdAt: "2026-06-08T00:00:00.000Z",
			id: "conv_recent",
			title: "校园卡补办流程",
			updatedAt: "2026-06-08T00:10:00.000Z",
		},
	]),
	submitChatRequest: vi.fn(),
	submitChatRequestStream: vi.fn(async function* () {
		const events: ChatRequestStreamEvent[] = [
			{
				data: {
					occurredAt: "2026-06-08T00:00:01.000Z",
					requestId: "req_01",
					status: "queued",
					traceId: "trace_01",
				},
				event: "execution.queued",
			},
			{
				data: {
					occurredAt: "2026-06-08T00:00:02.000Z",
					requestId: "req_01",
					status: "running",
					traceId: "trace_01",
				},
				event: "execution.running",
			},
			{
				data: {
					answer: {
						conversation: {
							createdAt: "2026-06-08T00:00:00.000Z",
							id: "conv_01",
							messages: [],
							title: "测试会话",
							updatedAt: "2026-06-08T00:00:03.000Z",
						},
						result: {
							kind: "clarification",
							requestId: "req_01",
							text: "需要补充哪个校区？",
							traceId: "trace_01",
						},
					},
					occurredAt: "2026-06-08T00:00:03.000Z",
					requestId: "req_01",
					status: "completed",
					traceId: "trace_01",
				},
				event: "request.completed",
			},
		];
		for (const event of events) {
			await new Promise((resolve) => setTimeout(resolve, 0));
			yield event;
		}
	}),
}));

vi.mock("../src/features/map/api", () => ({
	getCampusMapPlaces: vi.fn().mockResolvedValue({
		campus: {
			defaultCenter: [116.3216, 39.9519],
			id: "haidian",
			name: "海淀校区",
		},
		places: [
			{
				accessNote: null,
				campus: "海淀校区",
				category: "building",
				description: "图书馆与自习、借阅相关服务的主要位置。",
				geojson: {
					geometry: { coordinates: [116.3211, 39.9524], type: "Point" },
					properties: { category: "building", placeId: "library", title: "图书馆" },
					type: "Feature",
				},
				id: "library",
				sourceRefs: ["campus-map:projection:library"],
				tags: ["学习"],
				title: "图书馆",
			},
			{
				accessNote: null,
				campus: "海淀校区",
				category: "service",
				description: "学生事务相关位置。",
				geojson: {
					geometry: { coordinates: [116.3222, 39.9515], type: "Point" },
					properties: { category: "service", placeId: "student-service", title: "学生事务中心" },
					type: "Feature",
				},
				id: "student-service",
				sourceRefs: ["campus-map:projection:student-service"],
				tags: ["办事"],
				title: "学生事务中心",
			},
		],
	}),
}));

vi.mock("../src/features/map/maplibre-runtime", () => ({
	loadMapLibre: vi.fn().mockResolvedValue({
		Map: class {
			remove() {
				return this;
			}
		},
		Marker: class {
			addTo() {
				return this;
			}
			remove() {
				return this;
			}
			setLngLat() {
				return this;
			}
		},
	}),
}));

vi.mock("../src/features/dining/api", () => diningApiMock);

describe("campus routes", () => {
	beforeEach(() => {
		diningApiMock.getDiningHalls.mockReset();
		diningApiMock.getDiningFloor.mockReset();
		navigateMock.mockReset();
	});

	it("renders the v1.3 Q&A home shell without app launcher debt", async () => {
		render(<HomePage />);

		expect(await screen.findByText("中央民族大学校园问答")).toBeInTheDocument();
		expect(screen.getByText("MUC Campus Q&A")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "新对话" })).toBeInTheDocument();
		expect(screen.getByPlaceholderText("搜索历史会话")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "文档" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "校园地图" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "饭堂分布图" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "反馈" })).toBeInTheDocument();
		expect(screen.getByText("中央民族大学")).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "问校园信息，从这里开始。" })).toBeInTheDocument();
		expect(screen.getByText("信息以原始来源和现场情况为准。")).toBeInTheDocument();
		expect(await screen.findByText("校园卡补办流程")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "中慧楼在哪里？" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "清真窗口在哪？" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "最近有哪些通知？" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "海淀校区饭堂分布图在哪看？" })).toBeInTheDocument();
		expect(screen.queryByText("校园助手")).toBeNull();
		expect(screen.queryByText("常用校园事务")).toBeNull();
		expect(screen.queryByText("问政策、查地点、看食堂，都从这里开始。")).toBeNull();
		expect(screen.queryByText("搜索地点、查询饭堂、查看办事指南，或直接向助手提问。")).toBeNull();
	});

	it("keeps Q&A shell source aligned with the v1.3 design map", () => {
		expect(homePageSource).not.toContain("appCards");
		expect(homePageSource).not.toContain("SupportCard");
		expect(homePageSource).not.toContain("常用校园事务");
		expect(qaShellSource).toContain("饭堂分布图");
		expect(rootLayoutSource).not.toContain("移动端主导航");
	});

	it("renders global feedback form", () => {
		render(<FeedbackPage />);

		expect(screen.getByText("提交问题")).toBeInTheDocument();
		expect(screen.getByLabelText("问题描述")).toBeInTheDocument();
	});

	it("defaults feedback route context to the current route", () => {
		window.history.pushState({}, "", "/feedback?source=map");
		render(<FeedbackPage />);

		expect(screen.getByLabelText("相关页面")).toHaveValue("/feedback?source=map");
	});

	it("filters map projection places without claiming complete map search", async () => {
		render(<MapPage />);

		expect(await screen.findByText("图书馆")).toBeInTheDocument();
		fireEvent.change(screen.getByPlaceholderText("筛选已投影地点"), {
			target: { value: "学生" },
		});

		expect(await screen.findByText("学生事务中心")).toBeInTheDocument();
		expect(screen.queryByText("图书馆与自习、借阅相关服务的主要位置。")).not.toBeInTheDocument();
	});

	it("keeps dining floor rendering driven by the floor projection contract", () => {
		expect(diningExperienceSource).toContain("floor.floor.svgAssetUrl");
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
					name: "汇贤食堂",
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
					"fengtai-huixian-canteen:1f": "汇贤食堂一层",
					"fengtai-huixian-canteen:2f": "汇贤食堂二层",
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
		expect(screen.getByText("1 层 · 1 个窗口")).toBeInTheDocument();
		expect(await screen.findByRole("button", { name: "选择盖饭窗口" })).toBeInTheDocument();
		expect(screen.getByText("番茄牛腩饭")).toBeInTheDocument();
		expect(screen.getByText("18 元")).toBeInTheDocument();
		expect(screen.getByLabelText("选择盖饭窗口")).toBeInTheDocument();
		fireEvent.change(screen.getByPlaceholderText("搜索食堂、窗口、菜品"), {
			target: { value: "牛腩" },
		});
		expect(screen.getByText("海淀一食堂")).toBeInTheDocument();
		expect(screen.queryByText("没有匹配的食堂。")).not.toBeInTheDocument();
		expect(screen.getByText("番茄牛腩饭")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "热餐" }));
		expect(screen.getByRole("button", { name: "选择盖饭窗口" })).toBeInTheDocument();

		expect(await screen.findByText("海淀一食堂一层")).toBeInTheDocument();
		fireEvent.click(screen.getByText("丰台校区"));

		expect(await screen.findByText("汇贤食堂一层")).toBeInTheDocument();
		fireEvent.click(screen.getByText("二层"));
		expect(await screen.findByText("汇贤食堂二层")).toBeInTheDocument();
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

	it("renders the v1.3 conversation shell and streaming lifecycle states", async () => {
		render(<ConversationPage />);

		expect(await screen.findByText("中央民族大学校园问答")).toBeInTheDocument();
		expect(screen.getByText("MUC Campus Q&A")).toBeInTheDocument();
		expect(screen.getByPlaceholderText("搜索历史会话")).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "测试会话" })).toBeInTheDocument();
		fireEvent.change(await screen.findByPlaceholderText("今天需要什么帮助"), {
			target: { value: "奖学金" },
		});
		fireEvent.click(screen.getByLabelText("发送"));

		expect(await screen.findByText("奖学金")).toBeInTheDocument();
		expect(await screen.findByText("正在连接校园助手。")).toBeInTheDocument();
		expect(await screen.findByText("已排队")).toBeInTheDocument();
		expect(await screen.findByText("正在处理")).toBeInTheDocument();
		expect(await screen.findByText("已完成")).toBeInTheDocument();
		expect(await screen.findByText("需要补充哪个校区？")).toBeInTheDocument();
	});

	it("renders source metadata and answer feedback controls", () => {
		render(
			<MessageList
				messages={[
					{
						conversationId: "conv_01",
						createdAt: "2026-06-08T00:00:00.000Z",
						feedback: null,
						id: "msg_01",
						kind: "answer",
						requestId: "req_01",
						retryable: null,
						role: "assistant",
						structuredParts: [
							{
								sourceItems: [
									{
										collectionLabel: "学生手册",
										pageLabel: "奖助学金",
										primaryAction: {
											disabledReason: null,
											external: false,
											href: "/docs/regulations/student_rules/scholarship",
											label: "查看来源",
										},
										publisherLabel: "学生处",
										sectionTitle: "申请条件",
										snippet: "综合测评和课程成绩需要满足对应条件。",
										title: "奖学金评定办法",
										trustLabel: "已发布",
										versionLabel: "2026",
									},
								],
								type: "source_items",
							},
						],
						text: "可以先确认奖学金类别和年级。",
					},
				]}
				onDeleteFeedback={vi.fn()}
				onSubmitFeedback={vi.fn()}
			/>,
		);

		expect(screen.getByText("学生处 · 已发布 · 2026")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "有帮助" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "没帮助" })).toBeInTheDocument();
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
				status: "active",
				tags: ["主食", "热餐"],
				windowId: `${input.hallId}:${input.floorId}:window-01`,
			},
		],
	};
}
