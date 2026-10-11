import { describe, expect, it, vi } from "vitest";

import { buildAccountLifecycleService } from "../src/modules/account-lifecycle/service";
import type { ResolvedAppPrincipal } from "../src/modules/auth";

function principal(): ResolvedAppPrincipal {
	return {
		actor: {
			departments: [],
			principalId: "user_1",
			principalType: "campus_member",
			roles: ["campus_member"],
			userId: "user_1",
		},
		permissions: { chat: true },
		principal: {
			displayName: "Student",
			email: "student@muc.edu.cn",
			principalId: "user_1",
			type: "campus_member",
		},
		session: null,
	};
}

function executionController() {
	return {
		beginOwnerDeletion: vi.fn(async () => ({ activeRunCount: 0, state: "draining" as const })),
		finalizeOwnerDeletion: vi.fn(async () => ({ activeRunCount: 0, state: "deleted" as const })),
	};
}

function diningDeletionFixture(executionMaintenance = false) {
	const request = {
		leaseToken: "lease_dining",
		ownerUserId: "user_1",
		requestId: "acctdel_dining",
	};
	const eraseForAccountDeletion = vi.fn().mockResolvedValue(true);
	const removeAuthUser = vi.fn();
	const store = {
		claimPending: vi.fn().mockResolvedValueOnce([request]).mockResolvedValue([]),
		completeDeletion: vi.fn().mockResolvedValue(true),
		defer: vi.fn().mockResolvedValue(true),
		deleteOwnedData: vi.fn().mockResolvedValue(true),
		isMemoryErased: vi.fn().mockResolvedValue(true),
		recordFailure: vi.fn().mockResolvedValue(true),
		renewLease: vi.fn().mockResolvedValue(true),
		requestDeletion: vi.fn(),
	};
	const service = buildAccountLifecycleService({
		memoryController: { finalizeOwnerDeletion: async () => undefined },
		executionMaintenance,
		diningLifecycleService: { eraseForAccountDeletion },
		executionController: executionController(),
		profileMemoryService: {
			dispatchPending: vi.fn(),
			eraseForAccountDeletion: vi.fn(),
		},
		removeAuthUser,
		safetyIdentifierForUser: () => null,
		store,
	});
	return { eraseForAccountDeletion, removeAuthUser, request, service, store };
}

