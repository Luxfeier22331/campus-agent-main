import { describe, expect, it } from "vitest";

import {
	fetchStatusSnapshot,
	formatDateTime,
	formatDayLabel,
	isSnapshotExpired,
	statusCalendarDay,
	timelineDays,
	timelineSummary,
} from "../public/status-page.js";

describe("status page display model", () => {
	it("anchors the 30 day window to the snapshot timestamp", () => {
		const days = timelineDays(
			[{ day: "2026-08-07", status: "operational" }],
			new Date("2026-08-07T00:05:00Z"),
		);

		expect(days).toHaveLength(30);
		expect(days[0]?.day).toBe("2026-07-09");
		expect(days.at(-1)).toEqual({ day: "2026-08-07", status: "operational" });
	});

	it("keeps missing dates separate from an explicit unknown result", () => {
		const days = timelineDays(
			[
				{ day: "2026-08-06", status: "unknown" },
				{ day: "2026-08-07", status: "operational" },
			],
			new Date("2026-08-07T00:05:00Z"),
		);

		expect(days.find((entry) => entry.day === "2026-08-06")?.status).toBe("unknown");
		expect(days.find((entry) => entry.day === "2026-08-05")?.status).toBeNull();
		expect(timelineSummary(days)).toContain("无历史数据");
	});

	it("marks an expired snapshot without changing its timeline model", () => {
		expect(
			isSnapshotExpired(
				{
					expiresAt: "2026-08-07T00:00:00Z",
					generatedAt: "2026-08-07T00:00:00Z",
					services: [{ checkedAt: null, status: "unknown", timeline: [] }],
				},
				new Date("2026-08-07T00:01:00Z"),
			),
		).toBe(true);
		expect(
			isSnapshotExpired(
				{
					expiresAt: "2026-08-07T00:00:00Z",
					generatedAt: "2026-08-07T00:00:00Z",
					services: [
						{
							checkedAt: null,
							status: "operational",
							timeline: [],
						},
					],
				},
				new Date("2026-08-07T00:01:00Z"),
			),
		).toBe(true);
		expect(
			isSnapshotExpired(
				{
					expiresAt: "2026-08-07T00:00:00Z",
					generatedAt: "2026-08-07T00:00:00Z",
					services: [
						{
							checkedAt: null,
							status: "unknown",
							timeline: [{ day: "2026-08-06", status: "unknown" }],
						},
					],
				},
				new Date("2026-08-07T00:01:00Z"),
			),
		).toBe(true);
		expect(
			isSnapshotExpired({ expiresAt: "2026-08-07T00:15:00Z" }, new Date("2026-08-07T00:16:00Z")),
		).toBe(true);
		expect(
			isSnapshotExpired({ expiresAt: "2026-08-07T00:15:00Z" }, new Date("2026-08-07T00:14:00Z")),
		).toBe(false);
	});

	it("formats date-only timeline labels without shifting the day", () => {
		expect(formatDayLabel("2026-08-07")).toBe("2026年8月7日 周五");
	});

	it("uses Beijing calendar days at the UTC boundary", () => {
		expect(statusCalendarDay(new Date("2026-08-06T15:59:59Z"))).toBe("2026-08-06");
		expect(statusCalendarDay(new Date("2026-08-06T16:00:00Z"))).toBe("2026-08-07");
		expect(timelineDays([], new Date("2026-08-06T16:05:00Z")).at(-1)?.day).toBe("2026-08-07");
		expect(formatDateTime("2026-08-06T16:05:00Z")).toContain("00:05");
	});

	it("sends conditional requests and accepts a not-modified response", async () => {
		const requests: RequestInit[] = [];
		const result = await fetchStatusSnapshot(
			async (_input: RequestInfo | URL, init?: RequestInit) => {
				requests.push(init ?? {});
				return new Response(null, { headers: { etag: '"same"' }, status: 304 });
			},
			{ etag: '"same"' },
		);

		expect(result).toEqual({ etag: '"same"', kind: "not-modified" });
		expect(requests[0]).toBeDefined();
		if (!requests[0]) {
			throw new Error("request was not captured");
		}
		expect(requests[0].cache).toBe("no-cache");
		expect(requests[0].headers).toBeInstanceOf(Headers);
		expect(new Headers(requests[0].headers).get("if-none-match")).toBe('"same"');
	});

	it("returns an empty result for a 204 response", async () => {
		await expect(
			fetchStatusSnapshot(async () => new Response(null, { status: 204 })),
		).resolves.toEqual({ etag: null, kind: "empty" });
	});

	it("rejects snapshots outside the exact v1 service set", async () => {
		const snapshot = {
			environment: "staging",
			expiresAt: "2026-08-07T00:15:00Z",
			generatedAt: "2026-08-07T00:05:00Z",
			schemaVersion: "product-availability-snapshot.v1",
			services: [
				{
					checkedAt: "2026-08-07T00:05:00Z",
					id: "campus.qa",
					name: "校园问答",
					status: "operational",
					timeline: [],
				},
				{
					checkedAt: "2026-08-07T00:05:00Z",
					id: "campus.services",
					name: "其他服务",
					status: "operational",
					timeline: [],
				},
			],
		};
		const fetchSnapshot = (body: unknown) =>
			fetchStatusSnapshot(
				async () =>
					new Response(JSON.stringify(body), {
						headers: { "content-type": "application/json" },
						status: 200,
					}),
			);

		await expect(
			fetchSnapshot({ ...snapshot, schemaVersion: "product-availability-snapshot.v2" }),
		).rejects.toThrow("invalid status snapshot");
		await expect(
			fetchSnapshot({ ...snapshot, services: [...snapshot.services].reverse() }),
		).rejects.toThrow("invalid status snapshot");
	});
});
