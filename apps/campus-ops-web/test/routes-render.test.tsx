// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuditPage } from "../src/app/routes/audit-page";
import { DiningWorkspacePage } from "../src/app/routes/dining-workspace-page";
import { HomePage } from "../src/app/routes/home-page";
import { PlaceholderPage } from "../src/app/routes/placeholder-page";
import { ReleasesPage } from "../src/app/routes/releases-page";

const diningApiMock = vi.hoisted(() => ({
	assignDiningWindow: vi.fn(),
	approveDiningReleaseCandidate: vi.fn(),
	cancelDiningReleaseCandidate: vi.fn(),
	createDiningFloorplanAsset: vi.fn(),
	createDiningMenuItem: vi.fn(),
	createDiningMenuOffering: vi.fn(),
	createDiningReleaseCandidate: vi.fn(),
	getDiningOpsFloor: vi.fn(),
	getDiningOpsHalls: vi.fn(),
	listDiningAuditEvents: vi.fn(),
	listDiningReleaseCandidates: vi.fn(),
	listDiningReleases: vi.fn(),
	publishDiningReleaseCandidate: vi.fn(),
	scheduleDiningReleaseCandidate: vi.fn(),
	updateDiningWindow: vi.fn(),
	updateDiningMenuItem: vi.fn(),
	updateDiningMenuOffering: vi.fn(),
	validateDiningReleaseCandidate: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
	const actual =
		await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
	return {
		...actual,
		Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
			<a href={to}>{children}</a>
		),
		useNavigate: () => vi.fn(),
		useParams: () => ({ floorId: "1f", hallId: "haidian-canteen-1" }),
	};
});

vi.mock("../src/features/dining/api", () => diningApiMock);
const floorPayload = {
	assignments: [
		{
			assignmentId: "assignment:haidian-canteen-1:1f:window-01",
			stallProfileId: "stall:rice",
			status: "active",
			windowId: "haidian-canteen-1:1f:window-01",
		},
	],
	floor: {
		floorId: "1f",
		hallId: "haidian-canteen-1",
		label: "海淀一食堂一层",
		svgMarkup:
			'<svg viewBox="0 0 720 420" role="img" aria-label="海淀一食堂一层示意图"><g data-dining-role="window" data-dining-anchor-id="window-01"><rect x="64" y="72" width="150" height="72" /><text x="84" y="112">一号窗口</text></g></svg>',
		svgAssetUrl: "/assets/dining/haidian-canteen-1-1f.svg",
	},
	menuItems: [
		{
			menuItemId: "menu:rice",
			name: "盖饭",
			status: "active",
			tags: ["主食"],
		},
		{
			menuItemId: "menu:noodle",
			name: "牛肉面",
			status: "active",
			tags: ["面食"],
		},
	],
	menuOfferings: [
		{
			assignmentId: "assignment:haidian-canteen-1:1f:window-01",
			menuItemId: "menu:rice",
			offeringId: "offering:rice",
			priceLabel: "12-18 元",
			saleStatus: "available",
			specLabel: null,
		},
		{
			assignmentId: "assignment:haidian-canteen-1:1f:window-01",
			menuItemId: "menu:noodle",
			offeringId: "offering:noodle",
			priceLabel: "16 元",
			saleStatus: "seasonal",
			specLabel: "标准碗",
		},
	],
	stallProfiles: [
		{
			displayName: "盖饭窗口",
			stallProfileId: "stall:rice",
			stallType: "hot_meal",
			status: "active",
			tags: ["主食"],
		},
	],
	windows: [
		{
			floorId: "1f",
			geometry: { height: 72, width: 150, x: 64, y: 72 },
			hallId: "haidian-canteen-1",
			label: "一号窗口",
			locationLabel: "入口左侧",
			svgAnchorId: "window-01",
			status: "active",
			tags: ["热餐"],
			windowId: "haidian-canteen-1:1f:window-01",
		},
	],
};

function renderWithQueryClient(element: React.ReactElement) {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
		},
	});

	return render(<QueryClientProvider client={queryClient}>{element}</QueryClientProvider>);
}

