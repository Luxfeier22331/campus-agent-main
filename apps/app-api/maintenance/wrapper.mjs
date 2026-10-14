// Temporary release adapter. The selected application bundle is never rewritten.
const MODES = new Set(["drain", "frozen", "verify"]);
const internal = (path) =>
	/^\/api\/internal\/(agent\/runs|profile-memory\/commands)(\/|$)/u.test(path);
export function executionRoute(path, method) {
	return (
		/^\/api\/(chat|history|me\/profile-memory)(\/|$)/u.test(path) ||
		/^\/api\/account\/delete(\/|$)/u.test(path) ||
		internal(path) ||
		/^\/api\/internal\/admin\/chat-(conversations|feedback)(\/|$)/u.test(path) ||
		/^\/api\/auth\/(delete-user|delete-user\/callback)(\/|$)/u.test(path) ||
		(method !== "GET" &&
			/^\/api\/internal\/admin\/users\/[^/]+\/(delete|disable|ban|erase)(\/|$)/u.test(path))
	);
}
function existingWork(path, method) {
	return (
		method === "GET" ||
		internal(path) ||
		/^\/api\/chat\/requests\/[^/]+\/(cancel|client-timing)$/u.test(path)
	);
}
export function wrapMaintenance(original, mode) {
	if (!MODES.has(mode)) {
		throw new Error("Unknown execution maintenance mode");
	}
	return {
		...original,
		fetch(request, env, context) {
			const path = new URL(request.url).pathname;
			const affected = executionRoute(path, request.method);
			const allowed =
				mode === "drain" ? existingWork(path, request.method) : mode === "verify" && internal(path);
			if (affected && !allowed) {
				return Response.json(
					{
						error: {
							code: "execution_maintenance",
							message: "Execution is temporarily unavailable for maintenance.",
							retryable: false,
						},
					},
					{ status: 503 },
				);
			}
			return original.fetch(request, { ...env, EXECUTION_MAINTENANCE: "true" }, context);
		},
		scheduled(controller, env, context) {
			// Existing runtime gates Memory/account dispatch on this credential. Other
			// scheduled jobs remain enabled; no old-schema worker is called while frozen.
			const bindings = mode === "drain" ? env : { ...env, EDGE_INGRESS_SHARED_SECRET: "" };
			return original.scheduled?.(
				controller,
				{ ...bindings, EXECUTION_MAINTENANCE: "true" },
				context,
			);
		},
	};
}
