import { readFile } from "node:fs/promises";

function fail(message) {
	console.error(message);
	process.exit(1);
}

function expectEqual(actual, expected, message) {
	if (actual !== expected) {
		fail(`${message} Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
	}
}

function expectAbsent(record, key, message) {
	if (Object.hasOwn(record, key)) {
		fail(message);
	}
}

const configPath = new URL("../dist/campus_web/wrangler.json", import.meta.url);
const rawConfig = await readFile(configPath, "utf8");
const config = JSON.parse(rawConfig);
const services = Array.isArray(config.services) ? config.services : [];
const vars = config.vars && typeof config.vars === "object" ? config.vars : {};
const routes = Array.isArray(config.routes) ? config.routes : [];

const hasAppApiService = services.some(
	(service) => service?.binding === "APP_API" && service?.service === "app-api-staging",
);

if (!hasAppApiService) {
	fail("Missing required service binding APP_API -> app-api-staging in built staging config.");
}

expectEqual(
	vars.APP_API_BASE_URL,
	"https://app-api.internal",
	"Built staging config must keep APP_API_BASE_URL fixed.",
);
expectEqual(
	vars.CAMPUS_WEB_HOSTNAME,
	"campus-staging.mucwiki-edge.link",
	"Built staging config must keep CAMPUS_WEB_HOSTNAME fixed.",
);
expectEqual(
	vars.HUB_WEB_ORIGIN,
	"https://hub-staging.mucwiki-edge.link",
	"Built staging config must keep HUB_WEB_ORIGIN fixed.",
);
expectEqual(
	vars.SENTRY_ENVIRONMENT,
	"staging",
	"Built staging config must keep SENTRY_ENVIRONMENT fixed.",
);
expectAbsent(
	vars,
	"SENTRY_RELEASE",
	"SENTRY_RELEASE must not remain as a static staging var in built config.",
);

const hasRoute = routes.some(
	(route) => route?.pattern === "campus-staging.mucwiki-edge.link" && route?.custom_domain === true,
);
if (!hasRoute) {
	fail(
		"Missing required campus-staging.mucwiki-edge.link custom domain route in built staging config.",
	);
}
