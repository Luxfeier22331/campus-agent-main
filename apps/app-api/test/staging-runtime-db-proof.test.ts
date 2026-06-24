// @vitest-environment node

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
	type HyperdriveUsageSnapshot,
	main,
	type PostgresProjectionProof,
	type PostgresRuntimeSnapshot,
	parseStagingRuntimeDbProofArgs,
	runStagingRuntimeDbProof,
} from "../scripts/staging-runtime-db-proof";

const beforePostgres: PostgresRuntimeSnapshot = {
	requestExecutionCount: 10,
	requestObservabilityFactCount: 9,
	temporalTaskQueueSnapshotCount: 91_000,
	traceBacklinkProjectionCount: 2,
	workerAutoscalerDecisionCount: 42_000,
};

const afterPostgres: PostgresRuntimeSnapshot = {
	requestExecutionCount: 11,
	requestObservabilityFactCount: 10,
	temporalTaskQueueSnapshotCount: 91_000,
	traceBacklinkProjectionCount: 3,
	workerAutoscalerDecisionCount: 42_000,
};

const beforeHyperdrive: HyperdriveUsageSnapshot = {
	cached: {
		cacheStatusCounts: {},
		configId: "c697741c51ca42eb912cdb3e013728f3",
		eventStatusCounts: {},
		queryCount: 100,
	},
	fresh: {
		cacheStatusCounts: {},
		configId: "bcb527f5de2d4de49b2be59fac991838",
		eventStatusCounts: {},
		queryCount: 20,
	},
	pool: {
		maxCurrentPoolSize: 1,
		maxWaitingClients: 0,
	},
	windowMinutes: 60,
};

const afterHyperdrive: HyperdriveUsageSnapshot = {
	cached: {
		cacheStatusCounts: {},
		configId: "c697741c51ca42eb912cdb3e013728f3",
		eventStatusCounts: {},
		queryCount: 110,
	},
	fresh: {
		cacheStatusCounts: {},
		configId: "bcb527f5de2d4de49b2be59fac991838",
		eventStatusCounts: {},
		queryCount: 21,
	},
	pool: {
		maxCurrentPoolSize: 1,
		maxWaitingClients: 0,
	},
	windowMinutes: 60,
};

function completeProjectionProof(input: {
	traceBacklinkConfigured?: boolean;
	traceBacklinkFound?: boolean;
}): PostgresProjectionProof {
	return {
		observabilityFact: {
			modelExecutionState: "go_provider_synthesis_completed",
			modelName: "gpt-5.5",
			modelProvider: "openai",
			status: "completed",
			traceAvailable: true,
			traceId: "trace_01",
		},
		requestExecution: {
			runId: "run_01",
			status: "completed",
			traceId: "trace_01",
		},
		requestId: "req_01",
		traceBacklink: input.traceBacklinkFound
			? {
					configured: input.traceBacklinkConfigured ?? true,
					found: true,
					traceLink: "https://sentry.example/traces/trace_01",
				}
			: {
					configured: input.traceBacklinkConfigured ?? true,
					found: false,
					traceLink: null,
				},
		traceId: "trace_01",
	};
}

