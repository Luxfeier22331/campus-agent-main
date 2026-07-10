import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface WranglerConfig {
	routes?: unknown;
	services?: unknown;
	vars?: unknown;
}

interface ServiceBinding {
	binding?: unknown;
	service?: unknown;
}

interface RouteConfig {
	custom_domain?: unknown;
	pattern?: unknown;
}

function fail(message: string): number {
	console.error(message);
	return 1;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
	const [configPath, ...assertions] = argv;

	if (!configPath || assertions.length === 0) {
		return fail(
			"Usage: pnpm exec tsx scripts/deploy/verify-worker-deploy-config.ts <wrangler.json> <SERVICE:binding=service-name|VAR:key=value|VAR_ABSENT:key|ROUTE:pattern> [...]",
		);
	}

	const rawConfig = await readFile(configPath, "utf8");
	const config = JSON.parse(rawConfig) as WranglerConfig;
	const services: ServiceBinding[] = Array.isArray(config.services) ? config.services : [];
	const vars: Record<string, unknown> =
		config.vars && typeof config.vars === "object" && !Array.isArray(config.vars)
			? (config.vars as Record<string, unknown>)
			: {};
	const routes: RouteConfig[] = Array.isArray(config.routes) ? config.routes : [];

	for (const assertion of assertions) {
		if (assertion.startsWith("SERVICE:")) {
			const [binding, service] = assertion.slice("SERVICE:".length).split("=", 2);
			const matched = services.some(
				(candidate) => candidate?.binding === binding && candidate?.service === service,
			);

			if (!(binding && service)) {
				return fail(`Invalid service binding specification: ${assertion}`);
			}

			if (!matched) {
				return fail(`Missing required service binding ${binding} -> ${service} in ${configPath}.`);
			}
			continue;
		}

		if (assertion.startsWith("VAR:")) {
			const [key, value] = assertion.slice("VAR:".length).split("=", 2);
			if (!key || value === undefined) {
				return fail(`Invalid variable assertion: ${assertion}`);
			}
			if (vars[key] !== value) {
				return fail(
					`Expected variable ${key}=${value} in ${configPath}, got ${String(vars[key])}.`,
				);
			}
			continue;
		}

		if (assertion.startsWith("VAR_ABSENT:")) {
			const key = assertion.slice("VAR_ABSENT:".length).trim();
			if (!key) {
				return fail(`Invalid absent-variable assertion: ${assertion}`);
			}
			if (Object.hasOwn(vars, key)) {
				return fail(`Variable ${key} must be absent in ${configPath}.`);
			}
			continue;
		}

		if (assertion.startsWith("ROUTE:")) {
			const expectedPattern = assertion.slice("ROUTE:".length).trim();
			if (!expectedPattern) {
				return fail(`Invalid route assertion: ${assertion}`);
			}
			const matched = routes.some(
				(route) => route?.pattern === expectedPattern && route?.custom_domain === true,
			);
			if (!matched) {
				return fail(`Missing required custom domain route ${expectedPattern} in ${configPath}.`);
			}
			continue;
		}

		const [binding, service] = assertion.split("=", 2);
		const matched = services.some(
			(candidate) => candidate?.binding === binding && candidate?.service === service,
		);
		if (!(binding && service)) {
			return fail(`Invalid assertion: ${assertion}`);
		}
		if (!matched) {
			return fail(`Missing required service binding ${binding} -> ${service} in ${configPath}.`);
		}
	}
	return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	main(process.argv.slice(2))
		.then((code) => process.exit(code))
		.catch((error) => {
			console.error(error instanceof Error ? error.message : String(error));
			process.exit(1);
		});
}
