import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(scriptDir, "../../..");
const PUBLIC_DOCS_ROOT = "apps/public-docs/docs";
const TRACKED_GENERATED_PATH_PREFIXES = [
	`${PUBLIC_DOCS_ROOT}/.components/`,
	`${PUBLIC_DOCS_ROOT}/.generated/`,
	`${PUBLIC_DOCS_ROOT}/campus-regulations/`,
	`${PUBLIC_DOCS_ROOT}/curriculum-plan/`,
	`${PUBLIC_DOCS_ROOT}/docs/`,
	`${PUBLIC_DOCS_ROOT}/public/course-maps/`,
	`${PUBLIC_DOCS_ROOT}/student-handbook/`,
	"apps/public-docs/src/generated/",
] as const;
const STALE_RSPRESS_SAMPLE_DIRS = [`${PUBLIC_DOCS_ROOT}/api`, `${PUBLIC_DOCS_ROOT}/guide`] as const;
const LEGACY_GROUPED_ROUTE_ROOTS = [
	`${PUBLIC_DOCS_ROOT}/student-handbook`,
	`${PUBLIC_DOCS_ROOT}/curriculum-plan`,
	`${PUBLIC_DOCS_ROOT}/campus-regulations`,
] as const;
const COLLECTION_GROUP_ROOTS = [
	`${PUBLIC_DOCS_ROOT}/student-handbook`,
	`${PUBLIC_DOCS_ROOT}/curriculum-plan`,
] as const;
const CONFLICT_MARKERS = ["<<<<<<<", "=======", ">>>>>>>"];
const INTERNAL_LOCATOR_MARKERS = ["campusrag://", "campus-rag-derived", "minio://", "s3://"];
const RESTRICTED_PUBLIC_DOCS_MARKERS = ["institutional_rules", "scoped_rules", "internal_notice"];
const DOCUMENT_KINDS = new Set([
	"home",
	"collectionLanding",
	"studentHandbookArticle",
	"publicRegulation",
	"curriculumPlan",
	"workflow",
]);
const READER_LAYOUTS = new Set(["landing", "article", "reference", "tabular", "graph"]);
const READER_MEASURES = new Set(["standard", "wide", "full"]);
const READER_OUTLINES = new Set(["none", "document", "compact"]);
const OBSOLETE_READER_PROFILE_MESSAGE =
	"frontmatter must use documentKind, readerLayout, readerMeasure, and readerOutline; readerProfile is obsolete";
const CJK_CONTEXT_HALFWIDTH_PUNCTUATION_RE =
	/[\u3400-\u9fff]{1,8}[,.:;?!]|[,.:;?!][\u3400-\u9fff]{1,8}/g;
const CJK_CONTEXT_HALFWIDTH_PARENTHESES_RE =
	/\([^\n)]*[\u3400-\u9fff][^\n)]*\)|\([一二三四五六七八九十百千万〇零]{1,6}\)|\(\d{1,2}\)|(?<=[\u3400-\u9fff])\([^()\n]{1,32}\)|\([^()\n]{1,32}\)(?=[\u3400-\u9fff])/g;
const HALFWIDTH_LABEL_COLON_RE =
	/(?:备注|课程类|课程号|课程名称|学分|学时|实践学时|开设学期|修读学期|学制|总学分|授予学位|学位授予):/g;
