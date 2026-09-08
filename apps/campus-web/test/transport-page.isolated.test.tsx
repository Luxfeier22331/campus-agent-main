import type { TransportPublicScheduleResponse } from "@campus-agent/transport/domain";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
	filterDepartures,
	getDepartureStatus,
	nextDepartures,
	TransportPageView,
} from "../src/components/transport/transport-page-view";

const data: TransportPublicScheduleResponse = {
	date: "2026-09-07",
	routes: [
		{
			boardingPoint: "聚雅餐厅东侧停车场路口",
			departures: [
				{
					boardingPoint: "教师班车乘车点",
					capacity: null,
					departureTime: "06:40",
					kind: "fixed" as const,
					note: null,
					riderType: "teacher" as const,
				},
				{
					boardingPoint: null,
					capacity: null,
					departureTime: "18:00",
					kind: "fixed" as const,
					note: null,
					riderType: "student" as const,
				},
			],
			destination: "海淀校区",
			note: null,
			origin: "丰台校区",
			routeId: "route:fengtai-to-haidian",
			serviceKind: "commute" as const,
			status: "operating" as const,
		},
		{
			boardingPoint: "五棵松地铁站A口",
			departures: [],
			destination: "丰台校区",
			note: "当天停运",
			origin: "五棵松地铁站",
			routeId: "route:wukesong-to-fengtai",
			serviceKind: "subway" as const,
			status: "suspended" as const,
		},
	],
};

const props = {
	data,
	date: data.date,
	routeId: data.routes[0]?.routeId,
	routeChoices: data.routes,
	rider: "all" as const,
	now: new Date("2026-09-07T10:20:00+08:00"),
	onDateChange: vi.fn(),
	onRouteChange: vi.fn(),
	onRiderChange: vi.fn(),
	onRefresh: vi.fn(),
};

describe("transport page", () => {
	it("preserves interval services and distinguishes their operating window", () => {
		const interval = {
			kind: "interval" as const,
			firstDepartureTime: "10:00",
			lastDepartureTime: "12:00",
			intervalMinutes: 20,
			riderType: "all" as const,
			boardingPoint: null,
			capacity: null,
			note: null,
		};
		expect(
			getDepartureStatus(interval, props.date, props.date, new Date("2026-09-07T09:59:00+08:00")),
		).toBe("upcoming");
		expect(nextDepartures([interval], props.date, props.now)).toEqual([interval]);
		expect(
			getDepartureStatus(interval, props.date, props.date, new Date("2026-09-07T12:01:00+08:00")),
		).toBe("past");
	});
	it("distinguishes suspended, rider-empty and finished schedules", () => {
		const { rerender } = render(<TransportPageView {...props} routeId={data.routes[1]?.routeId} />);
		expect(screen.getAllByText("当天停运").length).toBeGreaterThan(0);
		rerender(<TransportPageView {...props} now={new Date("2026-09-07T23:00:00+08:00")} />);
		expect(screen.getByText("今日班次已结束")).toBeVisible();
		rerender(
			<TransportPageView
				{...props}
				data={{ ...data, routes: data.routes.map((route) => ({ ...route, departures: [] })) }}
			/>,
		);
		expect(screen.getByText("当天暂无该对象班次")).toBeVisible();
	});
	it("renders structured route data without source-processing text", () => {
		render(<TransportPageView {...props} />);

		expect(screen.getByRole("heading", { level: 1, name: "校园班车" })).toBeInTheDocument();
		expect(screen.getAllByRole("article")).toHaveLength(1);
		const commute = screen.getByRole("article", { name: "丰台校区 → 海淀校区" });
		expect(within(commute).getAllByText("乘车点：聚雅餐厅东侧停车场路口").length).toBeGreaterThan(
			0,
		);
		expect(within(commute).getByText("教师班次")).toBeInTheDocument();
		expect(within(commute).getByText("乘车点：教师班车乘车点")).toBeInTheDocument();
		expect(within(commute).getAllByText("学生班次").length).toBeGreaterThan(0);
		expect(screen.getByRole("region", { name: "下一班及当前运行班次" })).toHaveTextContent("18:00");

		const text = document.body.textContent ?? "";
		expect(text).not.toContain("来源");
		expect(text).not.toContain("证据");
		expect(text).not.toContain("声明");
		expect(text).not.toContain("通知整理");
	});

	it("classifies fixed departures by the selected local date and time", () => {
		const departure = data.routes[0]?.departures[0];
		if (!departure) {
			throw new Error("test fixture must contain a departure");
		}
		expect(getDepartureStatus(departure, "2026-09-06", "2026-09-07", new Date())).toBe("past");
		expect(getDepartureStatus(departure, "2026-09-08", "2026-09-07", new Date())).toBe("upcoming");
		expect(
			getDepartureStatus(
				departure,
				"2026-09-07",
				"2026-09-07",
				new Date("2026-09-07T07:00:00+08:00"),
			),
		).toBe("past");
	});

	it("calls refresh and date handlers from controls", async () => {
		const onDateChange = vi.fn();
		const onRefresh = vi.fn();
		render(
			<TransportPageView
				{...props}
				data={data}
				date="2026-09-07"
				onDateChange={onDateChange}
				onRefresh={onRefresh}
			/>,
		);
		screen.getByRole("button", { name: "前一天" }).click();
		screen.getByRole("button", { name: "后一天" }).click();
		screen.getByRole("button", { name: "刷新班车信息" }).click();
		screen.getByRole("button", { name: /选择日期/ }).click();
		const dialog = await waitFor(() => screen.getByRole("dialog"));
		fireEvent.click(within(dialog).getByRole("gridcell", { name: "8" }));
		expect(onDateChange).toHaveBeenCalledWith("2026-09-06");
		expect(onDateChange).toHaveBeenCalledWith("2026-09-08");
		expect(onRefresh).toHaveBeenCalledOnce();
	});
	it("keeps future schedules neutral and reports a missing direction", () => {
		const { rerender } = render(
			<TransportPageView {...props} now={new Date("2026-09-06T10:20:00+08:00")} />,
		);
		expect(screen.queryByText("已发车")).toBeNull();
		expect(screen.queryByText("下一班")).toBeNull();
		rerender(<TransportPageView {...props} data={{ date: data.date, routes: [] }} />);
		expect(screen.getByText("该方向当天暂无班次信息")).toBeVisible();
	});
	it("filters all-rider departures and keeps simultaneous next departures", () => {
		const base = data.routes[0]?.departures[0];
		if (!base) {
			throw new Error("missing fixture");
		}
		const departures = [
			{ ...base, kind: "fixed" as const, departureTime: "10:50", riderType: "teacher" as const },
			{ ...base, kind: "fixed" as const, departureTime: "16:20", riderType: "student" as const },
			{ ...base, kind: "fixed" as const, departureTime: "16:20", riderType: "all" as const },
		];
		expect(nextDepartures(filterDepartures(departures, "all"), props.date, props.now)).toHaveLength(
			1,
		);
		expect(
			nextDepartures(filterDepartures(departures, "student"), props.date, props.now),
		).toHaveLength(2);
		expect(nextDepartures(departures, props.date, new Date("2026-09-07T16:20:00+08:00"))).toEqual(
			[],
		);
	});
});