describe("staging runtime db proof runner", () => {
	it("keeps staging profile env projection out of the proof script", () => {
		const source = readFileSync(
			resolve(__dirname, "../scripts/staging-runtime-db-proof.ts"),
			"utf8",
		);

		expect(source).toContain("buildOperatorDatabaseConfig(env)");
		expect(source).not.toContain("STAGING_APP_API_OPERATOR_DATABASE_URL");
		expect(source).not.toContain("STAGING_APP_API_DATABASE_SSLMODE");
	});

	it("rejects relative JSON evidence output paths", () => {
		expect(() => parseStagingRuntimeDbProofArgs(["--output", "var/proof.json"])).toThrow(
			"--output must be an absolute path.",
		);
	});

	it("combines durable chat with Postgres projection and Hyperdrive usage proof", async () => {
		const chatRunner = vi.fn(async () => ({
			conversation: {
				assistantMessageCount: 1,
				hasAssistantMessageForRequest: true,
				id: "conv_01",
				messageCount: 2,
			},
			identity: {
				email: "help_bot@outlook.com",
				resetViaDeployedRuntime: true as const,
			},
			langfuseCloseout: {
				productTraceId: "trace_01",
				requestId: "req_01",
				runId: "run_01",
				sessionId: "conv_01",
				userId: "user_01",
				workflowId: "wf_01",
			},
			passed: true,
			principal: null,
			readyz: {
				appApi: null,
				chat: null,
			},
			resume: {
				afterSequence: 0,
				events: [],
				terminalEvent: null,
			},
			run: {
				conversationId: "conv_01",
				requestId: "req_01",
				runId: "run_01",
				status: "completed",
				traceId: "trace_01",
			},
			session: null,
			sessionMintAttempted: true,
			submit: {
				requestId: "req_01",
				runId: "run_01",
				traceId: "trace_01",
			},
			submitStreamAbortedAfterAccepted: true,
			workflow: {
				attemptCount: 1,
				workflowId: "wf_01",
			},
			workflowTraceSummary: null,
		}));
		let postgresSnapshotCalls = 0;
		let hyperdriveSnapshotCalls = 0;

		const result = await runStagingRuntimeDbProof(
			["--prompt", "链路验证", "--metrics-window-minutes", "60"],
			{
				APP_API_OPERATOR_TRACE_LINK_TEMPLATE: "https://sentry.example/traces/{traceId}",
			} as NodeJS.ProcessEnv,
			{
				collectHyperdriveUsage: async () => {
					hyperdriveSnapshotCalls += 1;
					return hyperdriveSnapshotCalls === 1 ? beforeHyperdrive : afterHyperdrive;
				},
				collectPostgresProjectionProof: async () =>
					completeProjectionProof({
						traceBacklinkConfigured: true,
						traceBacklinkFound: true,
					}),
				collectPostgresSnapshot: async () => {
					postgresSnapshotCalls += 1;
					return postgresSnapshotCalls === 1 ? beforePostgres : afterPostgres;
				},
				runChatDurableE2eStaging: chatRunner,
			},
		);

		expect(result.passed).toBe(true);
		expect(result.checks).toMatchObject({
			chatCompleted: true,
			hyperdriveUsageCollected: true,
			postgresProjectionFound: true,
			traceBacklinkSatisfied: true,
		});
		expect(result.postgres.delta).toMatchObject({
			requestExecutionCount: 1,
			requestObservabilityFactCount: 1,
			temporalTaskQueueSnapshotCount: 0,
			traceBacklinkProjectionCount: 1,
			workerAutoscalerDecisionCount: 0,
		});
		expect(result.hyperdrive.delta).toMatchObject({
			cachedQueryCount: 10,
			freshQueryCount: 1,
		});
		expect(chatRunner).toHaveBeenCalledWith(
			expect.arrayContaining(["--prompt", "链路验证"]),
			expect.any(Object),
		);
	});

	it("writes pure JSON evidence when an output path is provided", async () => {
		const tmpDir = mkdtempSync(resolve(tmpdir(), "runtime-db-proof-"));
		const outputPath = resolve(tmpDir, "proof.json");
		const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
		const previousExitCode = process.exitCode;

		try {
			process.exitCode = undefined;
			await main(["--output", outputPath], {} as NodeJS.ProcessEnv, {
				collectHyperdriveUsage: async () => afterHyperdrive,
				collectPostgresProjectionProof: async () =>
					completeProjectionProof({
						traceBacklinkConfigured: false,
						traceBacklinkFound: false,
					}),
				collectPostgresSnapshot: async () => afterPostgres,
				runChatDurableE2eStaging: async () => ({
					conversation: {
						assistantMessageCount: 1,
						hasAssistantMessageForRequest: true,
						id: "conv_01",
						messageCount: 2,
					},
					identity: {
						email: "help_bot@outlook.com",
						resetViaDeployedRuntime: true as const,
					},
					langfuseCloseout: null,
					passed: true,
					principal: null,
					readyz: {
						appApi: null,
						chat: null,
					},
					resume: {
						afterSequence: 0,
						events: [],
						terminalEvent: null,
					},
					run: {
						conversationId: "conv_01",
						requestId: "req_01",
						runId: "run_01",
						status: "completed",
						traceId: "trace_01",
					},
					session: null,
					sessionMintAttempted: true,
					submit: {
						requestId: "req_01",
						runId: "run_01",
						traceId: "trace_01",
					},
					submitStreamAbortedAfterAccepted: true,
					workflow: null,
					workflowTraceSummary: null,
				}),
			});

			const evidence = JSON.parse(readFileSync(outputPath, "utf8"));

			expect(evidence.passed).toBe(true);
			expect(evidence.checks.chatCompleted).toBe(true);
			expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('"passed": true'));
		} finally {
			process.exitCode = previousExitCode;
			consoleLog.mockRestore();
			rmSync(tmpDir, {
				force: true,
				recursive: true,
			});
		}
	});

	it("does not pass when the request observability projection is missing", async () => {
		const result = await runStagingRuntimeDbProof([], {} as NodeJS.ProcessEnv, {
			collectHyperdriveUsage: async () => beforeHyperdrive,
			collectPostgresProjectionProof: async () => ({
				...completeProjectionProof({
					traceBacklinkConfigured: false,
					traceBacklinkFound: false,
				}),
				observabilityFact: null,
			}),
			collectPostgresSnapshot: async () => beforePostgres,
			runChatDurableE2eStaging: async () => ({
				conversation: null,
				identity: {
					email: "help_bot@outlook.com",
					resetViaDeployedRuntime: true as const,
				},
				langfuseCloseout: null,
				passed: true,
				principal: null,
				readyz: {
					appApi: null,
					chat: null,
				},
				resume: {
					afterSequence: 0,
					events: [],
					terminalEvent: null,
				},
				run: {
					conversationId: "conv_01",
					requestId: "req_01",
					runId: "run_01",
					status: "completed",
					traceId: "trace_01",
				},
				session: null,
				sessionMintAttempted: true,
				submit: {
					requestId: "req_01",
					runId: "run_01",
					traceId: "trace_01",
				},
				submitStreamAbortedAfterAccepted: true,
				workflow: null,
				workflowTraceSummary: null,
			}),
		});

		expect(result.passed).toBe(false);
		expect(result.checks.postgresProjectionFound).toBe(false);
	});
});
