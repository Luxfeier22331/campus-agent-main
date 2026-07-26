import type { Breadcrumb, CloudflareOptions, ErrorEvent } from "@sentry/cloudflare";
import { describe, expect, it } from "vitest";

import {
	normalizeCampusTelemetryRoute,
	sanitizeCampusBreadcrumb,
	sanitizeCampusSentryEvent,
	sanitizeCampusSentrySpan,
} from "../src/platform/telemetry/sentry-scrub";

type SentrySpan = Parameters<NonNullable<CloudflareOptions["beforeSendSpan"]>>[0];

describe("campus Sentry privacy boundary", () => {
	it("normalizes conversation and API identifiers without retaining queries", () => {
		expect(
			normalizeCampusTelemetryRoute("https://campus.muc.wiki/c/conv_secret?token=secret"),
		).toBe("/c/:conversationId");
		expect(
			normalizeCampusTelemetryRoute(
				"https://campus.muc.wiki/api/chat/conversations/conv_secret/messages/msg_secret/feedback?code=secret",
			),
		).toBe("/api/chat/conversations/:conversationId/messages/:messageId/feedback");
		expect(normalizeCampusTelemetryRoute("https://campus.muc.wiki/student@example.edu")).toBe(
			"/<unmatched>",
		);
		expect(normalizeCampusTelemetryRoute("https://campus.muc.wiki/groups?source=nav")).toBe(
			"/groups",
		);
	});

	it("drops browser request content, user identity and unsafe tags", () => {
		const event = sanitizeCampusSentryEvent({
			exception: { values: [{ type: "ProviderError", value: "private prompt from student" }] },
			extra: { prompt: "private" },
			request: {
				cookies: { session: "secret" },
				data: { prompt: "private" },
				headers: { authorization: "Bearer secret" },
				method: "POST",
				query_string: "token=secret",
				url: "https://campus.muc.wiki/api/chat/runs/run_secret/cancel?token=secret",
			},
			tags: {
				app: "campus-web",
				"campus.request_id": "req_secret",
				"campus.trace_id": "trace_secret",
				message_id: "msg_secret",
				surface: "campus-web",
			},
			type: undefined,
			user: { email: "student@example.edu", id: "user_secret" },
		} satisfies ErrorEvent);

		expect(event.request).toEqual({ method: "POST", url: "/api/chat/runs/:runId/cancel" });
		expect(event.extra).toBeUndefined();
		expect(event.user).toBeUndefined();
		expect(event.tags).toEqual({
			app: "campus-web",
			"campus.request_id": "req_secret",
			"campus.trace_id": "trace_secret",
			surface: "campus-web",
		});
		expect(event.exception?.values?.[0]?.value).toBe("ProviderError");
	});

	it("removes private request context and unapproved tags", () => {
		const rawSentinels = [
			"query-sentinel-0001",
			"header-sentinel-0001",
			"body-sentinel-0001",
			"user-sentinel-0001",
			"credential-sentinel-0001",
		];
		const event = sanitizeCampusSentryEvent({
			exception: { values: [{ type: "ProviderError", value: rawSentinels[2] }] },
			extra: { synthetic_sentinels: rawSentinels },
			request: {
				data: { body: rawSentinels[2] },
				headers: {
					authorization: `Synthetic ${rawSentinels[4]}`,
					"x-private-header": rawSentinels[1],
				},
				method: "POST",
				query_string: `query=${rawSentinels[0]}`,
				url: `/api/chat/runs/run_private/cancel?token=${rawSentinels[0]}`,
			},
			tags: {
				correlation_hash: "a".repeat(64),
				raw_sentinel: rawSentinels[0],
			},
			type: undefined,
			user: { id: rawSentinels[3] },
		} satisfies ErrorEvent);

		expect(event.request).toEqual({
			method: "POST",
			url: "/api/chat/runs/:runId/cancel",
		});
		expect(event.tags).toEqual({});
		const serialized = JSON.stringify(event);
		for (const sentinel of rawSentinels) {
			expect(serialized).not.toContain(sentinel);
		}
	});

	it("keeps only route, method and status on spans and breadcrumbs", () => {
		const span = sanitizeCampusSentrySpan({
			data: {
				"http.request.body.data": "private",
				"http.request.method": "GET",
				"http.response.status_code": 200,
				"url.full": "https://campus.muc.wiki/c/conv_secret?token=secret",
			},
			description: "GET https://campus.muc.wiki/c/conv_secret?token=secret",
			span_id: "0123456789abcdef",
			start_timestamp: 1,
			trace_id: "0123456789abcdef0123456789abcdef",
		} satisfies SentrySpan);
		const breadcrumb = sanitizeCampusBreadcrumb({
			category: "fetch",
			data: {
				method: "GET",
				request_body: "private",
				status_code: 200,
				url: "https://campus.muc.wiki/c/conv_secret?token=secret",
			},
			message: "conv_secret",
		} satisfies Breadcrumb);

		expect(span.data).toEqual({
			"http.request.method": "GET",
			"http.response.status_code": 200,
			"http.route": "/c/:conversationId",
		});
		expect(breadcrumb).toEqual({
			category: "fetch",
			data: { method: "GET", status_code: 200, url: "/c/:conversationId" },
			level: undefined,
			timestamp: undefined,
			type: undefined,
		});
	});
});
