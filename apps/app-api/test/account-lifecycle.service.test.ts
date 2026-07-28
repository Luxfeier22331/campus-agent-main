import { describe, expect, it, vi } from "vitest";

import { buildAccountLifecycleService } from "../src/modules/account-lifecycle";
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

describe("account lifecycle service", () => {
	it("creates a deletion request after route-level reauthentication", async () => {
		const requestDeletion = vi
			.fn()
			.mockResolvedValue({ requestId: "acctdel_1", status: "deleting" });
		const service = buildAccountLifecycleService({
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
		const erase = vi.fn().mockResolvedValue({ lifecycleState: "erasing", syncStatus: "pending" });
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
			profileMemoryService: { dispatchPending, erase } as never,
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
		expect(erase).toHaveBeenCalledWith(
			expect.objectContaining({ idempotencyKey: "account-delete:acctdel_1" }),
		);
		expect(deleteOwnedData).toHaveBeenCalledWith(request, expect.any(Date), "safety-user-1");
		expect(removeAuthUser).toHaveBeenCalledWith("user_1");
		expect(completeDeletion).toHaveBeenCalledWith(request, expect.any(Date));
	});

	it("records retryable downstream failures without finalizing the account", async () => {
		const recordFailure = vi.fn();
		const completeDeletion = vi.fn();
		const service = buildAccountLifecycleService({
			profileMemoryService: {
				dispatchPending: vi.fn(),
				erase: vi.fn().mockRejectedValue(new Error("downstream unavailable")),
			} as never,
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
			profileMemoryService: {
				dispatchPending: vi.fn(),
				erase: vi.fn(),
			} as never,
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
			profileMemoryService: {
				dispatchPending: vi.fn(),
				erase: vi.fn(),
			} as never,
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
