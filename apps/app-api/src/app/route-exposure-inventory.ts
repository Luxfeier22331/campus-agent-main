import { APP_API_BROWSER_ROUTE_EXPOSURE_INVENTORY } from "./route-exposure-browser-inventory";
import { APP_API_MACHINE_ROUTE_EXPOSURE_INVENTORY } from "./route-exposure-machine-inventory";
import { APP_API_OPERATOR_ROUTE_EXPOSURE_INVENTORY } from "./route-exposure-operator-inventory";
import type { AppApiRouteExposure } from "./route-exposure-types";

export const APP_API_ROUTE_EXPOSURE_INVENTORY = [
	...APP_API_BROWSER_ROUTE_EXPOSURE_INVENTORY,
	...APP_API_OPERATOR_ROUTE_EXPOSURE_INVENTORY,
	...APP_API_MACHINE_ROUTE_EXPOSURE_INVENTORY,
] as const satisfies readonly AppApiRouteExposure[];
