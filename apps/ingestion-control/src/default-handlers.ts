import {
	createAuthenticatedNoticeSourceTruthMaterializeHandler,
	type IngestionObjectStore,
} from "./authenticated-notice-materialize";
import { createOfficialWebSourceTruthMaterializeHandler } from "./official-web-materialize";
import { TsTaskHandlerRegistry } from "./task-executor";

export interface DefaultTsTaskHandlerRegistryOptions {
	authenticatedNoticeObjectStore?: IngestionObjectStore;
	officialWebObjectStore?: IngestionObjectStore;
}

export function createDefaultTsTaskHandlerRegistry(
	options: DefaultTsTaskHandlerRegistryOptions = {},
): TsTaskHandlerRegistry {
	const registry = new TsTaskHandlerRegistry();
	if (options.authenticatedNoticeObjectStore) {
		registry.register(
			{
				sourceFamily: "authenticated_notice",
				corpus: "campus_notices",
				collection: "internal_notice",
				taskKind: "source_truth_materialize",
			},
			createAuthenticatedNoticeSourceTruthMaterializeHandler({
				objectStore: options.authenticatedNoticeObjectStore,
			}),
		);
	}
	if (options.officialWebObjectStore) {
		for (const collection of ["fresh_news", "stable_reference"]) {
			registry.register(
				{
					sourceFamily: "official_web",
					corpus: "official_web",
					collection,
					taskKind: "source_truth_materialize",
				},
				createOfficialWebSourceTruthMaterializeHandler({
					objectStore: options.officialWebObjectStore,
				}),
			);
		}
	}
	return registry;
}
