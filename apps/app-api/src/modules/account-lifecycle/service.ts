import { randomUUID } from "node:crypto";

import type { ResolvedAppPrincipal } from "../auth/principal";
import type { AccountLifecycleService, AccountLifecycleServiceDependencies } from "./types";

const ACCOUNT_DELETION_LEASE_MS = 5 * 60 * 1_000;
const ACCOUNT_DELETION_PENDING_DELAY_MS = 60 * 1_000;
const ACCOUNT_DELETION_RETRY_DELAY_MS = 5 * 60 * 1_000;

function internalDeletionPrincipal(ownerUserId: string): ResolvedAppPrincipal {
	return {
		actor: {
			departments: [],
			principalId: ownerUserId,
			principalType: "campus_member",
			roles: ["campus_member"],
			userId: ownerUserId,
		},
		permissions: { chat: true },
		principal: {
			displayName: ownerUserId,
			email: null,
			principalId: ownerUserId,
			type: "campus_member",
		},
		session: null,
	};
}

export function buildAccountLifecycleService(
	dependencies: AccountLifecycleServiceDependencies,
): AccountLifecycleService {
	return {
		async requestDeletion(input) {
			return dependencies.store.requestDeletion({
				ownerUserId: input.principal.principal.principalId,
				requestId: `acctdel_${randomUUID().replace(/-/g, "")}`,
				requestedAt: new Date(),
			});
		},

		async dispatchPending() {
			let completed = 0;
			let failed = 0;
			let processed = 0;
			for (let index = 0; index < 20; index += 1) {
				const claimedAt = new Date();
				const leaseToken = `acctdel_lease_${randomUUID().replace(/-/g, "")}`;
				const [request] = await dependencies.store.claimPending({
					leaseExpiresAt: new Date(claimedAt.getTime() + ACCOUNT_DELETION_LEASE_MS),
					leaseToken,
					limit: 1,
					now: claimedAt,
				});
				if (!request) {
					break;
				}
				processed += 1;
				const renewLease = async () => {
					const now = new Date();
					return dependencies.store.renewLease(
						request,
						new Date(now.getTime() + ACCOUNT_DELETION_LEASE_MS),
						now,
					);
				};
				try {
					const executionDeletion = await dependencies.executionController.beginOwnerDeletion({
						ownerUserId: request.ownerUserId,
					});
					if (executionDeletion.state === "draining" && executionDeletion.activeRunCount > 0) {
						const deferredAt = new Date();
						await dependencies.store.defer(
							request,
							new Date(deferredAt.getTime() + ACCOUNT_DELETION_PENDING_DELAY_MS),
							deferredAt,
						);
						continue;
					}
					await dependencies.profileMemoryService.eraseForAccountDeletion({
						principal: internalDeletionPrincipal(request.ownerUserId),
						requestId: request.requestId,
					});
					await dependencies.profileMemoryService.dispatchPending();
					if (!(await renewLease())) {
						continue;
					}
					if (await dependencies.store.isMemoryErased(request.ownerUserId)) {
						const finalizedExecution = await dependencies.executionController.finalizeOwnerDeletion(
							{
								ownerUserId: request.ownerUserId,
							},
						);
						if (finalizedExecution.state !== "deleted" || finalizedExecution.activeRunCount > 0) {
							const deferredAt = new Date();
							await dependencies.store.defer(
								request,
								new Date(deferredAt.getTime() + ACCOUNT_DELETION_PENDING_DELAY_MS),
								deferredAt,
							);
							continue;
						}
						if (!(await renewLease())) {
							continue;
						}
						const diningErased = await dependencies.diningLifecycleService.eraseForAccountDeletion({
							ownerUserId: request.ownerUserId,
							requestId: request.requestId,
						});
						if (!(await renewLease())) {
							continue;
						}
						if (!diningErased) {
							const deferredAt = new Date();
							await dependencies.store.defer(
								request,
								new Date(deferredAt.getTime() + ACCOUNT_DELETION_PENDING_DELAY_MS),
								deferredAt,
							);
							continue;
						}
						if (
							!(await dependencies.store.deleteOwnedData(
								request,
								new Date(),
								dependencies.safetyIdentifierForUser(request.ownerUserId),
							))
						) {
							continue;
						}
						if (!(await renewLease())) {
							continue;
						}
						await dependencies.removeAuthUser(request.ownerUserId);
						if (!(await renewLease())) {
							continue;
						}
						if (await dependencies.store.completeDeletion(request, new Date())) {
							completed += 1;
						}
					} else {
						const deferredAt = new Date();
						await dependencies.store.defer(
							request,
							new Date(deferredAt.getTime() + ACCOUNT_DELETION_PENDING_DELAY_MS),
							deferredAt,
						);
					}
				} catch (error) {
					const failedAt = new Date();
					if (
						await dependencies.store.recordFailure({
							errorCode: error instanceof Error ? error.name : "account_deletion_failed",
							leaseToken: request.leaseToken,
							nextAttemptAt: new Date(failedAt.getTime() + ACCOUNT_DELETION_RETRY_DELAY_MS),
							now: failedAt,
							requestId: request.requestId,
						})
					) {
						failed += 1;
					}
				}
			}
			return { completed, failed, processed };
		},
	};
}
