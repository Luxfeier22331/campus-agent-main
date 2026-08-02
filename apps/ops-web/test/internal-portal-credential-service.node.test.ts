// @vitest-environment node

import { PortalCredentialExpiredError } from "@campus-agent/internal-portal-client";
import { describe, expect, it, vi } from "vitest";
import {
	createInternalPortalCredentialService,
	InternalPortalCandidateCheckFailedError,
	InternalPortalCandidateRejectedError,
	runScheduledInternalPortalChecks,
} from "../src/server/internal-portal-credential-service.ts";
import {
	InternalPortalCredentialConflictError,
	type InternalPortalCredentialRecord,
	type InternalPortalCredentialStore,
	InternalPortalCredentialStoreUnavailableError,
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
	it("validates and stores the CAS-refreshed TGC without returning plaintext", async () => {
		const store = createStore();
		const checkAuthentication = vi.fn(async () => ({ ssoTgc: "TGT-refreshed" }));
		const service = createInternalPortalCredentialService({
			checkAuthentication,
			now: () => new Date("2026-08-02T02:00:00.000Z"),
			randomId: () => FIRST_ID,
			store,
		});

		const result = await service.create({ name: "开发凭据", ssoTgc: "TGT-candidate" });

		expect(checkAuthentication).toHaveBeenCalledWith("TGT-candidate", expect.any(AbortSignal));
		expect(store.create).toHaveBeenCalledWith({
			credentialId: FIRST_ID,
			name: "开发凭据",
			now: new Date("2026-08-02T02:00:00.000Z"),
			ssoTgc: "TGT-refreshed",
		});
		expect(result).not.toHaveProperty("ssoTgc");
	});

	it("does not overwrite a credential when candidate validation fails", async () => {
		const store = createStore();
		const malformed = createInternalPortalCredentialService({ store });
		await expect(malformed.rotate(FIRST_ID, " TGT-new", 1)).rejects.toBeInstanceOf(
			InternalPortalCandidateRejectedError,
		);
		expect(store.rotate).not.toHaveBeenCalled();

		const rejected = createInternalPortalCredentialService({
			checkAuthentication: async () => {
				throw new PortalCredentialExpiredError();
			},
			store,
		});
		await expect(rejected.rotate(FIRST_ID, "TGT-expired", 1)).rejects.toBeInstanceOf(
			InternalPortalCandidateRejectedError,
		);
		expect(store.rotate).not.toHaveBeenCalled();

		const unavailable = createInternalPortalCredentialService({
			checkAuthentication: async () => {
				throw new Error("network unavailable");
			},
			store,
		});
		await expect(unavailable.rotate(FIRST_ID, "TGT-new", 1)).rejects.toBeInstanceOf(
			InternalPortalCandidateCheckFailedError,
		);
		expect(store.rotate).not.toHaveBeenCalled();
	});

	it("checks every stored credential and records independent outcomes", async () => {
		const first = credential();
		const second = credential(SECOND_ID, "TGT-second");
		const checkAuthentication = vi
			.fn()
			.mockRejectedValueOnce(new PortalCredentialExpiredError())
			.mockResolvedValueOnce({ ssoTgc: "TGT-second-refreshed" });
		const recordCheck = vi.fn(async (input) => ({
			...(input.credentialId === FIRST_ID ? first : second),
			lastOutcome: input.outcome,
			ssoTgc: input.ssoTgc,
		}));
		const store = createStore({
			list: vi.fn(async () => [first, second]),
			recordCheck,
		});

		await expect(runScheduledInternalPortalChecks({ checkAuthentication, store })).resolves.toEqual(
			[
				{ credentialId: FIRST_ID, outcome: "credential_rejected" },
				{ credentialId: SECOND_ID, outcome: "valid" },
			],
		);
		expect(recordCheck).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ credentialId: FIRST_ID, outcome: "credential_rejected" }),
		);
		expect(recordCheck).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				credentialId: SECOND_ID,
				outcome: "valid",
				ssoTgc: "TGT-second-refreshed",
			}),
		);
	});

	it("marks a stale scheduled write and continues with later credentials", async () => {
		const first = credential();
		const second = credential(SECOND_ID, "TGT-second");
		const store = createStore({
			list: vi.fn(async () => [first, second]),
			recordCheck: vi
				.fn()
				.mockRejectedValueOnce(new InternalPortalCredentialConflictError())
				.mockResolvedValueOnce(second),
		});

		await expect(
			runScheduledInternalPortalChecks({
				checkAuthentication: async (ssoTgc) => ({ ssoTgc }),
				store,
			}),
		).resolves.toEqual([
			{ credentialId: FIRST_ID, outcome: "stale" },
			{ credentialId: SECOND_ID, outcome: "valid" },
		]);
	});

	it("waits for initial cron database connectivity before checking credentials", async () => {
		const initialFailure = connectionRefusedStoreError();
		const list = vi
			.fn()
			.mockRejectedValueOnce(initialFailure)
			.mockResolvedValueOnce([credential()]);
		const wait = vi.fn(async () => undefined);
		const checkAuthentication = vi.fn(async (ssoTgc: string) => ({ ssoTgc }));
		const store = createStore({ list });

		await expect(
			runScheduledInternalPortalChecks({ checkAuthentication, store, wait }),
		).resolves.toEqual([{ credentialId: FIRST_ID, outcome: "valid" }]);
		expect(list).toHaveBeenCalledTimes(2);
		expect(wait).toHaveBeenCalledOnce();
		expect(wait).toHaveBeenCalledWith(1_000);
		expect(checkAuthentication).toHaveBeenCalledOnce();
		expect(store.recordCheck).toHaveBeenCalledOnce();
	});

	it("bounds the initial cron database readiness wait", async () => {
		const failure = connectionRefusedStoreError();
		const list = vi.fn(async () => {
			throw failure;
		});
		const wait = vi.fn(async () => undefined);

		await expect(
			runScheduledInternalPortalChecks({ store: createStore({ list }), wait }),
		).rejects.toBe(failure);
		expect(list).toHaveBeenCalledTimes(5);
		expect(wait).toHaveBeenCalledTimes(4);
	});

	it("does not wait for non-connectivity database failures", async () => {
		const failure = new InternalPortalCredentialStoreUnavailableError(
			"内部门户凭据数据库不可用。",
			{ cause: Object.assign(new Error("authentication failed"), { code: "28P01" }) },
		);
		const list = vi.fn(async () => {
			throw failure;
		});
		const wait = vi.fn(async () => undefined);

		await expect(
			runScheduledInternalPortalChecks({ store: createStore({ list }), wait }),
		).rejects.toBe(failure);
		expect(list).toHaveBeenCalledOnce();
		expect(wait).not.toHaveBeenCalled();
	});
});

function connectionRefusedStoreError(): InternalPortalCredentialStoreUnavailableError {
	return new InternalPortalCredentialStoreUnavailableError("内部门户凭据数据库不可用。", {
		cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
	});
}
