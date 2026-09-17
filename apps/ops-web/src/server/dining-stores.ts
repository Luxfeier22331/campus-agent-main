import type { Pool } from "pg";
import { createDiningFloorplanAssetStoreFromEnv } from "./dining-floorplan-assets.ts";
import { createPgDiningMenuStore, createUnavailableDiningMenuStore } from "./dining-menu-store.ts";
import {
	createPgDiningReviewStore,
	createUnavailableDiningReviewStore,
} from "./dining-review-store.ts";
import { createPgDiningStore, createUnavailableDiningStore } from "./dining-store.ts";
import type { DiningStoreEnv, DiningStores } from "./dining-store-contract.ts";
import { createDiningSubmissionAssetStoreFromEnv } from "./dining-submission-assets.ts";
import {
	createPgDiningSubmissionStore,
	createUnavailableDiningSubmissionStore,
} from "./dining-submission-store.ts";

export function createDiningStores(input: {
	env: DiningStoreEnv;
	pool: Pick<Pool, "connect" | "query">;
}): DiningStores {
	let map: DiningStores["map"];
	try {
		map = createPgDiningStore({
			assetStore: createDiningFloorplanAssetStoreFromEnv(input.env),
			pool: input.pool,
		});
	} catch (error) {
		map = createUnavailableDiningStore(error);
	}
	return {
		map,
		menu: createPgDiningMenuStore({ pool: input.pool }),
		reviews: createPgDiningReviewStore({ pool: input.pool }),
		submissions: createPgDiningSubmissionStore({
			pool: input.pool,
			assets: createDiningSubmissionAssetStoreFromEnv(input.env),
		}),
	};
}

export function createUnavailableDiningStores(error: unknown): DiningStores {
	return {
		map: createUnavailableDiningStore(error),
		menu: createUnavailableDiningMenuStore(error),
		reviews: createUnavailableDiningReviewStore(error),
		submissions: createUnavailableDiningSubmissionStore(error),
	};
}
