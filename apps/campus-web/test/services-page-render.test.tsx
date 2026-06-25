import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServicesPage } from "../src/app/routes/services-page";
import servicesPageSource from "../src/app/routes/services-page.tsx?raw";

const campusServicesApiMock = vi.hoisted(() => ({
	getCampusTransportSchedule: vi.fn(),
}));

vi.mock("../src/features/campus-services/api", () => campusServicesApiMock);

describe("campus services page", () => {
	beforeEach(() => {
		campusServicesApiMock.getCampusTransportSchedule.mockReset();
	});

	it("renders the public campus services transport schedule page", async () => {
		campusServicesApiMock.getCampusTransportSchedule.mockResolvedValue({
			adjustmentCount: 1,
			calendarLabel: "工作日",
			generatedAt: "2026-06-24T09:00:00.000Z",
			hasAdjustments: true,
			notices: [
				{
					publishedAt: "2026-03-20T00:00:00+08:00",
					title: "班车时刻表来源",
					url: "https://portal.muc.edu.cn/notice/123",
				},
			],
			publishedAt: "2026-03-20T00:00:00+08:00",
			releaseId: "snapshot:bus:2026-03-20",
			routes: [
				{
					departures: [
						{
							departureTime: "07:00",
							id: "route:haidian-to-fengtai:0700",
							note: null,
							sequence: 1,
							sourceNoticeRefs: ["https://portal.muc.edu.cn/notice/123"],
							status: "normal",
							type: "教师班次",
						},
						{
							departureTime: "12:10",
							id: "route:haidian-to-fengtai:1210",
							note: "新增班次",
							sequence: 2,
							sourceNoticeRefs: ["https://portal.muc.edu.cn/notice/123"],
							status: "added",
							type: "学生班次",
						},
					],
					destination: "丰台校区",
					displayName: "海淀校区→丰台校区",
					note: "丰台校区乘车点临时调整至南门外停车区",
					origin: "海淀校区",
					routeId: "route:haidian-to-fengtai",
					status: "running",
				},
			],
			serviceDate: "2026-06-24",
			status: "available",
		});

		render(<ServicesPage />);

		expect(
			await screen.findByRole("heading", { name: "班车时刻表", level: 1 }),
		).toBeInTheDocument();
		expect(
			await screen.findByRole("heading", { name: "班车时刻表", level: 2 }),
		).toBeInTheDocument();
		const serviceDateInput = screen.getByLabelText("服务日期") as HTMLInputElement;
		expect(serviceDateInput.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(screen.getByText("工作日")).toBeInTheDocument();
		expect(screen.getByText("今日含 1 条调整")).toBeInTheDocument();
		expect(screen.getByText("海淀校区→丰台校区")).toBeInTheDocument();
		expect(screen.getByText("07:00")).toBeInTheDocument();
		expect(screen.getByText("教师班次")).toBeInTheDocument();
		expect(screen.getByText("12:10")).toBeInTheDocument();
		expect(screen.getByText("学生班次")).toBeInTheDocument();
		expect(screen.getByText("加开")).toBeInTheDocument();
		expect(screen.getByText("新增班次")).toBeInTheDocument();
		expect(screen.getByText("丰台校区乘车点临时调整至南门外停车区")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "班车时刻表来源" })).toHaveAttribute(
			"href",
			"https://portal.muc.edu.cn/notice/123",
		);
		expect(screen.queryByText("医保窗口")).toBeNull();
		expect(screen.queryByText("operator")).toBeNull();
		expect(campusServicesApiMock.getCampusTransportSchedule).toHaveBeenCalledWith({
			serviceDate: serviceDateInput.value,
		});
	});

	it("keeps the campus services schedule table on the existing component stack", () => {
		expect(servicesPageSource).toContain('from "@heroui/react"');
		expect(servicesPageSource).toContain("<Table.");
		expect(servicesPageSource).not.toContain("@tanstack/react-table");
		expect(servicesPageSource).not.toContain("<table");
	});

	it("renders campus services schedule empty and error states", async () => {
		campusServicesApiMock.getCampusTransportSchedule.mockResolvedValue({
			adjustmentCount: 0,
			calendarLabel: "以发布时刻表为准",
			generatedAt: "2026-06-11T08:00:00.000Z",
			hasAdjustments: false,
			notices: [],
			publishedAt: null,
			releaseId: null,
			routes: [],
			serviceDate: "2026-06-11",
			status: "unavailable",
		});
		const { unmount } = render(<ServicesPage />);

		expect(await screen.findByText("班车时刻表暂时无法读取。")).toBeInTheDocument();
		unmount();
		campusServicesApiMock.getCampusTransportSchedule.mockRejectedValue(new Error("failed"));
		render(<ServicesPage />);

		expect(await screen.findByText("班车时刻表暂时无法读取。")).toBeInTheDocument();
	});
});
