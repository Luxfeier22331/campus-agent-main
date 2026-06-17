// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuditPage } from "../src/panel/operations/dining/audit-page";
import { DiningWorkspacePage } from "../src/panel/operations/dining/dining-workspace-page";
import { ReleasesPage } from "../src/panel/operations/dining/releases-page";

const diningApiMock = vi.hoisted(() => ({
	assignDiningWindow: vi.fn(),
	approveDiningReleaseCandidate: vi.fn(),
	cancelDiningReleaseCandidate: vi.fn(),
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
	updateDiningMenuItem: vi.fn(),
	updateDiningMenuOffering: vi.fn(),
	updateDiningWindow: vi.fn(),
	validateDiningReleaseCandidate: vi.fn(),
}));

vi.mock("react-router-dom", async () => {
	const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
	return {
		...actual,
		Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
			<a href={to}>{children}</a>
		),
		useParams: () => ({ floorId: FLOOR_ID, hallId: HALL_ID }),
	};
});

vi.mock("../src/panel/operations/dining/model/api", () => diningApiMock);

const FLOOR_ID = "haidian-canteen-1-1f";
const HALL_ID = "haidian-canteen-1";
const FLOORPLAN_SHA256 = "sha256:c55f08aa63157e174970361c07811678f54727179b317901c20b1b2f25df6929";

const floorPayload = {
	assignments: [
		{
			assignmentId: `assignment:${HALL_ID}:${FLOOR_ID}:window-01`,
			stallProfileId: "stall:rice",
			status: "active",
			windowId: `${HALL_ID}:${FLOOR_ID}:window-01`,
		},
	],
	floor: {
		floorId: FLOOR_ID,
		floorplan: {
			anchorInventory: [
				{ anchorId: "window-01", label: "一号窗口", role: "window" },
				{ anchorId: "window-02", label: "二号窗口", role: "window" },
				{ anchorId: "window-03", label: "三号窗口", role: "window" },
				{ anchorId: "window-04", label: "四号窗口", role: "window" },
				{ anchorId: "window-05", label: "五号窗口", role: "window" },
			],
			floorId: FLOOR_ID,
			floorplanId: `floorplan:${HALL_ID}:${FLOOR_ID}`,
			hallId: HALL_ID,
			sha256: FLOORPLAN_SHA256,
			svgAssetUrl: `/assets/dining/${HALL_ID}-${FLOOR_ID}.svg`,
		},
		hallId: HALL_ID,
		label: "海淀一食堂一层",
		svgAssetUrl: `/assets/dining/${HALL_ID}-${FLOOR_ID}.svg`,
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
			assignmentId: `assignment:${HALL_ID}:${FLOOR_ID}:window-01`,
			menuItemId: "menu:rice",
			offeringId: "offering:rice",
			priceLabel: "12-18 元",
			saleStatus: "available",
			specLabel: null,
		},
		{
			assignmentId: `assignment:${HALL_ID}:${FLOOR_ID}:window-01`,
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
			floorId: FLOOR_ID,
			geometry: { height: 72, width: 150, x: 64, y: 72 },
			hallId: HALL_ID,
			label: "一号窗口",
			locationLabel: "入口左侧",
			status: "active",
			svgAnchorId: "window-01",
			tags: ["热餐"],
			windowId: `${HALL_ID}:${FLOOR_ID}:window-01`,
		},
		{
			floorId: FLOOR_ID,
			geometry: { height: 72, width: 150, x: 240, y: 72 },
			hallId: HALL_ID,
			label: "待绑定餐饮点",
			locationLabel: "入口右侧",
			status: "active",
			svgAnchorId: undefined,
			tags: ["热餐"],
			windowId: `${HALL_ID}:${FLOOR_ID}:window-02`,
		},
	],
} as const;

function renderWithQueryClient(element: React.ReactElement) {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
		},
	});

	return render(<QueryClientProvider client={queryClient}>{element}</QueryClientProvider>);
}

