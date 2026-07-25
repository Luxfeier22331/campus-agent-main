import bootstrapJson from "./bootstrap-floorplans.v1.json" with { type: "json" };
import { canonicalizeDiningFloorplanBundle, type DiningFloorplanBundleV1 } from "./bundle.ts";

export const DINING_BOOTSTRAP_FLOORPLANS: DiningFloorplanBundleV1 =
	canonicalizeDiningFloorplanBundle(bootstrapJson);