describe("account lifecycle service", () => {
	it("defers incomplete Dining byte deletion and resumes the same account request", async () => {
		const { eraseForAccountDeletion, removeAuthUser, request, service, store } =
			diningDeletionFixture();
		eraseForAccountDeletion.mockResolvedValueOnce(false);
		await expect(service.dispatchPending()).resolves.toEqual({
			completed: 0,
			failed: 0,
			processed: 1,
		});
		expect(eraseForAccountDeletion).toHaveBeenCalledWith({
			ownerUserId: request.ownerUserId,
			requestId: request.requestId,
		});
		expect(store.defer).toHaveBeenCalledWith(request, expect.any(Date), expect.any(Date));
		expect(store.deleteOwnedData).not.toHaveBeenCalled();
		expect(removeAuthUser).not.toHaveBeenCalled();
		expect(store.completeDeletion).not.toHaveBeenCalled();

		store.claimPending.mockResolvedValueOnce([request]).mockResolvedValueOnce([]);
		await expect(service.dispatchPending()).resolves.toEqual({
			completed: 1,
			failed: 0,
			processed: 1,
		});
		expect(eraseForAccountDeletion).toHaveBeenCalledTimes(2);
		expect(removeAuthUser).toHaveBeenCalledWith(request.ownerUserId);
		expect(store.completeDeletion).toHaveBeenCalledWith(request, expect.any(Date));
	});

	it("records Dining deletion failures without removing the auth account", async () => {
		const { eraseForAccountDeletion, removeAuthUser, request, service, store } =
			diningDeletionFixture();
		eraseForAccountDeletion.mockRejectedValue(new Error("Object version deletion failed"));
		await expect(service.dispatchPending()).resolves.toEqual({
			completed: 0,
			failed: 1,
			processed: 1,
		});
		expect(store.recordFailure).toHaveBeenCalledWith(
			expect.objectContaining({
				leaseToken: request.leaseToken,
				requestId: request.requestId,
			}),
		);
		expect(removeAuthUser).not.toHaveBeenCalled();
		expect(store.completeDeletion).not.toHaveBeenCalled();
	});

	it("does not finalize when the lease expires during Dining object deletion", async () => {
		const { eraseForAccountDeletion, removeAuthUser, service, store } = diningDeletionFixture();
		store.renewLease
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false);
		await expect(service.dispatchPending()).resolves.toEqual({
			completed: 0,
			failed: 0,
			processed: 1,
		});
		expect(eraseForAccountDeletion).toHaveBeenCalledOnce();
		expect(store.deleteOwnedData).not.toHaveBeenCalled();
		expect(removeAuthUser).not.toHaveBeenCalled();
		expect(store.completeDeletion).not.toHaveBeenCalled();
	});

	it("honors the database completion guard after Dining returns success", async () => {
		const { removeAuthUser, service, store } = diningDeletionFixture();
		store.deleteOwnedData.mockResolvedValue(false);
		await expect(service.dispatchPending()).resolves.toEqual({
			completed: 0,
			failed: 0,
			processed: 1,
		});
		expect(removeAuthUser).not.toHaveBeenCalled();
		expect(store.completeDeletion).not.toHaveBeenCalled();
	});

	it("creates a deletion request after route-level reauthentication", async () => {
		const requestDeletion = vi
			.fn()
			.mockResolvedValue({ requestId: "acctdel_1", status: "deleting" });
		const service = buildAccountLifecycleService({
			memoryController: { finalizeOwnerDeletion: async () => undefined },
			diningLifecycleService: { eraseForAccountDeletion: vi.fn().mockResolvedValue(true) },
			executionController: executionController(),
			profileMemoryService: {} as never,
			removeAuthUser: vi.fn(),
			safetyIdentifierForUser: () => null,
			store: { requestDeletion } as never,
		});

		await expect(service.requestDeletion({ principal: principal() })).resolves.toEqual({
			requestId: "acctdel_1",
			status: "deleting",
		});
		expect(requestDeletion).toHaveBeenCalledWith(
			expect.objectContaining({ ownerUserId: "user_1" }),
		);
	});

	it("deletes product data and the Better Auth user only after memory erasure converges", async () => {
		const eraseForAccountDeletion = vi
			.fn()
			.mockResolvedValue({ lifecycleState: "erased", syncStatus: "pending" });
		const dispatchPending = vi.fn().mockResolvedValue({ admitted: 1, failed: 0, processed: 1 });
		const completeDeletion = vi.fn();
		const deleteOwnedData = vi.fn();
		const isMemoryErased = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
		const removeAuthUser = vi.fn();
		const request = {
			leaseToken: "lease_1",
			ownerUserId: "user_1",
			requestId: "acctdel_1",
		};
		const claimPending = vi
			.fn()
			.mockResolvedValueOnce([request])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([request])
			.mockResolvedValue([]);
		const defer = vi.fn().mockResolvedValue(true);
		const service = buildAccountLifecycleService({
			memoryController: { finalizeOwnerDeletion: async () => undefined },
			diningLifecycleService: { eraseForAccountDeletion: vi.fn().mockResolvedValue(true) },
			executionController: executionController(),
			profileMemoryService: { dispatchPending, eraseForAccountDeletion },
			removeAuthUser,
			safetyIdentifierForUser: () => "safety-user-1",
			store: {
				claimPending,
				completeDeletion: completeDeletion.mockResolvedValue(true),
				defer,
				deleteOwnedData,
				isMemoryErased,
				recordFailure: vi.fn(),
				renewLease: vi.fn().mockResolvedValue(true),
			} as never,
		});

		await expect(service.dispatchPending()).resolves.toEqual({
			completed: 0,
			failed: 0,
			processed: 1,
		});
		expect(completeDeletion).not.toHaveBeenCalled();
		expect(deleteOwnedData).not.toHaveBeenCalled();
		expect(removeAuthUser).not.toHaveBeenCalled();
		expect(defer).toHaveBeenCalledWith(request, expect.any(Date), expect.any(Date));
		deleteOwnedData.mockResolvedValue(true);
		await expect(service.dispatchPending()).resolves.toEqual({
			completed: 1,
			failed: 0,
			processed: 1,
		});
		expect(eraseForAccountDeletion).toHaveBeenCalledWith(
			expect.objectContaining({ requestId: "acctdel_1" }),
		);
		expect(deleteOwnedData).toHaveBeenCalledWith(request, expect.any(Date), "safety-user-1");
		expect(removeAuthUser).toHaveBeenCalledWith("user_1");
		expect(completeDeletion).toHaveBeenCalledWith(request, expect.any(Date));
	});

	it("records retryable downstream failures without finalizing the account", async () => {
		const recordFailure = vi.fn();
		const completeDeletion = vi.fn();
		const service = buildAccountLifecycleService({
			memoryController: { finalizeOwnerDeletion: async () => undefined },
			diningLifecycleService: { eraseForAccountDeletion: vi.fn().mockResolvedValue(true) },
			executionController: executionController(),
			profileMemoryService: {
				dispatchPending: vi.fn(),
				eraseForAccountDeletion: vi.fn().mockRejectedValue(new Error("downstream unavailable")),
			},
			removeAuthUser: vi.fn(),
			safetyIdentifierForUser: () => null,
			store: {
				claimPending: vi
					.fn()
					.mockResolvedValueOnce([
						{ leaseToken: "lease_1", ownerUserId: "user_1", requestId: "acctdel_1" },
					])
					.mockResolvedValue([]),
				completeDeletion,
				recordFailure: recordFailure.mockResolvedValue(true),
			} as never,
		});

		await expect(service.dispatchPending()).resolves.toEqual({
			completed: 0,
			failed: 1,
			processed: 1,
		});
		expect(recordFailure).toHaveBeenCalledWith(
			expect.objectContaining({
				errorCode: "Error",
				leaseToken: "lease_1",
				requestId: "acctdel_1",
			}),
		);
		expect(completeDeletion).not.toHaveBeenCalled();
	});

	it("stops destructive work when lease ownership is lost", async () => {
		const deleteOwnedData = vi.fn();
		const removeAuthUser = vi.fn();
		const completeDeletion = vi.fn();
		const service = buildAccountLifecycleService({
			memoryController: { finalizeOwnerDeletion: async () => undefined },
			diningLifecycleService: { eraseForAccountDeletion: vi.fn().mockResolvedValue(true) },
			executionController: executionController(),
			profileMemoryService: {
				dispatchPending: vi.fn(),
				eraseForAccountDeletion: vi.fn(),
			},
			removeAuthUser,
			safetyIdentifierForUser: () => "safety-user-1",
			store: {
				claimPending: vi
					.fn()
					.mockResolvedValueOnce([
						{ leaseToken: "lease_1", ownerUserId: "user_1", requestId: "acctdel_1" },
					])
					.mockResolvedValue([]),
				completeDeletion,
				deleteOwnedData,
				isMemoryErased: vi.fn().mockResolvedValue(true),
				recordFailure: vi.fn(),
				renewLease: vi.fn().mockResolvedValue(false),
			} as never,
		});

		await expect(service.dispatchPending()).resolves.toEqual({
			completed: 0,
			failed: 0,
			processed: 1,
		});
		expect(deleteOwnedData).not.toHaveBeenCalled();
		expect(removeAuthUser).not.toHaveBeenCalled();
		expect(completeDeletion).not.toHaveBeenCalled();
	});

	it("uses an independent lease token for each claimed deletion", async () => {
		const claimedTokens: string[] = [];
		let claimCount = 0;
		const claimPending = vi.fn(async (input: { leaseToken: string }) => {
			claimCount += 1;
			if (claimCount > 2) {
				return [];
			}
			claimedTokens.push(input.leaseToken);
			return [
				{
					leaseToken: input.leaseToken,
					ownerUserId: `user_${claimCount}`,
					requestId: `acctdel_${claimCount}`,
				},
			];
		});
		const service = buildAccountLifecycleService({
			memoryController: { finalizeOwnerDeletion: async () => undefined },
			diningLifecycleService: { eraseForAccountDeletion: vi.fn().mockResolvedValue(true) },
			executionController: executionController(),
			profileMemoryService: {
				dispatchPending: vi.fn(),
				eraseForAccountDeletion: vi.fn(),
			},
			removeAuthUser: vi.fn(),
			safetyIdentifierForUser: () => null,
			store: {
				claimPending,
				defer: vi.fn().mockResolvedValue(true),
				isMemoryErased: vi.fn().mockResolvedValue(false),
				recordFailure: vi.fn(),
				renewLease: vi.fn().mockResolvedValue(true),
			} as never,
		});

		await expect(service.dispatchPending()).resolves.toEqual({
			completed: 0,
			failed: 0,
			processed: 2,
		});
		expect(claimedTokens).toHaveLength(2);
		expect(new Set(claimedTokens).size).toBe(2);
		expect(claimPending).toHaveBeenCalledTimes(3);
	});
});

it("blocks new deletion during maintenance and still dispatches accepted deletion", async () => {
	const { service, store } = diningDeletionFixture(true);
	await expect(service.requestDeletion({ principal: principal() })).rejects.toMatchObject({
		code: "execution_maintenance",
		status: 503,
	});
	expect(store.requestDeletion).not.toHaveBeenCalled();
	await service.dispatchPending();
	expect(store.claimPending).toHaveBeenCalled();
});
