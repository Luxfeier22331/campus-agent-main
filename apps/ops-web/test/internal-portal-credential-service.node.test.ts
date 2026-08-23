import {
	PortalCredentialExpiredError,
	PortalSessionExpiredError,
} from "@campus-agent/internal-portal-client";
import { describe, expect, it, vi } from "vitest";
import {
	createInternalPortalCredentialService,
	InternalPortalCandidateRejectedError,
	InternalPortalCredentialResolutionUnavailableError,
	runScheduledInternalPortalChecks,
} from "../src/server/internal-portal-credential-service.ts";
import {
	InternalPortalCredentialConflictError,
	type InternalPortalCredentialRecord,
	type InternalPortalCredentialStore,
} from "../src/server/internal-portal-credential-store.ts";

const FIRST_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_ID = "22222222-2222-4222-8222-222222222222";

function credential(
	credentialId = FIRST_ID,
	ssoTgc = "TGT-current",
): InternalPortalCredentialRecord {
	return {
		createdAt: "2026-08-02T01:00:00.000Z",
		credentialId,
		lastAttemptAt: "2026-08-02T01:00:00.000Z",
		lastOutcome: "valid",
		lastSuccessfulAt: "2026-08-02T01:00:00.000Z",
		name: credentialId === FIRST_ID ? "第一条" : "第二条",
		ssoTgc,
		updatedAt: "2026-08-02T01:00:00.000Z",
		version: 1,
	};
}

function createStore(
	overrides: Partial<InternalPortalCredentialStore> = {},
): InternalPortalCredentialStore {
	return {
		create: vi.fn(async (input) => ({
			...credential(input.credentialId, input.ssoTgc),
			createdAt: input.now.toISOString(),
			name: input.name,
			updatedAt: input.now.toISOString(),
		})),
		delete: vi.fn(async () => undefined),
		get: vi.fn(async () => credential()),
		list: vi.fn(async () => [credential()]),
		recordCheck: vi.fn(async (input) => ({
			...credential(input.credentialId, input.ssoTgc),
			lastAttemptAt: input.attemptedAt.toISOString(),
			lastOutcome: input.outcome,
			lastSuccessfulAt:
				input.outcome === "valid" ? input.attemptedAt.toISOString() : credential().lastSuccessfulAt,
		})),
		rename: vi.fn(async (input) => ({
			...credential(input.credentialId),
			name: input.name,
			version: input.expectedVersion + 1,
		})),
		rotate: vi.fn(async (input) => ({
			...credential(input.credentialId, input.ssoTgc),
			version: input.expectedVersion + 1,
		})),
		...overrides,
	};
}

describe("internal portal credential service", () => {
	it("validates and stores the refreshed TGC without returning plaintext", async () => {
		const store = createStore();
		const service = createInternalPortalCredentialService({
			checkAuthentication: async () => ({ ssoTgc: "TGT-refreshed" }),
			now: () => new Date("2026-08-02T02:00:00.000Z"),
			randomId: () => FIRST_ID,
			store,
		});

		const result = await service.create({
			name: "开发凭据",
			ssoTgc: "SSO_TGC=TGT-candidate; Path=/",
		});

		expect(store.create).toHaveBeenCalledWith({
			credentialId: FIRST_ID,
			name: "开发凭据",
			now: new Date("2026-08-02T02:00:00.000Z"),
			ssoTgc: "TGT-refreshed",
		});
		expect(result).not.toHaveProperty("ssoTgc");
	});

	it("does not write a rejected replacement", async () => {
		const store = createStore();
		const service = createInternalPortalCredentialService({
			checkAuthentication: async () => {
				throw new PortalCredentialExpiredError();
			},
			store,
		});

		await expect(service.rotate(FIRST_ID, "TGT-expired", 1)).rejects.toBeInstanceOf(
			InternalPortalCandidateRejectedError,
		);
		expect(store.rotate).not.toHaveBeenCalled();
	});

	it("checks independent credentials and suspends already rejected entries", async () => {
		const rejected = { ...credential(), lastOutcome: "credential_rejected" as const };
		const retryable = {
			...credential(SECOND_ID, "TGT-second"),
			lastOutcome: "check_failed" as const,
		};
		const store = createStore({ list: vi.fn(async () => [rejected, retryable]) });

		await expect(
			runScheduledInternalPortalChecks({
				checkAuthentication: async () => {
					throw new Error("dependency unavailable");
				},
				store,
			}),
		).resolves.toEqual({
			checks: [
				expect.objectContaining({
					credentialId: SECOND_ID,
					failureKind: "dependency_error",
					outcome: "check_failed",
				}),
			],
			suspended: [{ credentialId: FIRST_ID, credentialName: "第一条" }],
		});
	});

	it("classifies session rejection during a scheduled check", async () => {
		const store = createStore();
		const result = await runScheduledInternalPortalChecks({
			checkAuthentication: async () => {
				throw new PortalSessionExpiredError("expired");
			},
			store,
		});

		expect(result.checks[0]).toMatchObject({
			failureKind: "session_expired",
			outcome: "credential_rejected",
		});
	});

	it("resolves by health priority and skips stale writes", async () => {
		const first = credential();
		const second = credential(SECOND_ID, "TGT-second");
		const store = createStore({
			list: vi.fn(async () => [first, second]),
			recordCheck: vi
				.fn()
				.mockRejectedValueOnce(new InternalPortalCredentialConflictError())
				.mockResolvedValueOnce(second),
		});
		const service = createInternalPortalCredentialService({
			checkAuthentication: async (ssoTgc) => ({ ssoTgc }),
			store,
		});

		await expect(service.resolve()).resolves.toBe("TGT-second");
		expect(store.recordCheck).toHaveBeenCalledTimes(2);
	});

	it("fails explicitly when no candidate can be resolved", async () => {
		const store = createStore({
			list: vi.fn(async () => [
				{ ...credential(), lastOutcome: "credential_rejected" as const },
				{ ...credential(SECOND_ID), lastOutcome: "check_failed" as const },
			]),
		});
		const service = createInternalPortalCredentialService({
			checkAuthentication: async () => {
				throw new Error("dependency unavailable");
			},
			store,
		});

		await expect(service.resolve()).rejects.toBeInstanceOf(
			InternalPortalCredentialResolutionUnavailableError,
		);
	});
});
