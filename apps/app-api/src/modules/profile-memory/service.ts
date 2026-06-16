import { randomUUID } from "node:crypto";

import { AppApiRouteError } from "../../http";
import type { ResolvedAppPrincipal } from "../auth";
import type { ProfileMemoryItem, ProfileMemoryList } from "./model";
import { normalizeProfileMemoryKey, normalizeProfileMemoryValue } from "./model";
import type { ProfileMemoryStore } from "./store";

export interface ProfileMemoryService {
	deleteItem(input: {
		itemId: string;
		principal: ResolvedAppPrincipal;
	}): Promise<{ deleted: true }>;
	list(input: { principal: ResolvedAppPrincipal }): Promise<ProfileMemoryList>;
	setEnabled(input: {
		enabled: boolean;
		principal: ResolvedAppPrincipal;
	}): Promise<{ enabled: boolean }>;
	upsert(input: {
		key: string;
		principal: ResolvedAppPrincipal;
		value: string;
	}): Promise<{ item: ProfileMemoryItem }>;
}

export interface ProfileMemoryIndexer {
	disableOwnerMemory(input: {
		tenantId?: string;
		updatedAt: string;
		userId: string;
	}): Promise<{ status: string; userId: string }>;
	disableExplicitMemory(input: {
		memoryId: string;
		tenantId?: string;
		updatedAt: string;
		userId: string;
	}): Promise<{ memoryId: string; status: string }>;
	upsertExplicitMemory(input: {
		canonicalSubject: string;
		compactText: string;
		memoryId: string;
		tenantId?: string;
		updatedAt: string;
		userId: string;
	}): Promise<{ memoryId: string; status: string }>;
}

export interface ProfileMemoryServiceDependencies {
	generateId?: (prefix: string) => string;
	memoryIndexer: ProfileMemoryIndexer;
	now?: () => Date;
	store: ProfileMemoryStore;
}

function defaultGenerateId(prefix: string): string {
	return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

function createProfileMemoryError(input: {
	code: string;
	message: string;
	status: number;
}): AppApiRouteError {
	return new AppApiRouteError({
		code: input.code,
		message: input.message,
		retryable: false,
		status: input.status,
	});
}

function assertProfileMemoryPrincipal(principal: ResolvedAppPrincipal): string {
	if (!principal.permissions.chat) {
		throw createProfileMemoryError({
			code: "forbidden",
			message: "Profile memory is not available for this principal.",
			status: 403,
		});
	}

	const ownerUserId = principal.principal.principalId.trim();
	if (!ownerUserId) {
		throw createProfileMemoryError({
			code: "invalid_principal",
			message: "Profile memory requires a stable principal id.",
			status: 403,
		});
	}
	return ownerUserId;
}

export function buildProfileMemoryService(
	dependencies: ProfileMemoryServiceDependencies,
): ProfileMemoryService {
	const generateId = dependencies.generateId ?? defaultGenerateId;
	const now = dependencies.now ?? (() => new Date());

	return {
		async deleteItem(input) {
			const ownerUserId = assertProfileMemoryPrincipal(input.principal);
			const itemId = input.itemId.trim();
			if (!itemId) {
				throw createProfileMemoryError({
					code: "invalid_profile_memory_item",
					message: "Profile memory item id is required.",
					status: 400,
				});
			}

			await dependencies.memoryIndexer.disableExplicitMemory({
				memoryId: itemId,
				updatedAt: now().toISOString(),
				userId: ownerUserId,
			});
			const deleted = await dependencies.store.deleteItem({ itemId, ownerUserId });
			if (!deleted) {
				throw createProfileMemoryError({
					code: "profile_memory_item_not_found",
					message: "Profile memory item not found.",
					status: 404,
				});
			}
			return { deleted: true as const };
		},

		async list(input) {
			const ownerUserId = assertProfileMemoryPrincipal(input.principal);
			return dependencies.store.listByOwner(ownerUserId);
		},

		async setEnabled(input) {
			const ownerUserId = assertProfileMemoryPrincipal(input.principal);
			const updatedAt = now().toISOString();
			if (!input.enabled) {
				await dependencies.memoryIndexer.disableOwnerMemory({
					updatedAt,
					userId: ownerUserId,
				});
			}
			const enabled = await dependencies.store.setEnabled({
				enabled: input.enabled,
				ownerUserId,
				updatedAt,
			});
			return { enabled };
		},

		async upsert(input) {
			const ownerUserId = assertProfileMemoryPrincipal(input.principal);
			const key = normalizeProfileMemoryKey(input.key);
			const value = normalizeProfileMemoryValue(input.value);
			const updatedAt = now().toISOString();
			if (!(key && value)) {
				throw createProfileMemoryError({
					code: "invalid_profile_memory_item",
					message: "Profile memory requires a safe key and a non-empty value under 500 characters.",
					status: 400,
				});
			}

			const existingItemId = await dependencies.store.findItemIdByKey({
				key,
				ownerUserId,
			});
			const itemId = existingItemId ?? generateId("mem");
			await dependencies.memoryIndexer.upsertExplicitMemory({
				canonicalSubject: key,
				compactText: `${key}: ${value}`,
				memoryId: itemId,
				updatedAt,
				userId: ownerUserId,
			});
			const item = await dependencies.store.upsertUserDeclared({
				itemId,
				key,
				ownerUserId,
				updatedAt,
				value,
			});
			return { item };
		},
	};
}
