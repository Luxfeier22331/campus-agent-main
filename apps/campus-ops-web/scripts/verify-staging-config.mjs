import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const wrangler = readFileSync(resolve("wrangler.toml"), "utf8");

for (const expected of [
	'name = "campus-ops-web-staging"',
	"ops-staging.mucwiki-edge.link",
	'APP_API_BASE_URL = "https://api-staging.mucwiki-edge.link"',
	'service = "app-api-staging"',
]) {
	if (!wrangler.includes(expected)) {
		throw new Error(`campus-ops-web staging wrangler config is missing: ${expected}`);
	}
}

console.log("campus-ops-web staging config verified");
