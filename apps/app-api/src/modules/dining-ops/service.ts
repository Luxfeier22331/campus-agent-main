import {
	buildDiningOperationsService as buildDomainDiningOperationsService,
	DiningDomainError,
	type DiningOperationsService,
	type DiningOperationsStore,
} from "dining-domain";

import { AppApiRouteError } from "../../http";

export type { DiningOperationsService, DiningOperationsStore } from "dining-domain";
export {
	createInMemoryDiningOperationsStore,
	createProcessDiningOperationsStore,
} from "dining-domain";

export function buildDiningOperationsService(input: {
	store: DiningOperationsStore;
}): DiningOperationsService {
	return wrapDiningDomainErrors(buildDomainDiningOperationsService(input));
}

export function toAppApiRouteError(error: DiningDomainError): AppApiRouteError {
	return new AppApiRouteError({
		code: error.code,
		details: error.details,
		message: error.message,
		retryable: error.retryable,
		status: error.status,
	});
}

function wrapDiningDomainErrors(service: DiningOperationsService): DiningOperationsService {
	const wrap =
		<Args extends unknown[], Result>(
			handler: (...args: Args) => Promise<Result>,
		): ((...args: Args) => Promise<Result>) =>
		async (...args) => {
			try {
				return await handler(...args);
			} catch (error) {
				if (error instanceof DiningDomainError) {
					throw toAppApiRouteError(error);
				}
				throw error;
			}
		};

	return {
		approveReleaseCandidate: wrap(service.approveReleaseCandidate.bind(service)),
		assignWindow: wrap(service.assignWindow.bind(service)),
		cancelReleaseCandidate: wrap(service.cancelReleaseCandidate.bind(service)),
		createMenuItem: wrap(service.createMenuItem.bind(service)),
		createMenuOffering: wrap(service.createMenuOffering.bind(service)),
		createReleaseCandidate: wrap(service.createReleaseCandidate.bind(service)),
		getFloor: wrap(service.getFloor.bind(service)),
		getPublishedFloor: wrap(service.getPublishedFloor.bind(service)),
		getPublishedHallReviews: wrap(service.getPublishedHallReviews.bind(service)),
		getPublishedHalls: wrap(service.getPublishedHalls.bind(service)),
		getRelease: wrap(service.getRelease.bind(service)),
		getReleaseCandidate: wrap(service.getReleaseCandidate.bind(service)),
		listAuditEvents: wrap(service.listAuditEvents.bind(service)),
		listHalls: wrap(service.listHalls.bind(service)),
		listReleaseCandidates: wrap(service.listReleaseCandidates.bind(service)),
		listReleases: wrap(service.listReleases.bind(service)),
		publishReleaseCandidate: wrap(service.publishReleaseCandidate.bind(service)),
		rollbackRelease: wrap(service.rollbackRelease.bind(service)),
		scheduleReleaseCandidate: wrap(service.scheduleReleaseCandidate.bind(service)),
		updateMenuItem: wrap(service.updateMenuItem.bind(service)),
		updateMenuOffering: wrap(service.updateMenuOffering.bind(service)),
		updateWindow: wrap(service.updateWindow.bind(service)),
		updateWindowAssignment: wrap(service.updateWindowAssignment.bind(service)),
		validateReleaseCandidate: wrap(service.validateReleaseCandidate.bind(service)),
	};
}
