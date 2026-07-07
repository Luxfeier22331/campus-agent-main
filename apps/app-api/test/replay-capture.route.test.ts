// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";

const env = {
	APP_API_NAME: "campus-agent-app-api",
	APP_API_ENVIRONMENT: "test" as const,
	APP_API_INTERNAL_SHARED_SECRET: "trusted-secret",
	APP_API_OPERATOR_EMAIL_ALLOWLIST: "ops@example.com",
	APP_API_OPERATOR_SERVICE_ID_ALLOWLIST: "operator-console-staging-smoke",
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
	EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
	EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
	APP_API_DB: {
		connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
	},
};

describe("replay capture internal lifecycle routes", () => {
	it("reads replay packet safe index metadata through the existing internal seam", async () => {
		const replayCaptureService = {
			getReplayPacketIndex: vi.fn().mockResolvedValue({
				packet: {
					objectRef: "s3://llm-replay/llm-replay-packets/2026/07/05/llm_replay_packet_rag_01.json",
					packetId: "llm_replay_packet_rag_01",
					requestId: "req_rag_01",
				},
			}),
			ingestReplayPacketIndex: vi.fn(),
		};
		const app = createApp(env as never, {
			replayCaptureService: replayCaptureService as never,
		});

		const response = await app.fetch(
			new Request(
				"https://app-api.internal/api/internal/observability/replay-packet-index?action=export",
				{
					body: JSON.stringify({
						approval_ref: "approval_rag_01",
						packet_id: "llm_replay_packet_rag_01",
						purpose: "badcase_diagnosis",
					}),
					headers: {
						"content-type": "application/json",
						"x-app-internal-auth": "trusted-secret",
						"x-app-operator-email": "ops@example.com",
					},
					method: "POST",
				},
			),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			packet: {
				objectRef: "s3://llm-replay/llm-replay-packets/2026/07/05/llm_replay_packet_rag_01.json",
				packetId: "llm_replay_packet_rag_01",
				requestId: "req_rag_01",
			},
		});
		expect(replayCaptureService.getReplayPacketIndex).toHaveBeenCalledWith({
			accessKind: "export",
			actorPrincipal: "ops@example.com",
			approvalRef: "approval_rag_01",
			packetId: "llm_replay_packet_rag_01",
			purpose: "badcase_diagnosis",
		});
	});

	it("fails closed for replay packet reads without an admitted operator principal", async () => {
		const replayCaptureService = {
			getReplayPacketIndex: vi.fn(),
			ingestReplayPacketIndex: vi.fn(),
		};
		const app = createApp(env as never, {
			replayCaptureService: replayCaptureService as never,
		});

		const response = await app.fetch(
			new Request(
				"https://app-api.internal/api/internal/observability/replay-packet-index?action=read",
				{
					body: JSON.stringify({
						packet_id: "llm_replay_packet_rag_01",
						purpose: "badcase_diagnosis",
					}),
					headers: {
						"content-type": "application/json",
						"x-app-internal-auth": "trusted-secret",
					},
					method: "POST",
				},
			),
		);

		expect(response.status).toBe(403);
		expect(replayCaptureService.getReplayPacketIndex).not.toHaveBeenCalled();
	});

	it("deletes replay packet index metadata by DSAR linkage through the internal seam", async () => {
		const replayCaptureService = {
			deleteReplayPacketsByLinkage: vi.fn().mockResolvedValue({
				deletedPacketIds: ["llm_replay_packet_rag_01"],
				matchedCount: 1,
				mode: "mark_deleted",
			}),
			ingestReplayPacketIndex: vi.fn(),
		};
		const app = createApp(env as never, {
			replayCaptureService: replayCaptureService as never,
		});

		const response = await app.fetch(
			new Request(
				"https://app-api.internal/api/internal/observability/replay-packet-index?action=delete",
				{
					body: JSON.stringify({
						approval_ref: "approval_rag_01",
						mode: "mark_deleted",
						purpose: "dsar_delete",
						request_id: "req_rag_01",
						subject_ref: "user_hash_01",
					}),
					headers: {
						"content-type": "application/json",
						"x-app-internal-auth": "trusted-secret",
						"x-app-operator-id": "operator-console-staging-smoke",
						"x-app-operator-service-id": "operator-console-staging-smoke",
					},
					method: "POST",
				},
			),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			deletedPacketIds: ["llm_replay_packet_rag_01"],
			matchedCount: 1,
			mode: "mark_deleted",
		});
		expect(replayCaptureService.deleteReplayPacketsByLinkage).toHaveBeenCalledWith({
			actorPrincipal: "operator-console-staging-smoke",
			approvalRef: "approval_rag_01",
			mode: "mark_deleted",
			purpose: "dsar_delete",
			requestId: "req_rag_01",
			subjectRef: "user_hash_01",
			traceId: undefined,
		});
	});

	it("fails closed for hard_delete until object-store deletion is implemented", async () => {
		const replayCaptureService = {
			deleteReplayPacketsByLinkage: vi.fn(),
			ingestReplayPacketIndex: vi.fn(),
		};
		const app = createApp(env as never, {
			replayCaptureService: replayCaptureService as never,
		});

		const response = await app.fetch(
			new Request(
				"https://app-api.internal/api/internal/observability/replay-packet-index?action=delete",
				{
					body: JSON.stringify({
						actor_principal: "privacy-ops:user_01",
						mode: "hard_delete",
						purpose: "dsar_delete",
						request_id: "req_rag_01",
					}),
					headers: {
						"content-type": "application/json",
						"x-app-internal-auth": "trusted-secret",
					},
					method: "POST",
				},
			),
		);

		expect(response.status).toBe(409);
		await expect(response.json()).resolves.toMatchObject({
			error: {
				code: "replay_packet_hard_delete_not_configured",
			},
		});
		expect(replayCaptureService.deleteReplayPacketsByLinkage).not.toHaveBeenCalled();
	});

	it("rejects unknown replay packet delete modes instead of defaulting", async () => {
		const replayCaptureService = {
			deleteReplayPacketsByLinkage: vi.fn(),
			ingestReplayPacketIndex: vi.fn(),
		};
		const app = createApp(env as never, {
			replayCaptureService: replayCaptureService as never,
		});

		const response = await app.fetch(
			new Request(
				"https://app-api.internal/api/internal/observability/replay-packet-index?action=delete",
				{
					body: JSON.stringify({
						actor_principal: "privacy-ops:user_01",
						mode: "silent_delete",
						purpose: "dsar_delete",
						request_id: "req_rag_01",
					}),
					headers: {
						"content-type": "application/json",
						"x-app-internal-auth": "trusted-secret",
					},
					method: "POST",
				},
			),
		);

		expect(response.status).toBe(422);
		await expect(response.json()).resolves.toMatchObject({
			error: {
				code: "validation_failed",
			},
		});
		expect(replayCaptureService.deleteReplayPacketsByLinkage).not.toHaveBeenCalled();
	});
});
