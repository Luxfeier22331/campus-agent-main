// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
	createSentryClient,
	createSentryClientFromEnv,
	SentryUnavailableError,
	sentryTraceExplorerUrl,
} from "../src/server/sentry-client";

const input = {
	completedAt: "2026-07-09T06:29:04.000Z",
	now: new Date("2026-07-09T06:30:00.000Z"),
	requestId: "req_ops_001",
	startedAt: "2026-07-09T06:29:00.000Z",
	traceId: "trace_ops_001",
};

function issue(index: number) {
	return {
		count: String(index + 1),
		firstSeen: "2026-07-09T06:29:00.000Z",
		id: `45000${index}`,
		lastSeen: "2026-07-09T06:29:04.000Z",
		level: "error",
		permalink: `https://sentry.example.test/organizations/campus/issues/45000${index}/`,
		project: { name: "campus-agent-workers", slug: "campus-agent-workers" },
		shortId: `APP-${index}`,
		status: "unresolved",
		title: `Issue ${index}`,
	};
}

function client(fetchFn: typeof fetch) {
	return createSentryClient({
		baseUrl: "https://sentry.example.test",
		environment: "staging",
		fetchFn,
		orgSlug: "campus",
		projectSlugs: ["campus-agent-workers"],
		token: "sentry-auth-token",
	});
}

describe("Sentry client", () => {
	it("queries the official organization issues API with server-owned filters", async () => {
		const fetchFn = vi.fn().mockResolvedValue(
			new Response(JSON.stringify([issue(0)]), {
				headers: { "content-type": "application/json" },
				status: 200,
			}),
		);
		const response = await client(fetchFn).queryRequestIssues(input);

		expect(fetchFn).toHaveBeenCalledOnce();
		const [requestedUrl, init] = fetchFn.mock.calls[0] as [URL, RequestInit];
		expect(requestedUrl.pathname).toBe("/api/0/organizations/campus/issues/");
		expect(requestedUrl.searchParams.getAll("project")).toEqual(["campus-agent-workers"]);
		expect(requestedUrl.searchParams.get("environment")).toBe("staging");
		expect(requestedUrl.searchParams.get("query")).toBe('campus.request_id:"req_ops_001"');
		expect(requestedUrl.searchParams.get("sort")).toBe("date");
		expect(requestedUrl.searchParams.get("limit")).toBe("6");
		expect(requestedUrl.searchParams.get("start")).toBe("2026-07-09T06:24:00.000Z");
		expect(requestedUrl.searchParams.get("end")).toBe("2026-07-09T06:30:00.000Z");
		expect(new Headers(init.headers).get("authorization")).toBe("Bearer sentry-auth-token");
		expect(init.signal).toBeInstanceOf(AbortSignal);
		expect(response).toMatchObject({
			dataState: "FRESH",
			issues: [{ issueId: "450000", projectSlug: "campus-agent-workers" }],
			limit: 5,
			requestId: "req_ops_001",
			source: "SENTRY",
			truncated: false,
		});
	});

	it("returns five issue summaries and marks a sixth result as truncated", async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValue(
				new Response(JSON.stringify(Array.from({ length: 6 }, (_, index) => issue(index)))),
			);
		const response = await client(fetchFn).queryRequestIssues(input);

		expect(response.issues).toHaveLength(5);
		expect(response.truncated).toBe(true);
	});

	it("represents an empty successful query as no data", async () => {
		const fetchFn = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
		await expect(client(fetchFn).queryRequestIssues(input)).resolves.toMatchObject({
			dataState: "NO_DATA",
			issues: [],
		});
	});

	it.each([
		["invalid JSON", new Response("not-json", { status: 200 })],
		["invalid schema", new Response(JSON.stringify([{ id: "missing-fields" }]), { status: 200 })],
		["authentication failure", new Response("unauthorized", { status: 401 })],
		["authorization failure", new Response("forbidden", { status: 403 })],
		["rate limit", new Response("limited", { status: 429 })],
		["server failure", new Response("failed", { status: 503 })],
	])("fails closed on %s", async (_label, sentryResponse) => {
		const fetchFn = vi.fn().mockResolvedValue(sentryResponse);
		await expect(client(fetchFn).queryRequestIssues(input)).rejects.toBeInstanceOf(
			SentryUnavailableError,
		);
	});

	it("rejects issue links from another origin", async () => {
		const invalid = { ...issue(0), permalink: "https://attacker.example.test/issues/1" };
		const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify([invalid])));
		await expect(client(fetchFn).queryRequestIssues(input)).rejects.toBeInstanceOf(
			SentryUnavailableError,
		);
	});

	it("rejects malformed issue event counts", async () => {
		const invalid = { ...issue(0), count: "3 events" };
		const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify([invalid])));
		await expect(client(fetchFn).queryRequestIssues(input)).rejects.toBeInstanceOf(
			SentryUnavailableError,
		);
	});

	it("maps transport and timeout failures to unavailable", async () => {
		const fetchFn = vi.fn().mockRejectedValue(new DOMException("timed out", "TimeoutError"));
		await expect(client(fetchFn).queryRequestIssues(input)).rejects.toBeInstanceOf(
			SentryUnavailableError,
		);
	});

	it("requires complete environment configuration", () => {
		expect(() => createSentryClientFromEnv({})).toThrow(SentryUnavailableError);
	});

	it("builds the official Trace Explorer redirect URL", () => {
		expect(
			sentryTraceExplorerUrl({ baseUrl: "https://sentry.example.test", orgSlug: "campus" }),
		).toBe("https://sentry.example.test/orgredirect/organizations/campus/traces/");
		expect(
			sentryTraceExplorerUrl({ baseUrl: "http://sentry.example.test", orgSlug: "campus" }),
		).toBeNull();
	});
});
