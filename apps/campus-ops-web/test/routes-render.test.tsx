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
	createDiningMenuItem: vi.fn(),
	createDiningMenuOffering: vi.fn(),
	getDiningOpsFloor: vi.fn(),
	getDiningOpsHalls: vi.fn(),
	listDiningAuditEvents: vi.fn(),
	listDiningReleases: vi.fn(),
	publishDiningRelease: vi.fn(),
	updateDiningWindow: vi.fn(),
	updateDiningMenuItem: vi.fn(),
	updateDiningMenuOffering: vi.fn(),
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
vi.mock("../src/components/dining/floorplan-canvas", () => ({
	FloorplanCanvas: ({
		onSelectWindow,
		windows,
	}: {
		onSelectWindow: (windowId: string) => void;
		windows: Array<{ label: string; windowId: string }>;
	}) => (
		<div>
			{windows.map((window) => (
				<button key={window.windowId} onClick={() => onSelectWindow(window.windowId)} type="button">
					{window.label}
				</button>
			))}
		</div>
	),
}));

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
					createdAt: "2026-06-08T00:00:00.000Z",
					createdBy: "operator_01",
					notes: "初始化",
					publishedAt: "2026-06-08T00:00:00.000Z",
					publishedBy: "operator_01",
					releaseId: "dining_release:initial",
					status: "published",
				},
			],
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

	it("renders the operator dashboard", () => {
		renderWithQueryClient(<HomePage />);

		expect(screen.getByText("运营总览")).toBeInTheDocument();
		expect(screen.getByText("食堂地图")).toBeInTheDocument();
	});

	it("loads dining workspace and submits window, assignment, and multiple menu offering edits", async () => {
		renderWithQueryClient(<DiningWorkspacePage />);

		expect(await screen.findByText("海淀一食堂")).toBeInTheDocument();
		fireEvent.click(await screen.findByText("一号窗口"));
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

	it("renders releases and audit routes", async () => {
		renderWithQueryClient(<ReleasesPage />);
		expect(await screen.findByText("dining_release:initial")).toBeInTheDocument();

		renderWithQueryClient(<AuditPage />);
		expect(await screen.findByText("release.published")).toBeInTheDocument();
	});

	it("renders map and feedback placeholders as future modules", () => {
		renderWithQueryClient(<PlaceholderPage title="地图运营" description="空间数据运营入口" />);

		expect(screen.getByText("地图运营")).toBeInTheDocument();
		expect(screen.getByText("空间数据运营入口")).toBeInTheDocument();
	});
});
