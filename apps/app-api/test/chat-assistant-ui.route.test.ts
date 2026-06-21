// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";

const env = {
	APP_API_NAME: "campus-agent-app-api",
	APP_API_ENVIRONMENT: "test" as const,
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
	APP_API_DB: {
		connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
	},
};

function createCampusPrincipal() {
	return {
		actor: {
			departments: [],
			principalId: "user_01HQ",
			principalType: "campus_member",
			roles: ["campus_member"],
			userId: "user_01HQ",
		},
		permissions: {
			chat: true,
			operator: false,
		},
		principal: {
			displayName: "Jane Doe",
			email: "jane@example.edu",
			principalId: "user_01HQ",
			type: "campus_member" as const,
		},
		session: {
			expiresAt: "2026-03-29T07:00:00.000Z",
			sessionId: "sess_01HQ",
		},
	};
}

describe("assistant-ui chat route", () => {
	it("streams a completed assistant-ui response from the existing chat command service", async () => {
		const submitStream = vi.fn().mockReturnValue(
			(async function* () {
				yield {
					data: {
						answer: {
							conversation: {
								archivedAt: null,
								createdAt: "2026-06-21T01:00:00.000Z",
								id: "conv_01HQ",
								messages: [
									{
										conversationId: "conv_01HQ",
										createdAt: "2026-06-21T01:00:02.000Z",
										id: "msg_assistant",
										kind: "answer",
										requestId: "req_01HQ",
										retryable: false,
										role: "assistant",
										structuredParts: [
											{
												sourceItems: [],
												type: "source_items",
											},
										],
										text: "国家奖学金每学年评审一次。",
									},
								],
								pinnedAt: null,
								title: "国家奖学金",
								updatedAt: "2026-06-21T01:00:02.000Z",
							},
							result: {
								kind: "answer",
								requestId: "req_01HQ",
								text: "国家奖学金每学年评审一次。",
								traceId: "trace_01HQ",
							},
						},
						occurredAt: "2026-06-21T01:00:02.000Z",
						requestId: "req_01HQ",
						runId: "run_01HQ",
						status: "completed",
						traceId: "trace_01HQ",
					},
					event: "request.completed",
				};
			})(),
		);
		const app = createApp(env, {
			chatCommandService: {
				submit: vi.fn(),
				submitStream,
			},
			getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/chat/assistant-ui", {
				body: JSON.stringify({
					messages: [
						{
							content: [{ text: "国家奖学金什么时候评审？", type: "text" }],
							role: "user",
						},
					],
					threadId: "conv_01HQ",
				}),
				headers: {
					"content-type": "application/json",
					"idempotency-key": "idem_01HQ",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text");
		const body = await response.text();
		expect(body).toContain("国家奖学金每学年评审一次。");
		expect(body).toContain(
			`aui-data:{"data":{"sourceItems":[],"type":"source_items"},"name":"source_items"}`,
		);
		expect(response.headers.get("x-request-id")).toBe("req_01HQ");
		expect(response.headers.get("x-trace-id")).toBe("trace_01HQ");
		expect(submitStream).toHaveBeenCalledWith(
			expect.objectContaining({
				idempotencyKey: "idem_01HQ",
				payload: {
					conversationId: "conv_01HQ",
					prompt: "国家奖学金什么时候评审？",
				},
				surface: "campus_web",
			}),
		);
	});
});
