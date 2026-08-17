import type { Pool } from "pg";
import { createDiningFloorplanAssetStoreFromEnv } from "./dining-floorplan-assets.ts";
import { createPgDiningMenuStore, createUnavailableDiningMenuStore } from "./dining-menu-store.ts";
import {
	createPgDiningReviewStore,
	createUnavailableDiningReviewStore,
} from "./dining-review-store.ts";
import { createPgDiningStore, createUnavailableDiningStore } from "./dining-store.ts";
import type { DiningStoreEnv, DiningStores } from "./dining-store-contract.ts";

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
	};
}

export function createUnavailableDiningStores(error: unknown): DiningStores {
	return {
		map: createUnavailableDiningStore(error),
		menu: createUnavailableDiningMenuStore(error),
		reviews: createUnavailableDiningReviewStore(error),
	};
}
