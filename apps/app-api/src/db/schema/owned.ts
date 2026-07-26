export * from "./campus-groups";
export * from "./docs";
export * from "./profile";
export * from "./runtime";

import * as campusGroups from "./campus-groups";
import * as docs from "./docs";
import * as profile from "./profile";
import * as runtime from "./runtime";

export const appApiOwnedSchema = {
	...docs,
	...campusGroups,
	...profile,
	...runtime,
};
