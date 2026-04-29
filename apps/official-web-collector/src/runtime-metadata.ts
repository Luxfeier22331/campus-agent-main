import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface CollectorPackageMetadata {
	name?: string;
	version?: string;
	dependencies?: Record<string, string>;
}

const packageMetadata = JSON.parse(
	readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../package.json"), "utf-8"),
) as CollectorPackageMetadata;

export const OFFICIAL_WEB_COLLECTOR_VERSION = `${packageMetadata.name ?? "official-web-collector"}@${packageMetadata.version ?? "0.0.0"}`;
export const OFFICIAL_WEB_FETCHER_NAME = "crawlee_cheerio";
export const OFFICIAL_WEB_FETCHER_VERSION = packageMetadata.dependencies?.crawlee ?? "unknown";
export const OFFICIAL_WEB_PARSER_SLUG = "cheerio-basic";
export const OFFICIAL_WEB_PARSER_NAME = "cheerio-basic";
export const OFFICIAL_WEB_PARSER_VERSION = OFFICIAL_WEB_COLLECTOR_VERSION;
