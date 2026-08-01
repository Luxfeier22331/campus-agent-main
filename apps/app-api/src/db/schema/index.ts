export * from "./account-admin";
export * from "./auth";
export * from "./campus-groups";
export * from "./chat";
export * from "./dining";
export * from "./email-access";
export * from "./profile";
export * from "./runtime";

import * as accountAdmin from "./account-admin";
import * as auth from "./auth";
import * as campusGroups from "./campus-groups";
import * as chat from "./chat";
import * as dining from "./dining";
import * as emailAccess from "./email-access";
import * as profile from "./profile";
import * as runtime from "./runtime";

export const appApiSchema = {
	...accountAdmin,
	...auth,
	...campusGroups,
	...chat,
	...dining,
	...emailAccess,
	...profile,
	...runtime,
};
