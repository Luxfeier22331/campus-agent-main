import { HttpError } from "react-admin";

export function unsupportedMethod(resource: string, method: string): never {
	throw new HttpError(`${resource}.${method} is not implemented in protected-panel-web.`, 405, {
		error: {
			code: "not_implemented",
			message: `${resource}.${method} is not implemented in protected-panel-web.`,
		},
	});
}
