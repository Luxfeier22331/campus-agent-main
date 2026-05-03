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

const configPath = new URL("../dist/public_chat_web/wrangler.json", import.meta.url);
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
	vars.PUBLIC_CHAT_HOSTNAME,
	"campus-chat-staging.ayafeed.com",
	"Built staging config must keep PUBLIC_CHAT_HOSTNAME fixed.",
);
expectEqual(
	vars.SENTRY_ENVIRONMENT,
	"staging",
	"Built staging config must keep SENTRY_ENVIRONMENT fixed.",
);
expectAbsent(
	vars,
	"AUTH_TURNSTILE_SITE_KEY",
	"AUTH_TURNSTILE_SITE_KEY must not remain as a repo-fixed staging var in built config.",
);
expectAbsent(
	vars,
	"AUTH_TURNSTILE_APPEARANCE",
	"AUTH_TURNSTILE_APPEARANCE must not remain as a repo-fixed staging var in built config.",
);
expectAbsent(
	vars,
	"AUTH_TURNSTILE_EXECUTION",
	"AUTH_TURNSTILE_EXECUTION must not remain as a repo-fixed staging var in built config.",
);
expectAbsent(
	vars,
	"SENTRY_RELEASE",
	"SENTRY_RELEASE must not remain as a static staging var in built config.",
);

const hasRoute = routes.some((route) => route?.pattern === "campus-chat-staging.ayafeed.com");
if (!hasRoute) {
	fail("Missing required campus-chat-staging.ayafeed.com route in built staging config.");
}
