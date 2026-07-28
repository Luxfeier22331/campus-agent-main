export * from "./account-admin";
export * from "./auth";
export * from "./campus-groups";
export * from "./docs";
export * from "./email-access";
export * from "./profile";
export * from "./runtime";

import * as accountAdmin from "./account-admin";
import * as auth from "./auth";
import * as campusGroups from "./campus-groups";
import * as docs from "./docs";
import * as emailAccess from "./email-access";
import * as profile from "./profile";
import * as runtime from "./runtime";

export const appApiOwnedSchema = {
	...accountAdmin,
	...auth,
	...docs,
	...emailAccess,
	...campusGroups,
	...profile,
	...runtime,
};
