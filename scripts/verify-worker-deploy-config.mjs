import { readFile } from "node:fs/promises";

async function main() {
	const [, , configPath, ...assertions] = process.argv;

	if (!configPath || assertions.length === 0) {
		console.error(
			"Usage: node scripts/verify-worker-deploy-config.mjs <wrangler.json> <SERVICE:binding=service-name|VAR:key=value|VAR_ABSENT:key|ROUTE:pattern> [...]",
		);
		process.exit(1);
	}

	const rawConfig = await readFile(configPath, "utf8");
	const config = JSON.parse(rawConfig);
	const services = Array.isArray(config.services) ? config.services : [];
	const vars = config.vars && typeof config.vars === "object" ? config.vars : {};
	const routes = Array.isArray(config.routes) ? config.routes : [];

	for (const assertion of assertions) {
		if (assertion.startsWith("SERVICE:")) {
			const [binding, service] = assertion.slice("SERVICE:".length).split("=", 2);
			const matched = services.some(
				(candidate) => candidate?.binding === binding && candidate?.service === service,
			);

			if (!(binding && service)) {
				console.error(`Invalid service binding specification: ${assertion}`);
				process.exit(1);
			}

			if (!matched) {
				console.error(
					`Missing required service binding ${binding} -> ${service} in ${configPath}.`,
				);
				process.exit(1);
			}
			continue;
		}

		if (assertion.startsWith("VAR:")) {
			const [key, value] = assertion.slice("VAR:".length).split("=", 2);
			if (!key || value === undefined) {
				console.error(`Invalid variable assertion: ${assertion}`);
				process.exit(1);
			}
			if (vars[key] !== value) {
				console.error(
					`Expected variable ${key}=${value} in ${configPath}, got ${String(vars[key])}.`,
				);
				process.exit(1);
			}
			continue;
		}

		if (assertion.startsWith("VAR_ABSENT:")) {
			const key = assertion.slice("VAR_ABSENT:".length).trim();
			if (!key) {
				console.error(`Invalid absent-variable assertion: ${assertion}`);
				process.exit(1);
			}
			if (Object.hasOwn(vars, key)) {
				console.error(`Variable ${key} must be absent in ${configPath}.`);
				process.exit(1);
			}
			continue;
		}

		if (assertion.startsWith("ROUTE:")) {
			const expectedPattern = assertion.slice("ROUTE:".length).trim();
			if (!expectedPattern) {
				console.error(`Invalid route assertion: ${assertion}`);
				process.exit(1);
			}
			const matched = routes.some(
				(route) => route?.pattern === expectedPattern && route?.custom_domain === true,
			);
			if (!matched) {
				console.error(`Missing required custom domain route ${expectedPattern} in ${configPath}.`);
				process.exit(1);
			}
			continue;
		}

		const [binding, service] = assertion.split("=", 2);
		const matched = services.some(
			(candidate) => candidate?.binding === binding && candidate?.service === service,
		);
		if (!(binding && service)) {
			console.error(`Invalid assertion: ${assertion}`);
			process.exit(1);
		}
		if (!matched) {
			console.error(`Missing required service binding ${binding} -> ${service} in ${configPath}.`);
			process.exit(1);
		}
	}
}

await main();
