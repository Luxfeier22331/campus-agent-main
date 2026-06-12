import { AppApiRouteError } from "../../http";

import type {
	DiningMenuItem,
	DiningMenuOffering,
	DiningOperationsState,
	DiningStallProfile,
	DiningWindow,
	DiningWindowAssignment,
} from "./types";

export function requireWindow(state: DiningOperationsState, windowId: string): DiningWindow {
	const window = state.windows.find((item) => item.windowId === windowId);
	if (!window) {
		throw new AppApiRouteError({
			code: "dining_window_not_found",
			message: "Dining window was not found.",
			retryable: false,
			status: 404,
		});
	}
	return window;
}

export function requireAssignment(
	state: DiningOperationsState,
	assignmentId: string,
): DiningWindowAssignment {
	const assignment = state.assignments.find((item) => item.assignmentId === assignmentId);
	if (!assignment) {
		throw new AppApiRouteError({
			code: "dining_assignment_not_found",
			message: "Dining window assignment was not found.",
			retryable: false,
			status: 404,
		});
	}
	return assignment;
}

export function requireMenuItem(state: DiningOperationsState, menuItemId: string): DiningMenuItem {
	const menuItem = state.menuItems.find((item) => item.menuItemId === menuItemId);
	if (!menuItem) {
		throw new AppApiRouteError({
			code: "dining_menu_item_not_found",
			message: "Dining menu item was not found.",
			retryable: false,
			status: 404,
		});
	}
	return menuItem;
}

export function requireMenuOffering(
	state: DiningOperationsState,
	offeringId: string,
): DiningMenuOffering {
	const offering = state.menuOfferings.find((item) => item.offeringId === offeringId);
	if (!offering) {
		throw new AppApiRouteError({
			code: "dining_menu_offering_not_found",
			message: "Dining menu offering was not found.",
			retryable: false,
			status: 404,
		});
	}
	return offering;
}

export function requireStallProfile(
	state: DiningOperationsState,
	stallProfileId: string,
): DiningStallProfile {
	const stallProfile = state.stallProfiles.find((item) => item.stallProfileId === stallProfileId);
	if (!stallProfile) {
		throw new AppApiRouteError({
			code: "dining_stall_profile_not_found",
			message: "Dining stall profile was not found.",
			retryable: false,
			status: 404,
		});
	}
	return stallProfile;
}

export function definedFields<T extends Record<string, unknown>>(input: T): Partial<T> {
	return Object.fromEntries(
		Object.entries(input).filter(([, value]) => value !== undefined),
	) as Partial<T>;
}
