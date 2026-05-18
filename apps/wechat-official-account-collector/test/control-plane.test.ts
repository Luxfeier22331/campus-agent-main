import { describe, expect, it, vi } from "vitest";

import {
	createWeChatOfficialAccountControlPlaneClient,
	WeChatOfficialAccountControlPlaneTransportError,
} from "../src/control-plane.ts";

function startRunInput() {
	return {
		accountName: "中央民族大学学生会",
		accountSlug: "muc-student-union",
		collectorVersion: "wechat-official-account-collector@0.1.0",
		providerBaseUrl: "https://feedwe.example.com",
		requestSummary: {
			limit: 10,
		},
		schedulerRunKey: "cron-2026-03-29T08:00:00Z",
		startedAt: "2026-03-29T08:00:01.000Z",
		triggerType: "scheduled",
	};
}

describe("wechat official-account control plane client", () => {
	it("raises typed transport errors for complete non-200 error envelopes", async () => {
		const client = createWeChatOfficialAccountControlPlaneClient(
			{
				appApiBaseUrl: "https://app-api.internal",
				serviceToken: "service-token",
			},
			{
				fetchImplementation: vi.fn().mockResolvedValue(
					new Response(
						JSON.stringify({
							error: {
								code: "idempotency_conflict",
								message: "Payload fingerprint differs.",
								retryable: false,
							},
						}),
						{ status: 409 },
					),
				),
			},
		);

		const error = await client.startRun(startRunInput()).catch((error: unknown) => error);

		expect(error).toBeInstanceOf(WeChatOfficialAccountControlPlaneTransportError);
		expect(error).toMatchObject({
			code: "idempotency_conflict",
			retryable: false,
			status: 409,
		});
	});

	it("fails closed when control-plane returns a non-JSON error payload", async () => {
		const client = createWeChatOfficialAccountControlPlaneClient(
			{
				appApiBaseUrl: "https://app-api.internal",
				serviceToken: "service-token",
			},
			{
				fetchImplementation: vi.fn().mockResolvedValue(
					new Response("<html>bad gateway</html>", {
						headers: {
							"content-type": "text/html; charset=utf-8",
						},
						status: 502,
					}),
				),
			},
		);

		await expect(client.startRun(startRunInput())).rejects.toMatchObject({
			code: "app_api_invalid_json",
			status: 502,
		});
	});

	it("fails closed when control-plane error payload misses typed fields", async () => {
		const client = createWeChatOfficialAccountControlPlaneClient(
			{
				appApiBaseUrl: "https://app-api.internal",
				serviceToken: "service-token",
			},
			{
				fetchImplementation: vi.fn().mockResolvedValue(
					new Response(
						JSON.stringify({
							error: {
								message: "Payload fingerprint differs.",
							},
						}),
						{ status: 409 },
					),
				),
			},
		);

		await expect(client.startRun(startRunInput())).rejects.toMatchObject({
			code: "app_api_invalid_error_envelope",
			retryable: false,
			status: 409,
		});
	});

	it("fails closed when control-plane returns a non-JSON success payload", async () => {
		const client = createWeChatOfficialAccountControlPlaneClient(
			{
				appApiBaseUrl: "https://app-api.internal",
				serviceToken: "service-token",
			},
			{
				fetchImplementation: vi.fn().mockResolvedValue(
					new Response("ok", {
						headers: {
							"content-type": "text/plain; charset=utf-8",
						},
						status: 200,
					}),
				),
			},
		);

		await expect(client.startRun(startRunInput())).rejects.toMatchObject({
			code: "app_api_invalid_json",
			status: 200,
		});
	});
});
