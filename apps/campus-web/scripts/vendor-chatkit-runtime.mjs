#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const DEFAULT_SOURCE_URL = "https://cdn.platform.openai.com/deployments/chatkit/chatkit.js";
const DEFAULT_OUTPUT_ROOT = "public/vendor/openai-chatkit";
const CDN_RUNTIME_ORIGIN = "https://cdn.platform.openai.com";
const CHATKIT_FRAME_ASSET_PREFIX = "/assets/ck1/";
const REQUIRED_FRAME_ASSET_PATHS = ["assets/ck1/index-PBqDrfdS.js", "assets/ck1/zh-CN-CvLn89AG.js"];
const TEXT_EXTENSIONS = new Set([".css", ".html", ".js", ".json", ".map", ".svg", ".txt"]);
const execFile = promisify(execFileCallback);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const version = requireOption(options.version, "--version");
	const sourceUrl = options.source ?? DEFAULT_SOURCE_URL;
	const outputRoot = path.resolve(appRoot, options.outputRoot ?? DEFAULT_OUTPUT_ROOT);
	const outputDir = path.join(outputRoot, version);
	const stagingDir = path.join(outputRoot, `${version}.tmp-${process.pid}`);
	const sourceBaseUrl = new URL(".", sourceUrl).toString();
	const cookieJar = path.join(os.tmpdir(), `campus-chatkit-vendor-cookies-${process.pid}.txt`);

	const downloadedAt = new Date().toISOString();
	const pending = [new URL(sourceUrl).toString()];
	const seen = new Set();
	const files = [];

	await fs.rm(stagingDir, { force: true, recursive: true });
	await fs.mkdir(stagingDir, { recursive: true });

	try {
		let index = 0;
		while (index < pending.length) {
			const assetUrl = pending[index];
			index += 1;
			if (seen.has(assetUrl)) {
				continue;
			}
			seen.add(assetUrl);

			const downloaded = await downloadAsset(assetUrl, {
				cookieJar,
				seedHtmlPath:
					assetUrl !== sourceUrl && path.extname(new URL(assetUrl).pathname) === ".html"
						? options.seedHtml
						: undefined,
				seedScriptPath: assetUrl === sourceUrl ? options.seedScript : undefined,
			});
			const relativePath = toVendorRelativePath(assetUrl, sourceBaseUrl);
			const bytes = transformDownloadedAsset({
				bytes: downloaded.bytes,
				relativePath,
			});
			await writeAsset(stagingDir, relativePath, bytes);

			const entry = {
				bytes: bytes.byteLength,
				content_type: downloaded.contentType,
				path: relativePath,
				sha256: sha256(bytes),
				source_url: assetUrl,
			};
			files.push(entry);

			for (const referencedUrl of discoverReferencedAssets({
				bytes: downloaded.bytes,
				contentType: downloaded.contentType,
				relativePath,
				sourceUrl: assetUrl,
			})) {
				if (isVendoredRuntimeAsset(referencedUrl, sourceBaseUrl) && !seen.has(referencedUrl)) {
					pending.push(referencedUrl);
				}
			}

			for (const requiredUrl of requiredRuntimeAssetUrls(sourceUrl)) {
				if (!(seen.has(requiredUrl) || pending.includes(requiredUrl))) {
					pending.push(requiredUrl);
				}
			}
		}

		validateDownloadedFiles(files);
		await writeNotice(stagingDir, { sourceUrl, version });
		const manifest = {
			downloaded_at: downloadedAt,
			external_references: collectExternalReferences(files, stagingDir),
			files: files.sort((left, right) => left.path.localeCompare(right.path)),
			required_frame_assets: REQUIRED_FRAME_ASSET_PATHS,
			source: sourceUrl,
			transforms: [
				"removed_cloudflare_challenge_script",
				"removed_favicon_links",
				"rewrote_root_assets_ck1_to_relative_assets_ck1",
				"removed_source_mapping_url_comments",
			],
			version,
		};
		await fs.writeFile(
			path.join(stagingDir, "manifest.json"),
			`${JSON.stringify(manifest, null, 2)}\n`,
		);
		assertNoCdnRuntimeReference(stagingDir, files);

		await fs.rm(outputDir, { force: true, recursive: true });
		await fs.rename(stagingDir, outputDir);
	} catch (error) {
		await fs.rm(stagingDir, { force: true, recursive: true });
		throw error;
	}

	console.log(`Vendored ChatKit runtime ${version} into ${path.relative(appRoot, outputDir)}`);
}