const PROTECTED_PUBLICATION_TEXT_SPAN_RE =
	/https?:\/\/[^\s<>'"，,。；;：:！）)]+|www\.[^\s<>'"，,。；;：:！）)]+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|\b(?:doc_id|sha256|source_artifact_id|source_pdf|version_id|rawAssetId|rawVersionId):[A-Za-z0-9_./:-]+/g;

export interface PublicDocsGeneratedIssue {
	path: string;
	message: string;
}

export function publicDocsGeneratedFiles(input: { root?: string } = {}): string[] {
	const root = input.root ?? REPO_ROOT;
	const docsRoot = resolve(root, PUBLIC_DOCS_ROOT);
	if (!existsSync(docsRoot)) {
		return [];
	}
	return walkFiles(docsRoot)
		.filter((path) => {
			const decoded = relative(root, path).replaceAll("\\", "/");
			return isPublicDocsGeneratedCandidate(decoded) && existsSync(path);
		})
		.sort();
}

export function validatePublicDocsGeneratedFile(
	path: string,
	input: { root?: string } = {},
): PublicDocsGeneratedIssue[] {
	const root = input.root ?? REPO_ROOT;
	const issues: PublicDocsGeneratedIssue[] = [];
	const text = readFileSync(path, "utf-8");
	if (!text.trim()) {
		return [{ path, message: "empty generated document" }];
	}
	issues.push(...conflictMarkerIssues(path, text), ...restrictedMarkerIssues(path, text));
	const split = splitFrontmatter(text);
	if (split.error) {
		issues.push({ path, message: split.error });
		return issues;
	}
	const metadata = parseSimpleFrontmatter(split.frontmatter);
	if (!metadata.ok) {
		issues.push({ path, message: metadata.message });
		return issues;
	}
	const title = metadata.value.title;
	const pageType = metadata.value.pageType;
	if (!title?.trim() && pageType !== "home") {
		issues.push({ path, message: "frontmatter must include non-empty title or pageType: home" });
	}
	if (!split.body.trim() && pageType !== "home") {
		issues.push({ path, message: "missing generated document body" });
	}
	if (metadata.value.readerProfile) {
		issues.push({ path, message: OBSOLETE_READER_PROFILE_MESSAGE });
	}
	if (!(metadata.value.documentKind && DOCUMENT_KINDS.has(metadata.value.documentKind))) {
		issues.push({ path, message: "frontmatter must include a valid documentKind" });
	}
	if (!(metadata.value.readerLayout && READER_LAYOUTS.has(metadata.value.readerLayout))) {
		issues.push({ path, message: "frontmatter must include a valid readerLayout" });
	}
	if (!(metadata.value.readerMeasure && READER_MEASURES.has(metadata.value.readerMeasure))) {
		issues.push({ path, message: "frontmatter must include a valid readerMeasure" });
	}
	if (!(metadata.value.readerOutline && READER_OUTLINES.has(metadata.value.readerOutline))) {
		issues.push({ path, message: "frontmatter must include a valid readerOutline" });
	}
	if (
		isGeneratedDocumentDetailPath(relative(root, path).replaceAll("\\", "/")) &&
		!hasDocumentMetaPanel(split.body)
	) {
		issues.push({
			path,
			message: "generated detail document must include visible source metadata",
		});
	}
	if (hasRawDocumentMetaPanelComponent(split.body)) {
		issues.push({
			path,
			message: "generated source metadata must use static HTML, not a raw React component tag",
		});
	}
	if (isGeneratedDocumentDetailPath(relative(root, path).replaceAll("\\", "/"))) {
		issues.push(...publicationTextNormalizationIssues(path, split.body));
	}
	return issues;
}

export function validatePublicDocsGeneratedFiles(
	input: { paths?: string[]; root?: string } = {},
): PublicDocsGeneratedIssue[] {
	const paths = input.paths ?? publicDocsGeneratedFiles({ root: input.root });
	return [
		...validatePublicDocsGeneratedTree({ root: input.root }),
		...paths.flatMap((path) => validatePublicDocsGeneratedFile(path, { root: input.root })),
	];
}

export function publicDocsTrackedFiles(input: { root?: string } = {}): string[] {
	const root = input.root ?? REPO_ROOT;
	const result = spawnSync("git", ["-C", root, "ls-files", "-z"], {
		encoding: "utf-8",
	});
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		throw new Error(result.stderr.trim() || "git ls-files failed");
	}
	return result.stdout.split("\0").filter(Boolean).sort();
}

export function validatePublicDocsTrackedPaths(
	trackedPaths: readonly string[],
	input: { root?: string } = {},
): PublicDocsGeneratedIssue[] {
	const root = input.root ?? REPO_ROOT;
	return trackedPaths
		.filter((path) => TRACKED_GENERATED_PATH_PREFIXES.some((prefix) => path.startsWith(prefix)))
		.map((path) => ({
			message: `generated public-docs content must not be tracked: ${path}`,
			path: resolve(root, path),
		}));
}

