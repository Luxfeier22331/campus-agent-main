import type { user } from "../../db/schema";
import type {
	AccountAdminAction,
	AccountAdminEventPage,
	AccountAdminEventRecord,
	AccountAdminState,
	AccountAdminUserPage,
	AccountAdminUserSummary,
	AccountDeletionStatusRecord,
} from "./types";

export interface AccountAdminStore {
	findCommand(
		actorId: string,
		idempotencyKey: string,
	): Promise<{
		action: string;
		fingerprint: string;
		outcome: string;
	} | null>;
	finishCommand(input: {
		actorId: string;
		errorCode?: string;
		idempotencyKey: string;
		succeeded: boolean;
	}): Promise<void>;
	getUser(userId: string): Promise<{
		accessSource: AccountAdminUserSummary["accessSource"];
		accessState: AccountAdminUserSummary["accessState"];
		base: typeof user.$inferSelect | null;
		credentialAccount: boolean;
		deletion: AccountDeletionStatusRecord | null;
		events: AccountAdminEventRecord[];
	}>;
	hasPendingDeletion(userId: string): Promise<boolean>;
	listEvents(input: {
		action?: AccountAdminAction;
		actorId?: string;
		cursor?: string;
		limit: number;
		outcome?: AccountAdminEventRecord["outcome"];
		targetUserId?: string;
		window?: import("campus-contracts/ops-time").TimeQuery["window"];
		from?: import("campus-contracts/ops-time").TimeQuery["from"];
		to?: import("campus-contracts/ops-time").TimeQuery["to"];
	}): Promise<AccountAdminEventPage>;
	listUsers(input: {
		access?: AccountAdminUserSummary["accessState"];
		cursor?: string;
		limit: number;
		query?: string;
		state?: AccountAdminState;
	}): Promise<AccountAdminUserPage>;
	markStaleCommandsIndeterminate(before: Date): Promise<number>;
	unbanUser(userId: string, now: Date): Promise<"deleting" | "not_found" | "updated">;
	startCommand(input: {
		action: AccountAdminAction;
		actorId: string;
		fingerprint: string;
		idempotencyKey: string;
		reason?: string;
		targetUserId?: string;
	}): Promise<boolean>;
}
