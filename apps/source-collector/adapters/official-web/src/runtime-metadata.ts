import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface SourceAdapterPackageMetadata {
	name?: string;
	version?: string;
	dependencies?: Record<string, string>;
}

const adapterRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceCollectorRoot = resolve(adapterRoot, "../..");
const packageMetadata = JSON.parse(
	readFileSync(resolve(sourceCollectorRoot, "package.json"), "utf-8"),
) as SourceAdapterPackageMetadata;

const sourceAdapterName = packageMetadata.name?.trim();
const sourceAdapterVersion = packageMetadata.version?.trim();
const crawleeVersion = packageMetadata.dependencies?.crawlee?.trim();

if (!sourceAdapterName) {
	throw new Error("official-web source adapter package metadata is missing name");
}
if (!sourceAdapterVersion) {
	throw new Error("official-web source adapter package metadata is missing version");
}
if (!crawleeVersion) {
	throw new Error(
		"official-web source adapter package metadata is missing crawlee dependency version",
	);
}

export const OFFICIAL_WEB_SOURCE_ADAPTER_VERSION = `${sourceAdapterName}@${sourceAdapterVersion}`;
export const OFFICIAL_WEB_FETCHER_NAME = "crawlee_cheerio";
export const OFFICIAL_WEB_FETCHER_VERSION = crawleeVersion;
export const OFFICIAL_WEB_PARSER_SLUG = "cheerio-basic";
export const OFFICIAL_WEB_PARSER_NAME = "cheerio-basic";
export const OFFICIAL_WEB_PARSER_VERSION = OFFICIAL_WEB_SOURCE_ADAPTER_VERSION;