export function validatePublicDocsGeneratedTree(
	input: { root?: string } = {},
): PublicDocsGeneratedIssue[] {
	const root = input.root ?? REPO_ROOT;
	const issues: PublicDocsGeneratedIssue[] = [];
	for (const staleDir of STALE_RSPRESS_SAMPLE_DIRS) {
		const absolutePath = resolve(root, staleDir);
		if (existsSync(absolutePath)) {
			issues.push({
				message: `contains stale Rspress sample docs directory: ${staleDir}`,
				path: absolutePath,
			});
		}
	}
	const docsRoot = resolve(root, PUBLIC_DOCS_ROOT);
	if (!existsSync(docsRoot)) {
		return issues;
	}
	for (const legacyRoot of LEGACY_GROUPED_ROUTE_ROOTS) {
		const absolutePath = resolve(root, legacyRoot);
		if (existsSync(absolutePath)) {
			issues.push({
				message: `contains legacy grouped public-doc route root: ${legacyRoot}`,
				path: absolutePath,
			});
		}
	}
	for (const path of walkFiles(docsRoot)) {
		const relativePath = relative(root, path).replaceAll("\\", "/");
		if (isCollectionGroupIndexPath(relativePath)) {
			issues.push({
				message: `contains stale subgroup overview document: ${relativePath}`,
				path,
			});
			continue;
		}
		if (isCollectionGroupMetaPath(relativePath) && subgroupMetaContainsIndex(path)) {
			issues.push({
				message: `contains stale subgroup overview metadata entry: ${relativePath}`,
				path,
			});
		}
	}
	return issues;
}

function isPublicDocsGeneratedCandidate(path: string): boolean {
	return (
		path.startsWith(`${PUBLIC_DOCS_ROOT}/`) &&
		!path.startsWith(`${PUBLIC_DOCS_ROOT}/.generated/`) &&
		!path.startsWith(`${PUBLIC_DOCS_ROOT}/public/`) &&
		/\.(md|mdx)$/.test(path)
	);
}

function isGeneratedDocumentDetailPath(path: string): boolean {
	if (!(path.startsWith(`${PUBLIC_DOCS_ROOT}/`) && /\.(md|mdx)$/.test(path))) {
		return false;
	}
	if (path.endsWith("/index.md") || path.endsWith("/index.mdx")) {
		return false;
	}
	return (
		path.startsWith(`${PUBLIC_DOCS_ROOT}/student-handbook/`) ||
		path.startsWith(`${PUBLIC_DOCS_ROOT}/curriculum-plan/`) ||
		path.startsWith(`${PUBLIC_DOCS_ROOT}/campus-regulations/`) ||
		path.startsWith(`${PUBLIC_DOCS_ROOT}/docs/`)
	);
}

function hasDocumentMetaPanel(body: string): boolean {
	return /<section\s+(?:class|className)="document-meta-panel"/.test(body);
}

function hasRawDocumentMetaPanelComponent(body: string): boolean {
	return /<DocumentMetaPanel(?:\s|>)/.test(body);
}

function publicationTextNormalizationIssues(
	path: string,
	body: string,
): PublicDocsGeneratedIssue[] {
	const issues: PublicDocsGeneratedIssue[] = [];
	let inMetadataPanel = false;
	let inCodeFence = false;
	for (const rawLine of body.split(/\r?\n/)) {
		const trimmed = rawLine.trim();
		if (trimmed.startsWith("```")) {
			inCodeFence = !inCodeFence;
			continue;
		}
		if (inCodeFence || trimmed.startsWith("import ") || trimmed.startsWith("export ")) {
			continue;
		}
		if (
			rawLine.includes('className="document-meta-panel"') ||
			rawLine.includes('class="document-meta-panel"')
		) {
			inMetadataPanel = true;
		}
		if (inMetadataPanel) {
			if (rawLine.includes("</section>")) {
				inMetadataPanel = false;
			}
			continue;
		}
		const line = rawLine
			.replace(/\]\((?:\\.|[^)])*\)/g, "]")
			.replace(PROTECTED_PUBLICATION_TEXT_SPAN_RE, "")
			.replace(/<[^>]*>/g, " ")
			.replace(/&(?:#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]+);/gi, " ")
			.replace(/&nbsp;/g, " ");
		if (!line.trim()) {
			continue;
		}
		issues.push(
			...matchesFor(line, CJK_CONTEXT_HALFWIDTH_PUNCTUATION_RE).map((match) => ({
				path,
				message: `generated publication text contains CJK-context halfwidth punctuation: ${match}`,
			})),
			...matchesFor(line, CJK_CONTEXT_HALFWIDTH_PARENTHESES_RE).map((match) => ({
				path,
				message: `generated publication text contains CJK-context halfwidth parentheses: ${match}`,
			})),
			...matchesFor(line, HALFWIDTH_LABEL_COLON_RE).map((match) => ({
				path,
				message: `generated publication text contains halfwidth label colon: ${match}`,
			})),
		);
	}
	return issues;
}

function matchesFor(line: string, pattern: RegExp): string[] {
	return [...line.matchAll(new RegExp(pattern.source, "g"))].map((match) => match[0]);
}

