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

const collectorName = packageMetadata.name?.trim();
const collectorVersion = packageMetadata.version?.trim();
const crawleeVersion = packageMetadata.dependencies?.crawlee?.trim();

if (!collectorName) {
	throw new Error("official-web collector package metadata is missing name");
}
if (!collectorVersion) {
	throw new Error("official-web collector package metadata is missing version");
}
if (!crawleeVersion) {
	throw new Error("official-web collector package metadata is missing crawlee dependency version");
}

export const OFFICIAL_WEB_COLLECTOR_VERSION = `${collectorName}@${collectorVersion}`;
export const OFFICIAL_WEB_FETCHER_NAME = "crawlee_cheerio";
export const OFFICIAL_WEB_FETCHER_VERSION = crawleeVersion;
export const OFFICIAL_WEB_PARSER_SLUG = "cheerio-basic";
export const OFFICIAL_WEB_PARSER_NAME = "cheerio-basic";
export const OFFICIAL_WEB_PARSER_VERSION = OFFICIAL_WEB_COLLECTOR_VERSION;
