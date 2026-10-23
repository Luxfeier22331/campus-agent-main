import type { TransportPublicScheduleResponse } from "@campus-agent/transport/domain";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, assert, beforeEach, describe, expect, it, vi } from "vitest";
import { TransportPageContent } from "../src/app/routes/transport-page";
import { transportQueryKeys } from "../src/features/transport/queries";
import { createCampusQueryClient } from "../src/platform/query/client";

function schedule(date: string): TransportPublicScheduleResponse {
	const route = {
		routeId: "commute",
		origin: "丰台校区",
		destination: "海淀校区",
		serviceKind: "commute" as const,
	};
	return {
		date,
		routeCatalog: [
			{
				...route,
				defaultBoardingPoint: "餐厅东侧",
				boardingGuide: null,
				dropOffPoint: null,
				nextServiceDate: date,
			},
		],
		routes: [
			{
				...route,
				boardingPoint: "餐厅东侧",
				status: "operating",
				note: `班次-${date}`,
				departures: [
					{
						kind: "fixed",
						departureTime: "18:00",
						riderType: "all",
						boardingPoint: null,
						capacity: null,
						note: null,
					},
					{
						kind: "fixed",
						departureTime: "19:00",
						riderType: "all",
						boardingPoint: null,
						capacity: null,
						note: null,
					},
				],
			},
		],
	};
}

function response(date: string) {
	return new Response(JSON.stringify(schedule(date)), {
		headers: { "content-type": "application/json" },
	});
}

