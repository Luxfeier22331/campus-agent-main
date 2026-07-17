import {
	buildDiningPublicReadService as buildDomainDiningPublicReadService,
	DiningDomainError,
	type DiningPublicReadService,
	type DiningPublicReadStore,
} from "@campus-agent/dining/domain";

import { AppApiRouteError } from "../../http";

export type { DiningPublicReadService, DiningPublicReadStore } from "@campus-agent/dining/domain";

export function buildDiningPublicReadService(input: {
	store: DiningPublicReadStore;
}): DiningPublicReadService {
	const service = buildDomainDiningPublicReadService(input);
	const wrap =
		<Args extends unknown[], Result>(handler: (...args: Args) => Promise<Result>) =>
		async (...args: Args): Promise<Result> => {
			try {
				return await handler(...args);
			} catch (error) {
				if (error instanceof DiningDomainError) {
					throw new AppApiRouteError({
						code: error.code,
						details: error.details,
						message: error.message,
						retryable: error.retryable,
						status: error.status,
					});
				}
				throw error;
			}
		};
	return {
		getPublication: wrap(service.getPublication.bind(service)),
		getPublishedBootstrap: wrap(service.getPublishedBootstrap.bind(service)),
		getPublishedFloor: wrap(service.getPublishedFloor.bind(service)),
		getPublishedHalls: wrap(service.getPublishedHalls.bind(service)),
		getPublishedOfferingReviews: wrap(service.getPublishedOfferingReviews.bind(service)),
		searchPublishedDining: wrap(service.searchPublishedDining.bind(service)),
	};
}
