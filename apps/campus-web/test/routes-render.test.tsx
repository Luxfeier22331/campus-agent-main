import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NotFoundPage } from "../src/app/root-layout";
import { ConversationPage } from "../src/app/routes/conversation-page";
import diningPageSource from "../src/app/routes/dining-page.tsx?raw";
import { FeedbackPage } from "../src/app/routes/feedback-page";
import { HomePage } from "../src/app/routes/home-page";
import { MapPage } from "../src/app/routes/map-page";
import type { ChatRequestStreamEvent } from "../src/features/conversation/model";

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
		useNavigate: () => vi.fn(),
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
	listConversations: vi.fn().mockResolvedValue([]),
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

vi.mock("maplibre-gl", () => ({
	default: {
		Map: class {
			remove() {
				return this;
			}
		},
		Marker: class {
			setLngLat() {
				return this;
			}
			addTo() {
				return this;
			}
		},
	},
}));

describe("campus routes", () => {
	it("renders the assistant-first home route", async () => {
		render(<HomePage />);

		expect(await screen.findByText("今天需要什么帮助")).toBeInTheDocument();
		expect(screen.getByText("校园地图")).toBeInTheDocument();
		expect(screen.getByText("饭堂分布图")).toBeInTheDocument();
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
		expect(diningPageSource).toContain("floor.floor.svgAssetUrl");
		expect(diningPageSource).not.toContain('id: "rice-bowl"');
		expect(diningPageSource).not.toContain("x: 56");
		expect(diningPageSource).not.toContain("y: 72");
	});

	it("renders conversation streaming lifecycle states", async () => {
		render(<ConversationPage />);

		fireEvent.change(await screen.findByPlaceholderText("今天需要什么帮助"), {
			target: { value: "奖学金" },
		});
		fireEvent.click(screen.getByLabelText("发送"));

		expect(await screen.findByText("已排队")).toBeInTheDocument();
		expect(await screen.findByText("正在处理")).toBeInTheDocument();
		expect(await screen.findByText("已完成")).toBeInTheDocument();
		expect(await screen.findByText("需要补充哪个校区？")).toBeInTheDocument();
	});

	it("renders fail-closed not found page", () => {
		render(<NotFoundPage />);

		expect(screen.getByText("页面不存在")).toBeInTheDocument();
	});
});
