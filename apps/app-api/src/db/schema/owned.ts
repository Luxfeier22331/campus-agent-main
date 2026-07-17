export * from "./docs";
export * from "./profile";
export * from "./runtime";

import * as docs from "./docs";
import * as profile from "./profile";
import * as runtime from "./runtime";

export const appApiOwnedSchema = {
	...docs,
	...profile,
	...runtime,
};
