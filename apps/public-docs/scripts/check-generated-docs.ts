import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(scriptDir, "../../..");
const PUBLIC_DOCS_ROOT = "apps/public-docs/docs";
const CONFLICT_MARKERS = ["<<<<<<<", "=======", ">>>>>>>"];
const INTERNAL_LOCATOR_MARKERS = ["campusrag://", "campus-rag-derived", "minio://", "s3://"];
const RESTRICTED_PUBLIC_DOCS_MARKERS = ["institutional_rules", "scoped_rules", "internal_notice"];

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
	_input: { root?: string } = {},
): PublicDocsGeneratedIssue[] {
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
	return issues;
}

export function validatePublicDocsGeneratedFiles(
	input: { paths?: string[]; root?: string } = {},
): PublicDocsGeneratedIssue[] {
	const paths = input.paths ?? publicDocsGeneratedFiles({ root: input.root });
	return paths.flatMap((path) => validatePublicDocsGeneratedFile(path, { root: input.root }));
}

function isPublicDocsGeneratedCandidate(path: string): boolean {
	return (
		path.startsWith(`${PUBLIC_DOCS_ROOT}/`) &&
		!path.startsWith(`${PUBLIC_DOCS_ROOT}/.generated/`) &&
		/\.(md|mdx)$/.test(path)
	);
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
		if (text.includes(marker)) {
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
	const issues = validatePublicDocsGeneratedFiles({ paths: files, root });
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
