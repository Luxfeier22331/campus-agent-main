import type { TransportPublicScheduleResponse } from "@campus-agent/transport/domain";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
		expect(screen.getByRole("status")).toHaveTextContent("更新中 · 当前为 9月7日班次");
		expect(screen.getByRole("region", { name: "下一班及当前运行班次" })).toHaveTextContent("18:00");
		expect(document.querySelector("time")?.getAttribute("datetime")).toContain("2026-09-07");
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
		await screen.findByText("查询失败，当前显示 9月7日班次");
		expect(screen.getByText("班次-2026-09-07")).toBeVisible();
		expect(client.getQueryData(transportQueryKeys.schedule("2026-09-08"))).toBeUndefined();
		pending = deferred();
		fireEvent.click(screen.getByRole("button", { name: "重试" }));
		await waitFor(() => expect(screen.queryByText(/查询失败/)).not.toBeInTheDocument());
		expect(screen.getByText("班次-2026-09-07")).toBeVisible();
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
		await screen.findByText("查询失败，当前显示 9月7日班次");
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

	it("resets delayed feedback when changing the requested date", async () => {
		const pending = deferred();
		vi.stubGlobal(
			"fetch",
			vi.fn((url: string) =>
				url.includes("2026-09-07") ? Promise.resolve(response("2026-09-07")) : pending.promise,
			),
		);
		await mountLoaded();
		fireEvent.click(screen.getByRole("button", { name: "后一天" }));
		await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("仍在更新"), {
			timeout: 2000,
		});
		fireEvent.click(screen.getByRole("button", { name: "后一天" }));
		expect(screen.getByRole("status")).toHaveTextContent("更新中 · 当前为 9月7日班次");
		fireEvent.click(screen.getByRole("button", { name: "今天" }));
		expect(screen.queryByRole("status")).not.toBeInTheDocument();
	});
});
