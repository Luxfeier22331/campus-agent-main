import type { ResolvedAppPrincipal } from "../auth/principal";
import type { ProfileMemoryService } from "../profile-memory/service";

export interface AccountDeletionReceipt {
	requestId: string;
	status: "deleting";
}

export interface AccountDeletionExecutionController {
	beginOwnerDeletion(input: { ownerUserId: string }): Promise<{
		activeRunCount: number;
		state: "draining" | "deleted";
	}>;
	finalizeOwnerDeletion(input: { ownerUserId: string }): Promise<{
		activeRunCount: number;
		state: "draining" | "deleted";
	}>;
}

export interface PendingAccountDeletion {
	ownerUserId: string;
	requestId: string;
}

export interface ClaimedAccountDeletion extends PendingAccountDeletion {
	leaseToken: string;
}

export interface AccountLifecycleStore {
	claimPending(input: {
		leaseExpiresAt: Date;
		leaseToken: string;
		limit: number;
		now: Date;
	}): Promise<ClaimedAccountDeletion[]>;
	completeDeletion(request: ClaimedAccountDeletion, now: Date): Promise<boolean>;
	defer(request: ClaimedAccountDeletion, nextAttemptAt: Date, now: Date): Promise<boolean>;
	deleteOwnedData(
		request: ClaimedAccountDeletion,
		now: Date,
		safetyIdentifier: string | null,
	): Promise<boolean>;
	isMemoryErased(ownerUserId: string): Promise<boolean>;
	recordFailure(input: {
		errorCode: string;
		leaseToken: string;
		nextAttemptAt: Date;
		now: Date;
		requestId: string;
	}): Promise<boolean>;
	renewLease(request: ClaimedAccountDeletion, leaseExpiresAt: Date, now: Date): Promise<boolean>;
	requestDeletion(input: {
		ownerUserId: string;
		requestId: string;
		requestedAt: Date;
	}): Promise<AccountDeletionReceipt>;
}

export interface AccountLifecycleService {
	dispatchPending(): Promise<{ completed: number; failed: number; processed: number }>;
	requestDeletion(input: { principal: ResolvedAppPrincipal }): Promise<AccountDeletionReceipt>;
}

export interface AccountLifecycleServiceDependencies {
	executionController: AccountDeletionExecutionController;
	profileMemoryService: Pick<ProfileMemoryService, "dispatchPending" | "eraseForAccountDeletion">;
	removeAuthUser: (userId: string) => Promise<void>;
	safetyIdentifierForUser: (userId: string) => string | null;
	store: AccountLifecycleStore;
}
