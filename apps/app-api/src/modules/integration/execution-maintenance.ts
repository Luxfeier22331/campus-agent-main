import { AppApiRouteError } from "../../http";

export function requireExecutionAdmission(maintenance: boolean | undefined): void {
	if (maintenance) {
		throw new AppApiRouteError({
			code: "execution_maintenance",
			message: "Execution is temporarily unavailable for maintenance.",
			retryable: false,
			status: 503,
		});
	}
}