function isCollectionGroupIndexPath(path: string): boolean {
	return COLLECTION_GROUP_ROOTS.some((root) => {
		const suffix = path.startsWith(`${root}/`) ? path.slice(root.length + 1) : "";
		return suffix.split("/").length === 2 && suffix.endsWith("/index.md");
	});
}

function isCollectionGroupMetaPath(path: string): boolean {
	return COLLECTION_GROUP_ROOTS.some((root) => {
		const suffix = path.startsWith(`${root}/`) ? path.slice(root.length + 1) : "";
		return suffix.split("/").length === 2 && suffix.endsWith("/_meta.json");
	});
}

function subgroupMetaContainsIndex(path: string): boolean {
	const entries: unknown = JSON.parse(readFileSync(path, "utf-8"));
	return Array.isArray(entries)
		? entries.some((entry) => isRecord(entry) && entry.name === "index")
		: false;
}

function splitFrontmatter(text: string): { frontmatter: string; body: string; error?: string } {
	const lines = text.split(/\r?\n/);
	if (lines[0]?.trim() !== "---") {
		return { body: "", error: "missing frontmatter block", frontmatter: "" };
	}
	for (let index = 1; index < lines.length; index += 1) {
		if (lines[index]?.trim() === "---") {
			return {
				body: lines.slice(index + 1).join("\n"),
				frontmatter: lines.slice(1, index).join("\n"),
			};
		}
	}
	return { body: "", error: "unterminated frontmatter block", frontmatter: "" };
}

function parseSimpleFrontmatter(
	frontmatter: string,
): { ok: true; value: Record<string, string> } | { ok: false; message: string } {
	const value: Record<string, string> = {};
	for (const line of frontmatter.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("- ")) {
			continue;
		}
		const separatorIndex = trimmed.indexOf(":");
		if (separatorIndex === -1) {
			continue;
		}
		const key = trimmed.slice(0, separatorIndex).trim();
		const rawValue = trimmed.slice(separatorIndex + 1).trim();
		if (!key) {
			return { ok: false, message: "frontmatter must be a mapping" };
		}
		value[key] = rawValue.replace(/^['"]|['"]$/g, "");
	}
	return { ok: true, value };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function conflictMarkerIssues(path: string, text: string): PublicDocsGeneratedIssue[] {
	const issues: PublicDocsGeneratedIssue[] = [];
	for (const line of text.split(/\r?\n/)) {
		for (const marker of CONFLICT_MARKERS) {
			if (line.startsWith(marker)) {
				issues.push({ path, message: `contains git conflict marker: ${marker}` });
				break;
			}
		}
	}
	return issues;
}

function restrictedMarkerIssues(path: string, text: string): PublicDocsGeneratedIssue[] {
	const issues: PublicDocsGeneratedIssue[] = [];
	for (const marker of RESTRICTED_PUBLIC_DOCS_MARKERS) {
		if (
			text.includes(marker) &&
			!text.includes(`./${marker}/`) &&
			!text.includes(`/${marker}/`) &&
			!text.includes(`data-docs-collection="${marker}"`)
		) {
			issues.push({ path, message: `contains restricted public-docs marker: ${marker}` });
		}
	}
	for (const marker of INTERNAL_LOCATOR_MARKERS) {
		if (text.includes(marker)) {
			issues.push({ path, message: `contains internal locator marker: ${marker}` });
		}
	}
	return issues;
}

function walkFiles(root: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(root)) {
		const path = resolve(root, entry);
		const stat = statSync(path);
		if (stat.isDirectory()) {
			files.push(...walkFiles(path));
		} else if (stat.isFile()) {
			files.push(path);
		}
	}
	return files;
}

function displayIssue(issue: PublicDocsGeneratedIssue, root: string): string {
	const displayPath = relative(root, issue.path).replaceAll("\\", "/");
	return `${displayPath}: ${issue.message}`;
}

export function main(): number {
	const root = REPO_ROOT;
	const files = publicDocsGeneratedFiles({ root });
	const issues = [
		...validatePublicDocsGeneratedFiles({ paths: files, root }),
		...validatePublicDocsTrackedPaths(publicDocsTrackedFiles({ root }), { root }),
	];
	if (issues.length > 0) {
		console.error("Generated public docs lint failed:");
		for (const issue of issues) {
			console.error(`- ${displayIssue(issue, root)}`);
		}
		return 1;
	}
	console.log(`Validated generated public docs for ${files.length} files.`);
	return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	process.exit(main());
}
