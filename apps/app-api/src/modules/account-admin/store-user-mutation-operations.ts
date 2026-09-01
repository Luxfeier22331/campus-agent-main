import { and, eq } from "drizzle-orm";

import { accountDeletionRequests, user } from "../../db/schema";
import type { AccountAdminStoreContext } from "./store-context";
import type { AccountAdminStore } from "./store-contract";

type AccountAdminUserMutationOperations = Pick<AccountAdminStore, "unbanUser">;

export function createAccountAdminUserMutationOperations(
	context: AccountAdminStoreContext,
): AccountAdminUserMutationOperations {
	return {
		async unbanUser(userId, now) {
			const db = await context.getDb();
			return db.transaction(async (tx) => {
				const users = await tx
					.select({ id: user.id })
					.from(user)
					.where(eq(user.id, userId))
					.limit(1)
					.for("update");
				if (!users[0]) {
					return "not_found" as const;
				}
				const deletions = await tx
					.select({ requestId: accountDeletionRequests.requestId })
					.from(accountDeletionRequests)
					.where(
						and(
							eq(accountDeletionRequests.ownerUserId, userId),
							eq(accountDeletionRequests.status, "pending"),
						),
					)
					.limit(1);
				if (deletions[0]) {
					return "deleting" as const;
				}
				await tx
					.update(user)
					.set({
						banExpires: null,
						banReason: null,
						banned: false,
						updatedAt: now,
					})
					.where(eq(user.id, userId));
				return "updated" as const;
			});
		},
	};
}
