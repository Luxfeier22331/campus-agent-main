// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import type { WeChatOfficialAccountCommandService } from "../src/modules/wechat-official-account-command";

const env = {
	APP_API_NAME: "campus-agent-app-api",
	APP_API_ENVIRONMENT: "test" as const,
	APP_API_WECHAT_OFFICIAL_ACCOUNT_COLLECTOR_TOKEN: "trusted-wechat-token",
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
	PUBLIC_CHAT_WEB_ORIGIN: "https://chat.example.com",
	EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
	EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
	APP_API_DB: {
		connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
	},
};

describe("wechat official-account collector routes", () => {
	it("creates a capture run through the collector command route", async () => {
		const service: WeChatOfficialAccountCommandService = {
			finalize: vi.fn(),
			getRun: vi.fn(),
			heartbeat: vi.fn(),
			listRuns: vi.fn(),
			start: vi.fn().mockResolvedValue({
				run: {
					accountSlug: "zhong_yang_min_zu_da_xue_xue_sheng_hui",
					provider: "feedwe",
					runId: "wcrun_01JQ",
					sourceChannel: "wechat_official_account",
					startedAt: "2026-04-27T08:00:00.000Z",
					status: "accepted",
				},
			}),
		};
		const app = createApp(env, {
			wechatOfficialAccountCommandService: service,
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/wechat-official-account/runs", {
				body: JSON.stringify({
					accountName: "中央民族大学学生会",
					accountSlug: "zhong_yang_min_zu_da_xue_xue_sheng_hui",
					collectorVersion: "wechat-official-account-collector@0.1.0",
					provider: "feedwe",
					providerBaseUrl: "https://feedwe.cloud",
					requestSummary: {
						maxArticles: 20,
						maxPages: 2,
						pageSize: 10,
					},
					schedulerRunKey: "manual-2026-04-27T08:00:00.000Z",
					startedAt: "2026-04-27T08:00:00.000Z",
					triggerType: "manual",
				}),
				headers: {
					authorization: "Bearer trusted-wechat-token",
					"content-type": "application/json",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(200);
		expect(service.start).toHaveBeenCalledWith({
			payload: expect.objectContaining({
				accountName: "中央民族大学学生会",
				provider: "feedwe",
			}),
			principal: {
				kind: "service",
				serviceClass: "wechat_official_account_collector",
				serviceId: "wechat-official-account-collector",
			},
		});
		await expect(response.json()).resolves.toEqual({
			run: {
				accountSlug: "zhong_yang_min_zu_da_xue_xue_sheng_hui",
				provider: "feedwe",
				runId: "wcrun_01JQ",
				sourceChannel: "wechat_official_account",
				startedAt: "2026-04-27T08:00:00.000Z",
				status: "accepted",
			},
		});
	});

	it("fails closed when the collector credential is missing", async () => {
		const service: WeChatOfficialAccountCommandService = {
			finalize: vi.fn(),
			getRun: vi.fn(),
			heartbeat: vi.fn(),
			listRuns: vi.fn(),
			start: vi.fn(),
		};
		const app = createApp(env, {
			wechatOfficialAccountCommandService: service,
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/wechat-official-account/runs", {
				body: JSON.stringify({
					accountName: "中央民族大学学生会",
				}),
				headers: {
					"content-type": "application/json",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(401);
		expect(service.start).not.toHaveBeenCalled();
	});

	it("exposes operator-visible run status without opening query-serving", async () => {
		const service: WeChatOfficialAccountCommandService = {
			finalize: vi.fn(),
			getRun: vi.fn(),
			heartbeat: vi.fn(),
			listRuns: vi.fn().mockResolvedValue({
				runs: [
					{
						accountName: "中央民族大学学生会",
						accountSlug: "zhong_yang_min_zu_da_xue_xue_sheng_hui",
						artifactCount: 2,
						finishedAt: "2026-04-27T08:01:00.000Z",
						provider: "feedwe",
						runId: "wcrun_01JQ",
						sourceChannel: "wechat_official_account",
						startedAt: "2026-04-27T08:00:00.000Z",
						status: "completed",
						summary: {
							artifactUploads: 2,
							articlesSeen: 1,
							failures: 0,
							pagesFetched: 1,
						},
					},
				],
			}),
			start: vi.fn(),
		};
		const app = createApp(env, {
			getPrincipal: vi.fn().mockResolvedValue({
				actor: {
					departments: [],
					principalId: "operator@example.edu",
					principalType: "operator",
					roles: ["operator"],
					userId: "operator@example.edu",
				},
				permissions: {
					chat: false,
					operator: true,
				},
				principal: {
					displayName: "Operator",
					email: "operator@example.edu",
					principalId: "operator@example.edu",
					type: "operator",
				},
				session: null,
			}),
			wechatOfficialAccountCommandService: service,
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/operator/wechat-official-account/runs", {
				method: "GET",
			}),
		);

		expect(response.status).toBe(200);
		expect(service.listRuns).toHaveBeenCalled();
		await expect(response.json()).resolves.toEqual({
			runs: [
				expect.objectContaining({
					runId: "wcrun_01JQ",
					sourceChannel: "wechat_official_account",
					status: "completed",
				}),
			],
		});
	});

	it("exposes operator-visible artifact refs without provider bytes", async () => {
		const service: WeChatOfficialAccountCommandService = {
			finalize: vi.fn(),
			getRun: vi.fn().mockResolvedValue({
				accountName: "中央民族大学学生会",
				accountSlug: "zhong_yang_min_zu_da_xue_xue_sheng_hui",
				artifacts: [
					{
						artifactType: "source_truth_article_manifest",
						byteSize: 1024,
						contentSha256: "d".repeat(64),
						objectKey:
							"wechat_official_account/zhong_yang_min_zu_da_xue_xue_sheng_hui/2026/woa_ver_1234567890abcdef12345678/source-truth/article-manifest.json",
						recordCount: 1,
					},
				],
				collectorVersion: "wechat-official-account-collector@0.1.0",
				finishedAt: "2026-04-27T08:01:00.000Z",
				lastHeartbeatAt: null,
				latestHeartbeatSequence: 0,
				provider: "feedwe",
				providerBaseUrl: "https://feedwe.cloud",
				requestSummary: {},
				runId: "wcrun_01JQ",
				schedulerRunKey: "manual-2026-04-27T08:00:00.000Z",
				sourceChannel: "wechat_official_account",
				startFingerprintSha256: "fingerprint",
				startedAt: "2026-04-27T08:00:00.000Z",
				status: "completed",
				summary: {
					artifactUploads: 5,
					articlesMaterialized: 1,
					articlesSeen: 1,
					failures: 0,
					pagesFetched: 1,
					sourceTruthArtifacts: 3,
				},
				terminalErrorCode: null,
				terminalErrorMessage: null,
				terminalPayloadSha256: "terminal-fingerprint",
				triggerType: "manual",
			}),
			heartbeat: vi.fn(),
			listRuns: vi.fn(),
			start: vi.fn(),
		};
		const app = createApp(env, {
			getPrincipal: vi.fn().mockResolvedValue({
				actor: {
					departments: [],
					principalId: "operator@example.edu",
					principalType: "operator",
					roles: ["operator"],
					userId: "operator@example.edu",
				},
				permissions: {
					chat: false,
					operator: true,
				},
				principal: {
					displayName: "Operator",
					email: "operator@example.edu",
					principalId: "operator@example.edu",
					type: "operator",
				},
				session: null,
			}),
			wechatOfficialAccountCommandService: service,
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/operator/wechat-official-account/runs/wcrun_01JQ", {
				method: "GET",
			}),
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body).toEqual({
			run: expect.objectContaining({
				artifacts: [
					expect.objectContaining({
						artifactType: "source_truth_article_manifest",
						objectKey: expect.stringContaining("/source-truth/article-manifest.json"),
					}),
				],
				runId: "wcrun_01JQ",
			}),
		});
		expect(JSON.stringify(body)).not.toContain("2026 春季通知");
		expect(JSON.stringify(body)).not.toContain("mp.weixin.qq.com");
	});
});