describe("campus ops routes", () => {
	beforeEach(() => {
		for (const fn of Object.values(diningApiMock)) {
			fn.mockReset();
		}
		diningApiMock.getDiningOpsHalls.mockResolvedValue({
			halls: [
				{
					campus: "海淀校区",
					floors: [{ floorId: "1f", label: "一层", svgAssetUrl: "/assets/dining/1.svg" }],
					hallId: "haidian-canteen-1",
					name: "海淀一食堂",
					status: "active",
				},
			],
		});
		diningApiMock.getDiningOpsFloor.mockResolvedValue(floorPayload);
		diningApiMock.assignDiningWindow.mockResolvedValue({
			assignment: floorPayload.assignments[0],
			stallProfile: floorPayload.stallProfiles[0],
		});
		diningApiMock.createDiningMenuItem.mockResolvedValue({ menuItem: floorPayload.menuItems[0] });
		diningApiMock.createDiningFloorplanAsset.mockResolvedValue({
			asset: {
				anchorInventory: [{ anchorId: "window-01", role: "window" }],
				bucket: "campus-rag-derived",
				byteSize: 180,
				contentType: "image/svg+xml",
				floorId: "1f",
				floorplanAssetId: "dining_floorplan_asset:new",
				hallId: "haidian-canteen-1",
				objectKey: "dining/floorplans/assets/haidian-canteen-1/1f/sha256-uploaded.svg",
				sha256: "sha256:uploaded",
			},
		});
		diningApiMock.createDiningMenuOffering.mockResolvedValue({
			offering: floorPayload.menuOfferings[0],
		});
		diningApiMock.updateDiningWindow.mockResolvedValue({ window: floorPayload.windows[0] });
		diningApiMock.updateDiningMenuItem.mockResolvedValue({ menuItem: floorPayload.menuItems[0] });
		diningApiMock.updateDiningMenuOffering.mockResolvedValue({
			offering: floorPayload.menuOfferings[0],
		});
		diningApiMock.listDiningReleases.mockResolvedValue({
			releases: [
				{
					candidateId: "dining_release_candidate:initial",
					createdAt: "2026-06-08T00:00:00.000Z",
					createdBy: "operator_01",
					notes: "初始化",
					predecessorReleaseId: null,
					publishedAt: "2026-06-08T00:00:00.000Z",
					publishedBy: "operator_01",
					releaseId: "dining_release:initial",
					snapshotHash: "sha256:initial",
					status: "published",
				},
			],
		});
		diningApiMock.listDiningReleaseCandidates.mockResolvedValue({
			candidates: [
				{
					approvedAt: null,
					approvedBy: null,
					baseDraftVersionId: "dining_draft_version:1",
					cancelledAt: null,
					cancelledBy: null,
					candidateId: "dining_release_candidate:1",
					createdAt: "2026-06-08T00:00:00.000Z",
					createdBy: "operator_01",
					expectedPredecessorReleaseId: "dining_release:initial",
					notes: "候选",
					publishedReleaseId: null,
					publishMode: "manual",
					scheduledAt: null,
					snapshotHash: "sha256:candidate",
					status: "approved",
				},
			],
		});
		diningApiMock.createDiningReleaseCandidate.mockResolvedValue({
			candidate: {
				candidateId: "dining_release_candidate:2",
				status: "candidate",
			},
			validationReport: null,
		});
		diningApiMock.validateDiningReleaseCandidate.mockResolvedValue({
			candidate: { candidateId: "dining_release_candidate:1", status: "validated" },
			validationReport: { blockers: [], status: "pass", warnings: [] },
		});
		diningApiMock.approveDiningReleaseCandidate.mockResolvedValue({
			candidate: { candidateId: "dining_release_candidate:1", status: "approved" },
			validationReport: { blockers: [], status: "pass", warnings: [] },
		});
		diningApiMock.publishDiningReleaseCandidate.mockResolvedValue({
			release: { releaseId: "dining_release:2", status: "published" },
		});
		diningApiMock.listDiningAuditEvents.mockResolvedValue({
			events: [
				{
					action: "release.published",
					actorDisplayName: "Ops User",
					actorPrincipalId: "operator_01",
					auditEventId: "audit_01",
					objectId: "dining_release:initial",
					objectKind: "dining.release",
					occurredAt: "2026-06-08T00:00:00.000Z",
				},
			],
		});
	});

	it("renders the backend modification surface dashboard", () => {
		renderWithQueryClient(<HomePage />);

		expect(screen.getByText("后台修改面总览")).toBeInTheDocument();
		expect(screen.getByRole("table", { name: "后台模块路由" })).toBeInTheDocument();
		expect(screen.getByText("当前工作面")).toBeInTheDocument();
		expect(screen.getByText("接入节奏")).toBeInTheDocument();

		expect(screen.getByRole("link", { name: /食堂数据/ })).toHaveAttribute("href", "/dining");
		expect(screen.getByRole("link", { name: /食堂资产/ })).toHaveAttribute(
			"href",
			"/dining/assets",
		);
		expect(screen.getByRole("link", { name: /发布候选/ })).toHaveAttribute(
			"href",
			"/dining/candidates",
		);
		expect(screen.getByRole("link", { name: /发布历史/ })).toHaveAttribute(
			"href",
			"/dining/releases",
		);
		expect(screen.getByRole("link", { name: /食堂审计/ })).toHaveAttribute("href", "/dining/audit");
		expect(screen.getByRole("link", { name: /地图与地点/ })).toHaveAttribute("href", "/map");
		expect(screen.getByRole("link", { name: /反馈处理/ })).toHaveAttribute("href", "/feedback");
		expect(screen.getByRole("link", { name: /知识源/ })).toHaveAttribute("href", "/knowledge");
		expect(screen.getByRole("link", { name: /通知源/ })).toHaveAttribute("href", "/notices");
		expect(screen.getByRole("link", { name: /校园服务/ })).toHaveAttribute("href", "/services");
	});

	it("loads dining workspace and submits window, assignment, and multiple menu offering edits", async () => {
		renderWithQueryClient(<DiningWorkspacePage />);

		expect(await screen.findByText("海淀一食堂")).toBeInTheDocument();
		expect(await screen.findByRole("button", { name: "上传替换 SVG" })).toBeInTheDocument();
		fireEvent.click(await screen.findByRole("button", { name: "SVG 区块 window-01" }));
		expect(screen.getByDisplayValue("一号窗口")).toBeInTheDocument();
		expect(screen.getByDisplayValue("盖饭窗口")).toBeInTheDocument();
		expect(screen.getByDisplayValue("盖饭")).toBeInTheDocument();
		expect(screen.getByDisplayValue("牛肉面")).toBeInTheDocument();

		fireEvent.change(screen.getByLabelText("窗口名称"), {
			target: { value: "南侧一号窗口" },
		});
		fireEvent.change(screen.getByLabelText("档口名称"), {
			target: { value: "新风味窗口" },
		});
		fireEvent.change(screen.getByLabelText("菜品名称 offering:rice"), {
			target: { value: "番茄牛腩饭" },
		});
		fireEvent.change(screen.getByLabelText("价格 offering:rice"), {
			target: { value: "18 元" },
		});
		fireEvent.change(screen.getByLabelText("售卖状态 offering:noodle"), {
			target: { value: "paused" },
		});
		fireEvent.click(screen.getByRole("button", { name: "新增菜品" }));
		fireEvent.click(screen.getByText("保存草稿"));
		expect(await screen.findByText("菜品名称和价格不能为空。")).toBeInTheDocument();
		expect(diningApiMock.updateDiningWindow).not.toHaveBeenCalled();
		expect(diningApiMock.assignDiningWindow).not.toHaveBeenCalled();
		expect(diningApiMock.createDiningMenuItem).not.toHaveBeenCalled();

		const menuNameInputs = screen.getAllByLabelText(/^菜品名称 /);
		const priceInputs = screen.getAllByLabelText(/^价格 /);
		fireEvent.change(menuNameInputs.at(-1) as HTMLElement, {
			target: { value: "新增粉面" },
		});
		fireEvent.change(priceInputs.at(-1) as HTMLElement, {
			target: { value: "11 元" },
		});
		fireEvent.click(screen.getByText("保存草稿"));

		await waitFor(() => {
			expect(diningApiMock.updateDiningWindow).toHaveBeenCalledWith(
				expect.objectContaining({
					label: "南侧一号窗口",
					windowId: "haidian-canteen-1:1f:window-01",
				}),
			);
			expect(diningApiMock.assignDiningWindow).toHaveBeenCalledWith(
				expect.objectContaining({
					stallProfile: expect.objectContaining({ displayName: "新风味窗口" }),
				}),
			);
			expect(diningApiMock.updateDiningMenuItem).toHaveBeenCalledWith(
				expect.objectContaining({
					menuItemId: "menu:rice",
					name: "番茄牛腩饭",
				}),
			);
			expect(diningApiMock.updateDiningMenuOffering).toHaveBeenCalledWith(
				expect.objectContaining({
					offeringId: "offering:rice",
					priceLabel: "18 元",
				}),
			);
			expect(diningApiMock.updateDiningMenuOffering).toHaveBeenCalledWith(
				expect.objectContaining({
					offeringId: "offering:noodle",
					saleStatus: "paused",
				}),
			);
			expect(diningApiMock.createDiningMenuItem).toHaveBeenCalledWith({
				name: "新增粉面",
				tags: [],
			});
			expect(diningApiMock.createDiningMenuOffering).toHaveBeenCalledWith(
				expect.objectContaining({
					priceLabel: "11 元",
					saleStatus: "available",
				}),
			);
		});
	});

	it("uploads a replacement floorplan SVG through app-api and refreshes the draft floor", async () => {
		renderWithQueryClient(<DiningWorkspacePage />);

		const uploadInput = await screen.findByLabelText("上传替换 SVG 文件");
		const file = new File(
			[
				'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 420"><g data-dining-role="window" data-dining-anchor-id="window-01"><rect x="1" y="1" width="10" height="10" /></g></svg>',
			],
			"updated-floor.svg",
			{ type: "image/svg+xml" },
		);
		fireEvent.change(uploadInput, { target: { files: [file] } });

		await waitFor(() => {
			expect(diningApiMock.createDiningFloorplanAsset.mock.calls[0]?.[0]).toEqual({
				floorId: "1f",
				sourceFilename: "updated-floor.svg",
				svgMarkup: expect.stringContaining('data-dining-anchor-id="window-01"'),
			});
		});
		await waitFor(() => {
			expect(diningApiMock.getDiningOpsFloor).toHaveBeenCalledTimes(2);
		});
		expect(await screen.findByText("SVG 已上传")).toBeInTheDocument();
	});

	it("renders release candidate workflow and audit routes", async () => {
		renderWithQueryClient(<ReleasesPage />);
		expect(await screen.findByText("dining_release_candidate:1")).toBeInTheDocument();
		expect(await screen.findByText("dining_release:initial")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "校验" }));
		await waitFor(() => {
			expect(diningApiMock.validateDiningReleaseCandidate.mock.calls[0]?.[0]).toEqual({
				candidateId: "dining_release_candidate:1",
			});
		});
		fireEvent.click(screen.getByRole("button", { name: "审批" }));
		await waitFor(() => {
			expect(diningApiMock.approveDiningReleaseCandidate.mock.calls[0]?.[0]).toEqual({
				candidateId: "dining_release_candidate:1",
				notes: "确认发布",
			});
		});
		fireEvent.click(screen.getByRole("button", { name: "发布候选" }));
		await waitFor(() => {
			expect(diningApiMock.publishDiningReleaseCandidate.mock.calls[0]?.[0]).toEqual({
				candidateId: "dining_release_candidate:1",
			});
		});

		renderWithQueryClient(<AuditPage />);
		expect(await screen.findByText("release.published")).toBeInTheDocument();
	});

	it("renders placeholder pages as reserved backend modules", () => {
		renderWithQueryClient(<PlaceholderPage title="地图运营" description="空间数据运营入口" />);

		expect(screen.getByText("预留路由")).toBeInTheDocument();
		expect(screen.getByText("地图运营")).toBeInTheDocument();
		expect(screen.getByText("空间数据运营入口")).toBeInTheDocument();
	});
});
