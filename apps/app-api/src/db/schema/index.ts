export * from "./auth";
export * from "./campus-services";
export * from "./chat";
export * from "./dining";
export * from "./docs";
export * from "./profile";
export * from "./runtime";

import * as auth from "./auth";
import * as campusServices from "./campus-services";
import * as chat from "./chat";
import * as dining from "./dining";
import * as docs from "./docs";
import * as profile from "./profile";
import * as runtime from "./runtime";

export const appApiSchema = {
	...auth,
	...campusServices,
	...chat,
	...dining,
	...docs,
	...profile,
	...runtime,
};
