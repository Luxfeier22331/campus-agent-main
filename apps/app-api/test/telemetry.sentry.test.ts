// @vitest-environment node

import type { CloudflareOptions, ErrorEvent } from "@sentry/cloudflare";
import { describe, expect, it } from "vitest";

import {
	normalizeAppApiRoute,
	sanitizeAppApiSentryEvent,
	sanitizeAppApiSentrySpan,
} from "../src/modules/telemetry/sentry";

type SentrySpan = Parameters<NonNullable<CloudflareOptions["beforeSendSpan"]>>[0];

describe("app-api Sentry privacy boundary", () => {
	it("normalizes product identifiers and removes query values", () => {
		expect(
			normalizeAppApiRoute(
				"https://app-api.internal/api/chat/conversations/conv_secret/messages/msg_secret/feedback?token=secret",
				"PUT",
			),
		).toBe("/api/chat/conversations/:conversationId/messages/:messageId/feedback");
		expect(normalizeAppApiRoute("https://app-api.internal/student@example.edu")).toBe(
			"/<unmatched>",
		);
	});

	it("retains only the bounded request and tag fields on errors", () => {
		const event = sanitizeAppApiSentryEvent({
			breadcrumbs: [{ data: { url: "https://example.com/?token=secret" }, message: "conv_secret" }],
			exception: { values: [{ type: "ProviderError", value: "private prompt from student" }] },
			extra: { prompt: "private" },
			request: {
				cookies: { session: "secret" },
				data: { prompt: "private" },
				headers: { authorization: "Bearer secret" },
				method: "GET",
				query_string: "token=secret",
				url: "https://app-api.internal/api/chat/requests/req_secret?token=secret",
			},
			tags: {
				app: "app-api",
				"campus.request_id": "req_secret",
				surface: "app_api",
			},
			type: undefined,
			user: { email: "student@example.edu", id: "user_secret", ip_address: "127.0.0.1" },
		} satisfies ErrorEvent);

		expect(event.request).toEqual({ method: "GET", url: "/api/chat/requests/:requestId" });
		expect(event.breadcrumbs).toEqual([]);
		expect(event.extra).toBeUndefined();
		expect(event.user).toBeUndefined();
		expect(event.tags).toEqual({
			app: "app-api",
			"campus.request_id": "req_secret",
			surface: "app_api",
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
		] as const;
		const event = sanitizeAppApiSentryEvent({
			exception: { values: [{ type: "ProviderError", value: rawSentinels[2] }] },
			extra: { synthetic_sentinels: rawSentinels },
			request: {
				data: { body: rawSentinels[2] },
				headers: {
					authorization: `Synthetic ${rawSentinels[4]}`,
					"x-private-header": rawSentinels[1],
				},
				method: "GET",
				query_string: `query=${rawSentinels[0]}`,
				url: `/api/chat/requests/req_private?token=${rawSentinels[0]}`,
			},
			tags: {
				correlation_hash: "a".repeat(64),
				raw_sentinel: rawSentinels[0],
			},
			type: undefined,
			user: { id: rawSentinels[3] },
		} satisfies ErrorEvent);

		expect(event.request).toEqual({
			method: "GET",
			url: "/api/chat/requests/:requestId",
		});
		expect(event.tags).toEqual({});
		const serialized = JSON.stringify(event);
		for (const sentinel of rawSentinels) {
			expect(serialized).not.toContain(sentinel);
		}
	});

	it("removes URL, header and identifier attributes from spans", () => {
		const span = sanitizeAppApiSentrySpan({
			data: {
				"http.request.header.authorization": "Bearer secret",
				"http.request.method": "GET",
				"url.full": "https://app-api.internal/api/chat/requests/req_secret?token=secret",
			},
			description: "GET https://app-api.internal/api/chat/requests/req_secret?token=secret",
			span_id: "0123456789abcdef",
			start_timestamp: 1,
			trace_id: "0123456789abcdef0123456789abcdef",
		} satisfies SentrySpan);

		expect(span.description).toBe("GET /api/chat/requests/:requestId");
		expect(span.data).toEqual({
			"http.request.method": "GET",
			"http.route": "/api/chat/requests/:requestId",
		});
	});
});
