import { and, eq } from "drizzle-orm";
import type { RuntimeDatabase } from "../../db/runtime";
import {
	account,
	accountDeletionRequests,
	oauthAccessToken,
	oauthConsent,
	oauthRefreshToken,
	session,
	user,
} from "../../db/schema";
import type { OpsAccountAdminPluginOptions } from "./ops-account-admin-plugin";

export function createAppAuthDatabaseOperations(database: RuntimeDatabase) {
	const clearTemporaryPasswordState = async (userId: string) => {
		await database
			.update(user)
			.set({
				passwordChangeRequired: false,
				temporaryPasswordExpiresAt: null,
				updatedAt: new Date(),
			})
			.where(eq(user.id, userId));
	};

	const commitTemporaryPassword: OpsAccountAdminPluginOptions["commitTemporaryPassword"] = async (
		temporaryPassword,
	) =>
		database.transaction(async (tx) => {
			const users = await tx
				.select({ id: user.id })
				.from(user)
				.where(eq(user.id, temporaryPassword.userId))
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
						eq(accountDeletionRequests.ownerUserId, temporaryPassword.userId),
						eq(accountDeletionRequests.status, "pending"),
					),
				)
				.limit(1);
			if (deletions[0]) {
				return "deleting" as const;
			}
			const credentials = await tx
				.select({ id: account.id })
				.from(account)
				.where(
					and(
						eq(account.userId, temporaryPassword.userId),
						eq(account.providerId, "credential"),
						eq(account.accountId, temporaryPassword.userId),
					),
				)
				.limit(1)
				.for("update");
			if (credentials[0]) {
				await tx
					.update(account)
					.set({
						password: temporaryPassword.passwordHash,
						updatedAt: temporaryPassword.issuedAt,
					})
					.where(eq(account.id, credentials[0].id));
			} else {
				await tx.insert(account).values({
					accountId: temporaryPassword.userId,
					createdAt: temporaryPassword.issuedAt,
					id: temporaryPassword.accountId,
					password: temporaryPassword.passwordHash,
					providerId: "credential",
					updatedAt: temporaryPassword.issuedAt,
					userId: temporaryPassword.userId,
				});
			}
			await tx
				.update(user)
				.set({
					passwordChangeRequired: true,
					temporaryPasswordExpiresAt: temporaryPassword.expiresAt,
					updatedAt: temporaryPassword.issuedAt,
				})
				.where(eq(user.id, temporaryPassword.userId));
			await tx
				.delete(oauthAccessToken)
				.where(eq(oauthAccessToken.userId, temporaryPassword.userId));
			await tx
				.delete(oauthRefreshToken)
				.where(eq(oauthRefreshToken.userId, temporaryPassword.userId));
			await tx.delete(oauthConsent).where(eq(oauthConsent.userId, temporaryPassword.userId));
			await tx.delete(session).where(eq(session.userId, temporaryPassword.userId));
			return "updated" as const;
		});

	const readCampusUser = async (userId: string) => {
		const rows = await database
			.select({
				banned: user.banned,
				email: user.email,
				emailVerified: user.emailVerified,
				id: user.id,
				passwordChangeRequired: user.passwordChangeRequired,
			})
			.from(user)
			.where(eq(user.id, userId))
			.limit(1);
		return rows[0] ?? null;
	};

	const revokeUserCredentials = async (userId: string) => {
		await database.transaction(async (tx) => {
			await tx.delete(oauthAccessToken).where(eq(oauthAccessToken.userId, userId));
			await tx.delete(oauthRefreshToken).where(eq(oauthRefreshToken.userId, userId));
			await tx.delete(oauthConsent).where(eq(oauthConsent.userId, userId));
			await tx.delete(session).where(eq(session.userId, userId));
		});
	};

	return {
		clearTemporaryPasswordState,
		commitTemporaryPassword,
		readCampusUser,
		revokeUserCredentials,
	};
}