describe("operator console dining operations pages", () => {
	beforeEach(() => {
		for (const fn of Object.values(diningApiMock)) {
			fn.mockReset();
		}
		diningApiMock.getDiningOpsHalls.mockResolvedValue({
			halls: [
				{
					campus: "海淀校区",
					floors: [
						{
							floorId: FLOOR_ID,
							floorplanId: `floorplan:${HALL_ID}:${FLOOR_ID}`,
							floorplanSha256: FLOORPLAN_SHA256,
							label: "一层",
							svgAssetUrl: `/assets/dining/${HALL_ID}-${FLOOR_ID}.svg`,
						},
					],
					hallId: HALL_ID,
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

	it("loads dining workspace and submits window, assignment, and multiple menu offering edits", async () => {
		renderWithQueryClient(<DiningWorkspacePage />);

		expect(await screen.findByText("海淀一食堂")).toBeInTheDocument();
		expect(await screen.findByText("版本化平面图")).toBeInTheDocument();
		expect(screen.getByText(/sha256:c55f08aa6315/)).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "上传替换 SVG" })).not.toBeInTheDocument();
		expect(screen.getByRole("table", { name: "SVG 区块目录" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "放大平面图" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "缩小平面图" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "适配平面图" })).toBeInTheDocument();
		fireEvent.click(await screen.findByRole("button", { name: "SVG 区块 window-01" }));
		expect(screen.getByDisplayValue("一号窗口")).toBeInTheDocument();
		expect(screen.getByDisplayValue("盖饭窗口")).toBeInTheDocument();
		expect(screen.getByDisplayValue("盖饭")).toBeInTheDocument();
		expect(screen.getByDisplayValue("牛肉面")).toBeInTheDocument();

		fireEvent.change(screen.getByLabelText("餐饮点名称"), {
			target: { value: "南侧一号窗口" },
		});
		fireEvent.change(screen.getByLabelText("对外名称"), {
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
					windowId: `${HALL_ID}:${FLOOR_ID}:window-01`,
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

	it("shows a diagnostic error when persisted dining operations state is invalid", async () => {
		diningApiMock.getDiningOpsHalls.mockRejectedValue({
			body: {
				error: {
					code: "dining_operations_state_invalid",
					message: "Persisted dining operations state is missing draft version truth.",
				},
			},
			message: "Persisted dining operations state is missing draft version truth.",
			status: 500,
		});

		renderWithQueryClient(<DiningWorkspacePage />);

		expect(await screen.findByText("食堂运营状态未初始化或持久化状态不完整。")).toBeInTheDocument();
		expect(screen.getByText("请先执行 dining seed 后再刷新页面。")).toBeInTheDocument();
		expect(screen.queryByText("选择一个食堂楼层")).not.toBeInTheDocument();
	});

	it("shows a diagnostic error when dining floor state cannot be loaded", async () => {
		diningApiMock.getDiningOpsFloor.mockRejectedValue({
			body: {
				error: {
					code: "dining_operations_state_invalid",
					message: "Persisted dining operations state is missing draft version truth.",
				},
			},
			message: "Persisted dining operations state is missing draft version truth.",
			status: 500,
		});

		renderWithQueryClient(<DiningWorkspacePage />);

		expect(await screen.findByText("食堂运营状态未初始化或持久化状态不完整。")).toBeInTheDocument();
		expect(screen.getByText("请先执行 dining seed 后再刷新页面。")).toBeInTheDocument();
		expect(screen.queryByText("选择一个食堂楼层")).not.toBeInTheDocument();
	});

	it("binds an unassigned SVG anchor to an existing dining point", async () => {
		renderWithQueryClient(<DiningWorkspacePage />);

		await screen.findByRole("table", { name: "SVG 区块目录" });
		expect(screen.getByRole("button", { name: "SVG 区块 window-02" })).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "SVG 区块 window-02" }));

		expect(screen.getByText("区块未绑定餐饮点")).toBeInTheDocument();
		fireEvent.change(screen.getByLabelText("选择要绑定的餐饮点"), {
			target: { value: `${HALL_ID}:${FLOOR_ID}:window-02` },
		});
		fireEvent.click(screen.getByRole("button", { name: "绑定区块" }));

		await waitFor(() => {
			expect(diningApiMock.updateDiningWindow).toHaveBeenCalledWith(
				expect.objectContaining({
					svgAnchorId: "window-02",
					windowId: `${HALL_ID}:${FLOOR_ID}:window-02`,
				}),
			);
		});
	});

	it("renders release candidate workflow", async () => {
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
	});

	it("renders audit route", async () => {
		renderWithQueryClient(<AuditPage />);
		expect(await screen.findByText("release.published")).toBeInTheDocument();
	});
});
