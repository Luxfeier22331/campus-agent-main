import { afterEach, describe, expect, it, vi } from "vitest";

import {
	reportWebPerformanceMetric,
	resolveWebPerformanceRouteGroup,
} from "../src/platform/telemetry/web-performance";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("campus web performance telemetry", () => {
	it("groups routes without sending a raw pathname", () => {
		expect(resolveWebPerformanceRouteGroup("/dining")).toBe("dining");
		expect(resolveWebPerformanceRouteGroup("/c/conv-secret")).toBe("qa");
		expect(resolveWebPerformanceRouteGroup("/account/settings/security")).toBe("account");
		expect(resolveWebPerformanceRouteGroup("/unknown/private-path")).toBe("other");
	});

	it("posts a bounded anonymous Web Vital projection", async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
		vi.stubGlobal("fetch", fetchMock);

		reportWebPerformanceMetric(
			{
				delta: 1_250,
				entries: [],
				id: "v5-high-cardinality-id",
				name: "LCP",
				navigationType: "navigate",
				rating: "good",
				value: 1_250,
			},
			"dining",
		);
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

		const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
		const body = JSON.parse(String(request.body));
		expect(body).toEqual({
			metricName: "LCP",
			navigationType: "navigate",
			rating: "good",
			routeGroup: "dining",
			schemaVersion: "web_performance.v1",
			value: 1_250,
		});
		expect(request.credentials).toBe("omit");
		expect(request.keepalive).toBe(true);
		expect(JSON.stringify(body)).not.toContain("v5-high-cardinality-id");
	});
});