function parseArgs(args) {
	const options = {};
	let index = 0;
	while (index < args.length) {
		const token = args[index];
		index += 1;
		if (token === "--version") {
			options.version = args[index];
			index += 1;
			continue;
		}
		if (token === "--source") {
			options.source = args[index];
			index += 1;
			continue;
		}
		if (token === "--seed-script") {
			options.seedScript = args[index];
			index += 1;
			continue;
		}
		if (token === "--seed-html") {
			options.seedHtml = args[index];
			index += 1;
			continue;
		}
		if (token === "--output-root") {
			options.outputRoot = args[index];
			index += 1;
			continue;
		}
		throw new Error(`unknown argument: ${token}`);
	}
	return options;
}

function requireOption(value, label) {
	if (!value || typeof value !== "string") {
		throw new Error(`missing required option ${label}`);
	}
	if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) {
		throw new Error(`${label} must use YYYY-MM-DD`);
	}
	return value;
}

async function downloadAsset(url, options = {}) {
	if (options.seedScriptPath) {
		const bytes = await fs.readFile(options.seedScriptPath);
		if (bytes.byteLength === 0) {
			throw new Error(`seed script is empty: ${options.seedScriptPath}`);
		}
		return { bytes, contentType: "application/javascript" };
	}
	if (options.seedHtmlPath) {
		const bytes = await fs.readFile(options.seedHtmlPath);
		if (bytes.byteLength === 0) {
			throw new Error(`seed HTML is empty: ${options.seedHtmlPath}`);
		}
		return { bytes, contentType: "text/html" };
	}

	const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "campus-chatkit-vendor-"));
	const outputPath = path.join(tempDir, "asset");
	let stdout = "";
	let bytes;
	try {
		const result = await execFile(
			"curl",
			[
				"--fail",
				"--location",
				"--silent",
				"--show-error",
				"--max-time",
				"300",
				"--cookie-jar",
				options.cookieJar,
				"--cookie",
				options.cookieJar,
				"--header",
				`accept: ${expectedAcceptHeader(url)}`,
				"--output",
				outputPath,
				"--write-out",
				"%{content_type}",
				url,
			],
			{ maxBuffer: 1024 * 1024 },
		);
		stdout = result.stdout;
		bytes = await fs.readFile(outputPath);
	} catch (error) {
		throw new Error(`failed to download ${url}: ${error.message}`);
	} finally {
		await fs.rm(tempDir, { force: true, recursive: true });
	}
	const contentType = stdout.split(";")[0]?.trim() ?? "";
	if (bytes.byteLength === 0) {
		throw new Error(`downloaded empty asset: ${url}`);
	}
	validateContentType(url, contentType);
	return { bytes, contentType };
}

function expectedAcceptHeader(url) {
	const extension = path.extname(new URL(url).pathname).toLowerCase();
	if (extension === ".html") {
		return "text/html,*/*";
	}
	if (extension === ".css") {
		return "text/css,*/*";
	}
	if (extension === ".js") {
		return "application/javascript,text/javascript,*/*";
	}
	return "*/*";
}

