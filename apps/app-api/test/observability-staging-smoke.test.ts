// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { runObservabilityStaging } from "../../../scripts/smoke/observability-staging";
import { hashCanonicalSentryCanarySentinels } from "../../campus-web/src/platform/telemetry/sentry-canary";

const sentinels = {
	body: "body-sentinel-0001",
	credential: "credential-sentinel-0001",
	header: "header-sentinel-0001",
	query: "query-sentinel-0001",
	user: "user-sentinel-0001",
};

function valueAfter(argv: string[], flag: string): string | undefined {
	const index = argv.indexOf(flag);
	return index >= 0 ? argv[index + 1] : undefined;
}

describe("staging observability smoke orchestration", () => {
	it("uses one sentinel set for chat memory and all three Sentry events", async () => {
		const sentinelSha256 = await hashCanonicalSentryCanarySentinels(sentinels);
		const actions: string[] = [];
		let chatArgv: string[] = [];
		let sentryInput: {
			productRequestId: string;
			runtimeTraceId: string;
			sentinels: typeof sentinels;
		} | null = null;
		let writtenSecret = "";
		const timestamps = [new Date("2026-07-17T00:00:00.000Z"), new Date("2026-07-17T00:05:00.000Z")];
		const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

		try {
			const evidence = await runObservabilityStaging(
				[
					"--app-api-readyz-url",
					"https://api.example.com/readyz",
					"--chat-base-url",
					"https://campus.example.com/chat",
					"--campus-base-url",
					"https://campus.example.com/sentry",
					"--evidence-path",
					"var/test-observability-evidence.json",
				],
				{ APP_API_STAGING_SMOKE_AUTH_SECRET: "real-smoke-secret" } as NodeJS.ProcessEnv,
				{
					createSentinels: () => sentinels,
					now: () => timestamps.shift() ?? new Date("2026-07-17T00:05:00.000Z"),
					async removeEvidence() {
						actions.push("remove");
					},
					async runChatMemory(argv) {
						actions.push("chat");
						chatArgv = argv;
						return {
							identity: { email: "help_bot@outlook.com", resetViaDeployedRuntime: true },
							memory: { deleted: true, itemId: "mem_01", key: "smoke_memory_probe" },
							passed: true,
							principal: { principalId: "user_01" },
							readyz: {
								appApi: { payload: { ok: true }, status: 200 },
								chat: { payload: { ok: true }, status: 200 },
							},
							recall: {
								memoryRef: "projection://memory/01",
								selectedMemoryCount: 1,
								status: "completed",
								stepId: "memory.recall",
							},
							session: { sessionId: "session_01" },
							sessionMintAttempted: true,
							submit: {
								requestId: "req_observability_01",
								resultKind: "answer",
								runId: "run_01",
								runtimeTraceId: "a".repeat(32),
								traceId: "trace_product_01",
							},
						};
					},
					async runSentryCanary(_args, input) {
						actions.push("sentry");
						sentryInput = input;
						return {
							appApiEventId: "1".repeat(32),
							appApiRelease: `app-api@${"a".repeat(40)}`,
							browserEventId: "3".repeat(32),
							campusWebRelease: `campus-web@${"b".repeat(40)}`,
							edgeEventId: "2".repeat(32),
							sentinelSha256,
						};
					},
					async writeEvidence(_path, _evidence, smokeAuthSecret) {
						actions.push("write");
						writtenSecret = smokeAuthSecret;
					},
				},
			);

			expect(actions).toEqual(["remove", "chat", "sentry", "write"]);
			expect(valueAfter(chatArgv, "--memory-value")).toBe(sentinels.body);
			expect(valueAfter(chatArgv, "--name")).toBe(sentinels.user);
			expect(valueAfter(chatArgv, "--observability-canary-header-sentinel")).toBe(sentinels.header);
			expect(valueAfter(chatArgv, "--observability-canary-api-key-sentinel")).toBe(
				sentinels.credential,
			);
			expect(valueAfter(chatArgv, "--prompt")).toContain(sentinels.query);
			expect(valueAfter(chatArgv, "--app-api-readyz-url")).toBe("https://api.example.com/readyz");
			expect(valueAfter(chatArgv, "--chat-base-url")).toBe("https://campus.example.com");
			expect(sentryInput).toEqual({
				productRequestId: "req_observability_01",
				runtimeTraceId: "a".repeat(32),
				sentinels,
			});
			expect(evidence).toMatchObject({
				canaryWindow: {
					completedAt: "2026-07-17T00:05:00.000Z",
					startedAt: "2026-07-17T00:00:00.000Z",
				},
				eventIds: {
					appApi: "1".repeat(32),
					campusWebBrowser: "3".repeat(32),
					campusWebEdge: "2".repeat(32),
				},
				requestId: "req_observability_01",
				runtimeTraceId: "a".repeat(32),
				sentinelSha256,
				sentinels,
			});
			expect(JSON.stringify(evidence)).not.toContain("real-smoke-secret");
			expect(writtenSecret).toBe("real-smoke-secret");
		} finally {
			info.mockRestore();
		}
	});
});
