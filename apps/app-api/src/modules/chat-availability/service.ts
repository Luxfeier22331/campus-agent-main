import type {
	ChatAvailabilityResponse,
	ChatAvailabilityStatus,
} from "campus-contracts/product-availability";
import { desc, gte } from "drizzle-orm";

import type { Env } from "../../config";
import { createRuntimeDbGetter, type RuntimeDbGetter } from "../../db/runtime";
import { turnDispatches } from "../../db/schema";

export const CHAT_AVAILABILITY_WINDOW_MS = 15 * 60 * 1_000;

export interface ChatAvailabilityStore {
	getLatestStatusSince(since: Date): Promise<string | null>;
}

export interface ChatAvailabilityService {
	getAvailability(): Promise<ChatAvailabilityResponse>;
}

const OPERATIONAL_STATUSES = new Set(["completed", "approval_required", "rejected", "cancelled"]);

function toAvailabilityStatus(status: string | null): ChatAvailabilityStatus {
	if (status === null || status === "accepted") {
		return "unknown";
	}
	if (status === "error") {
		return "outage";
	}
	if (OPERATIONAL_STATUSES.has(status)) {
		return "operational";
	}
	throw new Error(`Unexpected chat turn status: ${status}`);
}

export function buildChatAvailabilityService(input: {
	now?: () => Date;
	store: ChatAvailabilityStore;
}): ChatAvailabilityService {
	const now = input.now ?? (() => new Date());
	return {
		async getAvailability() {
			const cutoff = new Date(now().valueOf() - CHAT_AVAILABILITY_WINDOW_MS);
			return {
				status: toAvailabilityStatus(await input.store.getLatestStatusSince(cutoff)),
			};
		},
	};
}

export function createPgChatAvailabilityStore(
	env: Env,
	input: { getDb?: RuntimeDbGetter } = {},
): ChatAvailabilityStore {
	const getDb = input.getDb ?? createRuntimeDbGetter(env);
	return {
		async getLatestStatusSince(since) {
			const rows = await (await getDb())
				.select({ status: turnDispatches.status })
				.from(turnDispatches)
				.where(gte(turnDispatches.createdAt, since))
				.orderBy(desc(turnDispatches.createdAt), desc(turnDispatches.requestId))
				.limit(1);
			return rows[0]?.status ?? null;
		},
	};
}