function validateContentType(url, contentType) {
	const extension = path.extname(new URL(url).pathname).toLowerCase();
	const allowed = {
		".css": ["text/css"],
		".html": ["text/html"],
		".js": ["application/javascript", "text/javascript"],
		".json": ["application/json", "text/plain"],
		".map": ["application/json", "text/plain"],
		".svg": ["image/svg+xml", "text/plain"],
	};
	const accepted = allowed[extension];
	if (accepted && !accepted.includes(contentType)) {
		throw new Error(`unexpected content-type for ${url}: ${contentType || "missing"}`);
	}
	if (!contentType) {
		throw new Error(`missing content-type for ${url}`);
	}
}

function toVendorRelativePath(assetUrl, sourceBaseUrl) {
	const sourceBase = new URL(sourceBaseUrl);
	const parsed = new URL(assetUrl);
	if (parsed.origin !== sourceBase.origin) {
		throw new Error(`asset is outside ChatKit runtime directory: ${assetUrl}`);
	}
	const relativePath = parsed.pathname.startsWith(sourceBase.pathname)
		? decodeURIComponent(parsed.pathname.slice(sourceBase.pathname.length))
		: decodeURIComponent(parsed.pathname.replace(/^\//, ""));
	if (!relativePath || relativePath.includes("..") || path.isAbsolute(relativePath)) {
		throw new Error(`unsafe asset path from ${assetUrl}`);
	}
	return relativePath;
}

function transformDownloadedAsset({ bytes, relativePath }) {
	const extension = path.extname(relativePath).toLowerCase();
	if (!TEXT_EXTENSIONS.has(extension)) {
		return bytes;
	}
	let text = bytes.toString("utf8");
	if (extension === ".html") {
		text = stripCloudflareChallengeScript(text);
		text = text.replace(/\s*<link rel="icon"[^>]+>/g, "");
		text = text.replaceAll('href="/assets/ck1/', 'href="assets/ck1/');
		text = text.replaceAll('src="/assets/ck1/', 'src="assets/ck1/');
	}
	if (extension === ".css" || extension === ".js") {
		text = text.replaceAll('"/assets/ck1/', '"assets/ck1/');
		text = text.replaceAll("'/assets/ck1/", "'assets/ck1/");
		text = text.replaceAll("url(/assets/ck1/", "url(assets/ck1/");
	}
	if (extension === ".js") {
		text = text.replace(/\n?\/\/# sourceMappingURL=[^\n]+/g, "");
	}
	return Buffer.from(text, "utf8");
}

function stripCloudflareChallengeScript(html) {
	return html.replace(
		/\s*<script>\(function\(\)\{function c\(\)\{[\s\S]*?__CF\$cv[\s\S]*?<\/script>/g,
		"",
	);
}

async function writeAsset(outputDir, relativePath, bytes) {
	const targetPath = path.join(outputDir, relativePath);
	if (!targetPath.startsWith(outputDir + path.sep)) {
		throw new Error(`unsafe output path: ${relativePath}`);
	}
	await fs.mkdir(path.dirname(targetPath), { recursive: true });
	await fs.writeFile(targetPath, bytes);
}

function discoverReferencedAssets({ bytes, contentType, relativePath, sourceUrl }) {
	const extension = path.extname(relativePath).toLowerCase();
	if (!isTextAsset(extension, contentType)) {
		return [];
	}
	const text = bytes.toString("utf8");
	const references = new Set();

	if (relativePath === "chatkit.js") {
		for (const match of text.matchAll(/["']([^"']+\.html)["']/g)) {
			addReference(references, match[1], sourceUrl);
		}
		return Array.from(references);
	}

	if (extension === ".html") {
		for (const match of text.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)) {
			addReference(references, match[1], sourceUrl);
		}
		return Array.from(references);
	}

	if (extension === ".css") {
		for (const match of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
			addReference(references, match[1], sourceUrl);
		}
	}

	return Array.from(references);
}

function isTextAsset(extension, contentType) {
	return TEXT_EXTENSIONS.has(extension) || contentType.startsWith("text/");
}

function addReference(references, rawReference, sourceUrl) {
	if (!rawReference || rawReference.startsWith("data:") || rawReference.startsWith("#")) {
		return;
	}
	const normalized = rawReference.split("#")[0]?.split("?")[0];
	if (!normalized) {
		return;
	}
	if (/[${}]/.test(normalized)) {
		return;
	}
	if (/\.(ico|png|svg)$/i.test(normalized) && normalized.includes("favicon")) {
		return;
	}
	try {
		references.add(new URL(normalized, sourceUrl).toString());
	} catch {
		throw new Error(`invalid asset reference ${rawReference} in ${sourceUrl}`);
	}
}

function isVendoredRuntimeAsset(assetUrl, sourceBaseUrl) {
	const parsed = new URL(assetUrl);
	const base = new URL(sourceBaseUrl);
	return (
		parsed.origin === base.origin &&
		(parsed.pathname.startsWith(base.pathname) ||
			parsed.pathname.startsWith(CHATKIT_FRAME_ASSET_PREFIX))
	);
}

function requiredRuntimeAssetUrls(sourceUrl) {
	const source = new URL(sourceUrl);
	return REQUIRED_FRAME_ASSET_PATHS.map((assetPath) => {
		const normalizedPath = assetPath.startsWith("/") ? assetPath : `/${assetPath}`;
		return new URL(normalizedPath, source.origin).toString();
	});
}

function validateDownloadedFiles(files) {
	const paths = new Set(files.map((file) => file.path));
	if (!paths.has("chatkit.js")) {
		throw new Error("vendored ChatKit runtime is missing chatkit.js");
	}
	if (![...paths].some((filePath) => /^index-[A-Za-z0-9_-]+\.html$/.test(filePath))) {
		throw new Error("vendored ChatKit runtime is missing index-*.html iframe asset");
	}
	for (const requiredPath of REQUIRED_FRAME_ASSET_PATHS) {
		if (!paths.has(requiredPath)) {
			throw new Error(`vendored ChatKit runtime is missing required frame asset: ${requiredPath}`);
		}
	}
	for (const file of files) {
		if (file.bytes <= 0) {
			throw new Error(`manifest file entry is empty: ${file.path}`);
		}
	}
}

function collectExternalReferences(files, outputDir) {
	const references = new Set();
	for (const file of files) {
		const extension = path.extname(file.path).toLowerCase();
		if (!TEXT_EXTENSIONS.has(extension)) {
			continue;
		}
		const text = readFileSync(path.join(outputDir, file.path), "utf8");
		for (const match of text.matchAll(/https?:\/\/[^"'`\s)]+/g)) {
			references.add(match[0]);
		}
	}
	return Array.from(references).sort();
}

function assertNoCdnRuntimeReference(outputDir, files) {
	for (const file of files) {
		const extension = path.extname(file.path).toLowerCase();
		if (!TEXT_EXTENSIONS.has(extension)) {
			continue;
		}
		const text = readFileSync(path.join(outputDir, file.path), "utf8");
		if (text.includes(CDN_RUNTIME_ORIGIN)) {
			throw new Error(`vendored asset still references ${CDN_RUNTIME_ORIGIN}: ${file.path}`);
		}
	}
}

async function writeNotice(outputDir, { sourceUrl, version }) {
	await fs.writeFile(
		path.join(outputDir, "NOTICE.md"),
		[
			"# OpenAI ChatKit Runtime Mirror",
			"",
			`Version: ${version}`,
			`Source: ${sourceUrl}`,
			"",
			"This directory contains a self-hosted mirror of the OpenAI ChatKit browser runtime used by campus-web.",
			"It is not the official npm runtime package.",
			"The vendoring script removes Cloudflare challenge injection, favicon links, and source map comments, and rewrites root /assets/ck1/ references to relative assets/ck1/ references.",
			"Update this mirror manually and review the generated manifest before committing changes.",
			"",
		].join("\n"),
	);
}

function sha256(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
