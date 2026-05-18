import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const config = readFileSync(resolve(root, "wrangler.toml"), "utf8");

const requiredSnippets = [
	'name = "public-docs"',
	'main = "src/index.ts"',
	'compatibility_flags = ["nodejs_compat"]',
	"workers_dev = false",
	"preview_urls = false",
	"[[services]]",
	'binding = "APP_API"',
	'service = "app-api"',
	"[[env.staging.routes]]",
	'pattern = "campus-docs-staging.ayafeed.com"',
	"custom_domain = true",
	"[[env.staging.services]]",
	'service = "app-api-staging"',
	'APP_API_BASE_URL = "https://app-api.internal"',
	'PUBLIC_DOCS_HOSTNAME = "campus-docs-staging.ayafeed.com"',
	"[assets]",
	'directory = "./doc_build"',
	'binding = "ASSETS"',
	'not_found_handling = "404-page"',
];

const localSmokeConfig = readFileSync(resolve(root, "wrangler.local-smoke.toml"), "utf8");
const requiredLocalSmokeSnippets = [
	'name = "public-docs"',
	'APP_API_BASE_URL = "https://app-api.internal"',
	'PUBLIC_DOCS_HOSTNAME = "127.0.0.1:27114"',
	"[secrets]",
	"required = []",
];

for (const snippet of requiredSnippets) {
	if (!config.includes(snippet)) {
		console.error(`Missing required public-docs worker config snippet: ${snippet}`);
		process.exit(1);
	}
}

for (const snippet of requiredLocalSmokeSnippets) {
	if (!localSmokeConfig.includes(snippet)) {
		console.error(`Missing required public-docs local-smoke config snippet: ${snippet}`);
		process.exit(1);
	}
}
