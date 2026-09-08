import type { TransportPublicScheduleResponse } from "@campus-agent/transport/domain";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
	filterDepartures,
	getDepartureStatus,
	nextDepartures,
	TransportPageView,
} from "../src/components/transport/transport-page-view";

const data: TransportPublicScheduleResponse = {
	date: "2026-09-07",
	routeCatalog: [],
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

data.routeCatalog = data.routes.map(
	({ routeId, origin, destination, serviceKind, boardingPoint }) => ({
		routeId,
		origin,
		destination,
		serviceKind,
		defaultBoardingPoint: boardingPoint,
		boardingGuide: "企业微信 → 工作台 → 接驳车预约",
		dropOffPoint: "校内智慧中心南侧",
		nextServiceDate: "2026-09-12",
	}),
);

const props = {
	data,
	date: data.date,
	routeId: data.routes[0]?.routeId,
	routeChoices: data.routeCatalog,
	rider: "all" as const,
	now: new Date("2026-09-07T10:20:00+08:00"),
	onDateChange: vi.fn(),
	onRouteChange: vi.fn(),
	onRiderChange: vi.fn(),
	onRefresh: vi.fn(),
};

describe("transport page", () => {
	it("pairs subway stations and preserves direction when changing station", () => {
		const base = data.routeCatalog[1];
		if (!base) {
			throw new Error("missing subway fixture");
		}
		const routes = ["五棵松地铁站", "篱笆房地铁站"].flatMap((station, index) => [
			{
				...base,
				routeId: `out-${index}`,
				origin: "丰台校区",
				destination: station,
			},
			{
				...base,
				routeId: `in-${index}`,
				origin: station,
				destination: "丰台校区",
			},
		]);
		function Harness() {
			const [routeId, setRouteId] = useState("out-0");
			return (
				<TransportPageView
					{...props}
					serviceKind="subway"
					routeChoices={routes}
					routeId={routeId}
					onRouteChange={setRouteId}
				/>
			);
		}
		render(<Harness />);
		fireEvent.click(screen.getByRole("button", { name: "回丰台校区" }));
		expect(screen.getByRole("article", { name: "五棵松地铁站 → 丰台校区" })).toBeVisible();
		fireEvent.click(screen.getByRole("button", { name: "篱笆房" }));
		expect(screen.getByRole("button", { name: "回丰台校区" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect(screen.getByRole("article", { name: "篱笆房地铁站 → 丰台校区" })).toBeVisible();
		fireEvent.click(screen.getByRole("button", { name: "去地铁站" }));
		expect(screen.getByRole("article", { name: "丰台校区 → 篱笆房地铁站" })).toBeVisible();
		expect(screen.queryByRole("button", { name: "查返程" })).not.toBeInTheDocument();
	});
	it("selects the available direction for a one-way subway station", () => {
		const inbound = data.routeCatalog[1];
		if (!inbound) {
			throw new Error("missing subway fixture");
		}
		const outbound = {
			...inbound,
			routeId: "out-only",
			origin: "丰台校区",
			destination: "篱笆房地铁站",
		};
		const Harness = () => {
			const [routeId, setRouteId] = useState(inbound.routeId);
			return (
				<TransportPageView
					{...props}
					serviceKind="subway"
					routeChoices={[inbound, outbound]}
					routeId={routeId}
					onRouteChange={setRouteId}
				/>
			);
		};
		render(<Harness />);
		expect(screen.queryByRole("button", { name: "去地铁站" })).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "篱笆房" }));
		expect(screen.getByRole("button", { name: "去地铁站" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect(screen.queryByRole("button", { name: "回丰台校区" })).not.toBeInTheDocument();
	});
	it("collapses fixed route information on dates with no service", () => {
		render(<TransportPageView {...props} data={{ ...data, routes: [] }} />);
		expect(screen.getByText("当天暂无班次安排")).toBeVisible();
		expect(screen.getByText("乘车点：聚雅餐厅东侧停车场路口")).not.toBeVisible();
		fireEvent.click(screen.getByText("线路信息"));
		expect(screen.getByText("乘车点：聚雅餐厅东侧停车场路口")).toBeVisible();
		expect(screen.getByText("下车点：校内智慧中心南侧")).toBeVisible();
		expect(screen.getByText("企业微信 → 工作台 → 接驳车预约")).toBeVisible();
		expect(screen.queryByText("乘车指引")).not.toBeInTheDocument();
	});
	it("groups today's remaining departures without hiding future services", () => {
		const base = data.routes[0];
		const departure = base?.departures[0];
		if (!(base && departure)) {
			throw new Error("missing departure fixture");
		}
		const departures = ["06:00", "08:00", "09:00", "13:00", "19:00"].map((departureTime) => ({
			...departure,
			kind: "fixed" as const,
			departureTime,
		}));
		render(
			<TransportPageView
				{...props}
				data={{ ...data, routes: [{ ...base, departures }] }}
				now={new Date("2026-09-07T07:00:00+08:00")}
			/>,
		);
		expect(screen.getByText("08:00")).toBeVisible();
		for (const time of ["09:00", "13:00", "19:00"]) {
			expect(screen.getByText(time)).toBeVisible();
		}
		for (const name of ["早间", "白天", "晚间"]) {
			expect(screen.getByRole("heading", { name })).toBeVisible();
		}
		expect(screen.getByText("06:00")).not.toBeVisible();
	});
	it("offers the next configured date for a route without today's service", () => {
		const onDateChange = vi.fn();
		render(
			<TransportPageView {...props} data={{ ...data, routes: [] }} onDateChange={onDateChange} />,
		);
		expect(screen.getByRole("button", { name: "丰台校区 → 海淀校区" })).toBeEnabled();
		expect(screen.getByText("当天暂无班次安排")).toBeVisible();
		fireEvent.click(screen.getByRole("button", { name: "查看 9月12日班次" }));
		expect(onDateChange).toHaveBeenCalledWith("2026-09-12");
	});
	it("offers only an unambiguous same-kind reverse direction", () => {
		const forward = data.routeCatalog[0];
		if (!forward) {
			throw new Error("missing catalog fixture");
		}
		const reverse = {
			...forward,
			routeId: "reverse",
			origin: forward.destination,
			destination: forward.origin,
		};
		const onRouteChange = vi.fn();
		const { rerender } = render(
			<TransportPageView
				{...props}
				routeChoices={[forward, reverse]}
				onRouteChange={onRouteChange}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "查返程" }));
		expect(onRouteChange).toHaveBeenCalledWith("reverse");
		rerender(
			<TransportPageView
				{...props}
				routeChoices={[forward, { ...reverse, serviceKind: "subway" }]}
			/>,
		);
		expect(screen.queryByRole("button", { name: "查返程" })).toBeNull();
		rerender(
			<TransportPageView
				{...props}
				routeChoices={[forward, reverse, { ...reverse, routeId: "another" }]}
			/>,
		);
		expect(screen.queryByRole("button", { name: "查返程" })).toBeNull();
	});
	it("groups shared boarding points and audience while exposing separate drop-off and guidance", () => {
		const base = data.routes[0];
		if (!base) {
			throw new Error("missing route fixture");
		}
		const route = {
			...base,
			departures: ["08:00", "09:00"].map((departureTime) => ({
				kind: "fixed" as const,
				departureTime,
				riderType: "all" as const,
				boardingPoint: "南侧乘车点",
				capacity: null,
				note: null,
			})),
		};
		render(
			<TransportPageView
				{...props}
				data={{ ...data, routes: [route] }}
				now={new Date("2026-09-06T10:20:00+08:00")}
			/>,
		);
		expect(screen.getAllByText("乘车点：南侧乘车点")).toHaveLength(1);
		expect(screen.queryByRole("group", { name: "班次对象" })).toBeNull();
		expect(screen.getByText("下车点：校内智慧中心南侧")).toBeVisible();
		const guide = screen.getByText("企业微信 → 工作台 → 接驳车预约");
		expect(guide).not.toBeVisible();
		fireEvent.click(screen.getByText("乘车指引"));
		expect(guide).toBeVisible();
	});
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
	it("does not hide the common stop when the next departure uses a different stop", () => {
		render(<TransportPageView {...props} now={new Date("2026-09-07T06:00:00+08:00")} />);
		expect(screen.getByRole("region", { name: "下一班及当前运行班次" })).toHaveTextContent(
			"教师班车乘车点",
		);
		expect(screen.getByText("乘车点：聚雅餐厅东侧停车场路口")).toBeVisible();
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
		rerender(<TransportPageView {...props} data={{ ...data, routes: [] }} />);
		expect(screen.getByText("当天暂无班次安排")).toBeVisible();
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
