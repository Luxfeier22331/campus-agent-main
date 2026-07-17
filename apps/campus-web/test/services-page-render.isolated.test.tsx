import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServicesPage } from "../src/app/routes/services-page";
import servicesPageSource from "../src/app/routes/services-page.tsx?raw";

const campusServicesApiMock = vi.hoisted(() => ({
	getCampusTransportStatus: vi.fn(),
}));

vi.mock("../src/features/campus-services/api", () => campusServicesApiMock);

describe("campus services page", () => {
	beforeEach(() => {
		campusServicesApiMock.getCampusTransportStatus.mockReset();
	});

	it("renders the public campus services transport schedule page", async () => {
		campusServicesApiMock.getCampusTransportStatus.mockResolvedValue({
			release: {
				publishedAt: "2026-03-20T00:00:00+08:00",
				releaseId: "snapshot:bus:2026-03-20",
				sourceRefs: ["https://portal.example.edu/notice/123"],
			},
			groups: [
				{
					kind: "weekday",
					routes: [
						{
							departures: [
								{
									departureTime: "07:00",
									kind: "teacher",
									sourceRefs: ["https://portal.example.edu/notice/123"],
									status: "normal",
								},
								{
									departureTime: "12:10",
									kind: "student",
									note: "新增班次",
									serviceDate: "2026-03-21",
									sourceRefs: ["https://portal.example.edu/notice/456"],
									status: "added",
								},
							],
							displayName: "海淀校区→丰台校区",
							routeId: "route:haidian-to-fengtai",
						},
					],
				},
			],
		});

		render(<ServicesPage />);

		expect(
			await screen.findByRole("heading", { name: "班车时刻表", level: 1 }),
		).toBeInTheDocument();
		expect(await screen.findByRole("heading", { name: "班次安排", level: 2 })).toBeInTheDocument();
		expect(screen.queryByLabelText("服务日期")).toBeNull();
		expect(screen.getByText("工作日运行")).toBeInTheDocument();
		expect(screen.queryByText(/snapshot:bus:2026-03-20/)).toBeNull();
		expect(screen.getByText(/更新于/)).toBeInTheDocument();
		expect(screen.getByText("含 1 条变更")).toBeInTheDocument();
		expect(screen.getByText("海淀校区→丰台校区")).toBeInTheDocument();
		expect(screen.getByText("07:00")).toBeInTheDocument();
		expect(screen.getByText("教师班次")).toBeInTheDocument();
		expect(screen.getByText("12:10")).toBeInTheDocument();
		expect(screen.getByText("3月21日周六")).toBeInTheDocument();
		expect(screen.getByText("学生班次")).toBeInTheDocument();
		expect(screen.getByText("加开")).toBeInTheDocument();
		expect(screen.getByText("新增班次")).toBeInTheDocument();
		expect(
			screen.getByRole("link", { name: "https://portal.example.edu/notice/123" }),
		).toHaveAttribute("href", "https://portal.example.edu/notice/123");
		expect(
			screen.getByRole("link", { name: "https://portal.example.edu/notice/456" }),
		).toHaveAttribute("href", "https://portal.example.edu/notice/456");
		expect(screen.queryByText("医保窗口")).toBeNull();
		expect(screen.queryByText("operator")).toBeNull();
		expect(campusServicesApiMock.getCampusTransportStatus).toHaveBeenCalledWith();
	});

	it("keeps the one-off schedule table on semantic HTML", () => {
		expect(servicesPageSource).not.toContain('from "@heroui/react"');
		expect(servicesPageSource).not.toContain("<Table.");
		expect(servicesPageSource).not.toContain("@tanstack/react-table");
		expect(servicesPageSource).toContain("<table");
	});

	it("renders campus services schedule empty and error states", async () => {
		campusServicesApiMock.getCampusTransportStatus.mockResolvedValue({
			groups: [],
			release: {
				publishedAt: "2026-03-20T00:00:00+08:00",
				releaseId: "snapshot:bus:2026-03-20",
				sourceRefs: ["https://portal.example.edu/notice/123"],
			},
		});
		const { unmount } = render(<ServicesPage />);

		expect(await screen.findByText("当前暂无可展示班次。")).toBeInTheDocument();
		unmount();
		campusServicesApiMock.getCampusTransportStatus.mockRejectedValue(new Error("failed"));
		render(<ServicesPage />);

		expect(await screen.findByText("班车时刻表暂时无法读取。")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "反馈" })).toHaveAttribute(
			"href",
			"/feedback?source=services",
		);
		expect(screen.queryByText("暂无变更")).toBeNull();
	});
});