function deferred() {
	let resolve!: (response: Response) => void;
	const promise = new Promise<Response>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

let client: ReturnType<typeof createCampusQueryClient>;
beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-09-07T10:20:00+08:00"));
	client = createCampusQueryClient();
});
afterEach(() => {
	cleanup();
	client.clear();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

async function mountLoaded() {
	render(
		<QueryClientProvider client={client}>
			<TransportPageContent />
		</QueryClientProvider>,
	);
	await screen.findByText("班次-2026-09-07");
}

describe("transport query transitions", () => {
	it("loads notice metadata, persists resolved selections, and hides old notices while switching date", async () => {
		const pending = deferred();
		const first = schedule("2026-09-07");
		const route = first.routes[0];
		assert(route);
		route.noticeContext = {
			validFrom: "2026-09-07",
			validTo: null,
			weekdays: [1, 2, 3, 4, 5],
			notices: [
				{
					noticeId: "355867",
					title: "仅前一天的通知",
					releasedAt: "2026-04-25T00:00:00Z",
					isExternal: false,
					externalUrl: null,
				},
			],
		};
		const fetch = vi.fn((input: RequestInfo | URL) => {
			const url = new URL(String(input), "https://campus.test");
			expect(url.searchParams.get("include")).toBe("notices");
			return url.searchParams.get("date") === "2026-09-07"
				? Promise.resolve(Response.json(first))
				: pending.promise;
		});
		vi.stubGlobal("fetch", fetch);
		const onSelectionChange = vi.fn();
		render(
			<QueryClientProvider client={client}>
				<TransportPageContent
					initialSearch={{ date: "2026-09-07", rider: "student" }}
					onSelectionChange={onSelectionChange}
				/>
			</QueryClientProvider>,
		);
		await screen.findByRole("link", { name: /仅前一天的通知/ });
		expect(onSelectionChange).toHaveBeenLastCalledWith({
			date: "2026-09-07",
			rider: "student",
			serviceKind: "commute",
			routeId: "commute",
		});
		fireEvent.click(screen.getByRole("button", { name: "后一天" }));
		expect(screen.queryByRole("link", { name: /仅前一天的通知/ })).not.toBeInTheDocument();
		await act(async () => pending.resolve(response("2026-09-08")));
		await screen.findByText("班次-2026-09-08");
	});
	it("keeps audience controls usable during cross-date loading without showing old departures", async () => {
		const pending = deferred();
		const first = schedule("2026-09-07");
		for (const route of first.routes) {
			route.departures = route.departures.map((departure, index) => ({
				...departure,
				riderType: index === 0 ? "teacher" : "all",
			}));
		}
		vi.stubGlobal(
			"fetch",
			vi.fn((url: string) =>
				url.includes("2026-09-08") ? pending.promise : Promise.resolve(Response.json(first)),
			),
		);
		await mountLoaded();
		const controls = screen.getByRole("radiogroup", { name: "班次对象" });
		fireEvent.click(screen.getByRole("button", { name: "后一天" }));
		expect(screen.getByRole("radiogroup", { name: "班次对象" })).toBe(controls);
		fireEvent.click(within(controls).getByRole("radio", { name: "学生" }));
		expect(within(controls).getByRole("radio", { name: "学生" })).toHaveAttribute(
			"aria-checked",
			"true",
		);
		expect(screen.queryByRole("article")).not.toBeInTheDocument();
		expect(document.querySelector("time")).toBeNull();
		const next = schedule("2026-09-08");
		next.routes = first.routes.map((route) => ({ ...route, note: "班次-2026-09-08" }));
		await act(async () => pending.resolve(Response.json(next)));
		await screen.findByText("班次-2026-09-08");
		expect(screen.queryByText("18:00")).not.toBeInTheDocument();
		expect(screen.getByText("19:00")).toBeVisible();
	});
	it("counts both directions of the selected subway station, excluding other stations", async () => {
		const daily = schedule("2026-09-07");
		const base = daily.routes[0];
		const catalog = daily.routeCatalog[0];
		if (!(base && catalog)) {
			throw new Error("missing route fixture");
		}
		daily.routes = [
			{ origin: "丰台校区", destination: "篱笆房地铁站" },
			{ origin: "篱笆房地铁站", destination: "丰台校区" },
			{ origin: "丰台校区", destination: "五棵松地铁站" },
		].map((direction, index) => ({
			...base,
			...direction,
			serviceKind: "subway",
			routeId: `subway-${index}`,
			departures: base.departures.slice(0, 1),
		}));
		daily.routeCatalog = daily.routes.map(({ routeId, origin, destination, serviceKind }) => ({
			...catalog,
			routeId,
			origin,
			destination,
			serviceKind,
		}));
		vi.stubGlobal(
			"fetch",
			vi.fn((url: string) =>
				Promise.resolve(
					Response.json(
						url.includes("schedule-range")
							? { from: "2026-09-01", to: "2026-09-30", days: [daily] }
							: daily,
					),
				),
			),
		);
		render(
			<QueryClientProvider client={client}>
				<TransportPageContent />
			</QueryClientProvider>,
		);
		await screen.findByRole("article", { name: "丰台校区 → 篱笆房地铁站" });
		fireEvent.click(screen.getByRole("button", { name: "选择日期：2026-09-07" }));
		expect(await screen.findByText("2班")).toBeVisible();
		expect(screen.queryByText("3班")).not.toBeInTheDocument();
	});
	it("keeps the response date and next departure until the new date succeeds", async () => {
		const pending = deferred();
		vi.stubGlobal(
			"fetch",
			vi.fn((url: string) =>
				url.includes("2026-09-08") ? pending.promise : Promise.resolve(response("2026-09-07")),
			),
		);
		await mountLoaded();
		fireEvent.click(screen.getByRole("button", { name: "后一天" }));
		expect(screen.getByRole("button", { name: "选择日期：2026-09-08" })).toBeEnabled();
		expect(screen.getByRole("status", { name: "正在加载班车信息" })).toBeVisible();
		expect(screen.getByRole("button", { name: "刷新班车信息" })).toBeDisabled();
		expect(screen.queryByText("班次-2026-09-07")).not.toBeInTheDocument();
		expect(document.querySelector("time")).toBeNull();
		await act(async () => pending.resolve(response("2026-09-08")));
		await screen.findByText("班次-2026-09-08");
		expect(screen.queryByText("下一班")).not.toBeInTheDocument();
		expect(screen.queryByRole("status")).not.toBeInTheDocument();
		expect(document.querySelector("time")?.getAttribute("datetime")).toContain("2026-09-08");
	});

	it("retains the last successful date on failure and retries the selected date", async () => {
		let pending = deferred();
		const fetch = vi.fn((url: string) =>
			url.includes("2026-09-08") ? pending.promise : Promise.resolve(response("2026-09-07")),
		);
		vi.stubGlobal("fetch", fetch);
		await mountLoaded();
		fireEvent.click(screen.getByRole("button", { name: "后一天" }));
		await act(async () => pending.resolve(new Response("unavailable", { status: 503 })));
		await screen.findByText("班车信息加载失败");
		expect(screen.queryByText("班次-2026-09-07")).not.toBeInTheDocument();
		expect(client.getQueryData(transportQueryKeys.schedule("2026-09-08"))).toBeUndefined();
		pending = deferred();
		fireEvent.click(screen.getByRole("button", { name: "重试" }));
		await waitFor(() => expect(screen.queryByText(/查询失败/)).not.toBeInTheDocument());
		expect(screen.queryByText("班次-2026-09-07")).not.toBeInTheDocument();
		expect(fetch.mock.calls.at(-1)?.[0]).toContain("date=2026-09-08");
		await act(async () => pending.resolve(response("2026-09-08")));
		await screen.findByText("班次-2026-09-08");
	});

	it("keeps a same-day schedule when manual refresh fails", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(response("2026-09-07"))
			.mockResolvedValue(new Response("unavailable", { status: 503 }));
		vi.stubGlobal("fetch", fetch);
		await mountLoaded();
		fireEvent.click(screen.getByRole("button", { name: "刷新班车信息" }));
		await waitFor(() => expect(screen.getByText("班次-2026-09-07")).toBeVisible());
		expect(screen.getByText("班次-2026-09-07")).toBeVisible();
		expect(screen.getByRole("region", { name: "下一班及当前运行班次" })).toBeVisible();
	});

	it("shows an initial error without invented data and recovers on retry", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
			.mockResolvedValueOnce(response("2026-09-07"));
		vi.stubGlobal("fetch", fetch);
		render(
			<QueryClientProvider client={client}>
				<TransportPageContent />
			</QueryClientProvider>,
		);
		await screen.findByText("班车信息加载失败");
		expect(screen.queryByRole("article")).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "重试" }));
		await screen.findByText("班次-2026-09-07");
	});

	it("cancels an obsolete date and ignores its late response", async () => {
		const first = deferred();
		const last = deferred();
		let firstSignal: AbortSignal | undefined;
		vi.stubGlobal(
			"fetch",
			vi.fn((url: string, options: RequestInit) => {
				if (url.includes("2026-09-08")) {
					firstSignal = options.signal ?? undefined;
					return first.promise;
				}
				if (url.includes("2026-09-09")) {
					return last.promise;
				}
				return Promise.resolve(response("2026-09-07"));
			}),
		);
		await mountLoaded();
		fireEvent.click(screen.getByRole("button", { name: "后一天" }));
		fireEvent.click(screen.getByRole("button", { name: "后一天" }));
		expect(firstSignal?.aborted).toBe(true);
		await act(async () => last.resolve(response("2026-09-09")));
		await screen.findByText("班次-2026-09-09");
		await act(async () => first.resolve(response("2026-09-08")));
		expect(screen.getByText("班次-2026-09-09")).toBeVisible();
		expect(screen.queryByText("班次-2026-09-08")).not.toBeInTheDocument();
	});

	it("does not add intrusive update notices when changing dates", async () => {
		const pending = deferred();
		vi.stubGlobal(
			"fetch",
			vi.fn((url: string) =>
				url.includes("2026-09-07") ? Promise.resolve(response("2026-09-07")) : pending.promise,
			),
		);
		await mountLoaded();
		fireEvent.click(screen.getByRole("button", { name: "后一天" }));
		expect(screen.getByRole("status", { name: "正在加载班车信息" })).toBeVisible();
		fireEvent.click(screen.getByRole("button", { name: "后一天" }));
		expect(screen.getByRole("status", { name: "正在加载班车信息" })).toBeVisible();
		fireEvent.click(screen.getByRole("button", { name: "今天" }));
		expect(screen.queryByRole("status")).not.toBeInTheDocument();
	});
	it("loads month availability and reuses its dates without another daily request", async () => {
		const days = Array.from({ length: 30 }, (_, index) =>
			schedule(`2026-09-${String(index + 1).padStart(2, "0")}`),
		);
		const fetch = vi.fn((url: string) =>
			Promise.resolve(
				url.includes("schedule-range")
					? new Response(JSON.stringify({ from: "2026-09-01", to: "2026-09-30", days }), {
							headers: { "content-type": "application/json" },
						})
					: response("2026-09-07"),
			),
		);
		vi.stubGlobal("fetch", fetch);
		await mountLoaded();
		expect(fetch).toHaveBeenCalledTimes(1);
		fireEvent.click(screen.getByRole("button", { name: "选择日期：2026-09-07" }));
		await waitFor(() =>
			expect(client.getQueryData(transportQueryKeys.schedule("2026-09-08"))).toEqual(
				schedule("2026-09-08"),
			),
		);
		expect(await screen.findAllByText("2班")).toHaveLength(30);
		fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
		fireEvent.click(screen.getByRole("button", { name: "后一天" }));
		await screen.findByText("班次-2026-09-08");
		expect(fetch).toHaveBeenCalledTimes(2);
		for (const [url] of fetch.mock.calls) {
			expect(new URL(url, "https://campus.test").searchParams.get("include")).toBe("notices");
		}
	});
});

describe("transport date intent", () => {
	it("only prefetches an intended day, deduplicates intent and renders its cache immediately", async () => {
		const fetch = vi.fn((input: string) =>
			Promise.resolve(
				response(new URL(input, "https://campus.test").searchParams.get("date") ?? "2026-09-07"),
			),
		);
		vi.stubGlobal("fetch", fetch);
		await mountLoaded();
		expect(fetch).toHaveBeenCalledTimes(1);
		const next = screen.getByRole("button", { name: "后一天" });
		fireEvent.pointerEnter(next);
		fireEvent.focus(next);
		fireEvent.touchStart(next);
		await waitFor(() =>
			expect(client.getQueryData(transportQueryKeys.schedule("2026-09-08"))).toEqual(
				schedule("2026-09-08"),
			),
		);
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(screen.getByText("班次-2026-09-07")).toBeVisible();
		fireEvent.click(next);
		expect(screen.getByText("班次-2026-09-08")).toBeVisible();
		expect(screen.queryByRole("status", { name: "正在加载班车信息" })).not.toBeInTheDocument();
		expect(fetch).toHaveBeenCalledTimes(2);
	});
});
