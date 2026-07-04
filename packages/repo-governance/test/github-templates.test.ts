import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(packageRoot, "..", "..", "..");
const issueTemplateRoot = join(repoRoot, ".github", "ISSUE_TEMPLATE");
const pullRequestTemplatePath = join(repoRoot, ".github", "pull_request_template.md");

const expectedIssueForms = new Set([
	"bug_report.yml",
	"config.yml",
	"documentation.yml",
	"feature_request.yml",
]);

describe("GitHub collaboration templates", () => {
	it("keeps GitHub template files on the official repository paths", () => {
		const templateNames = new Set(readdirSync(issueTemplateRoot));

		expect(readFileSync(pullRequestTemplatePath, "utf8")).toContain("# Pull Request");
		expect(templateNames).toEqual(expectedIssueForms);
		expect(templateNames.has("bug_report.md")).toBe(false);
		expect(templateNames.has("docs_issue.md")).toBe(false);
		expect(templateNames.has("feature_request.md")).toBe(false);
	});

	it("uses GitHub Issue Forms without parallel Markdown issue templates", () => {
		const templateNames = readdirSync(issueTemplateRoot).sort();

		expect(new Set(templateNames)).toEqual(expectedIssueForms);
		expect(templateNames.filter((name) => name.endsWith(".md"))).toEqual([]);
	});

	it("keeps issue forms on the GitHub Issue Forms schema", () => {
		const config = parse(readFileSync(join(issueTemplateRoot, "config.yml"), "utf8"));

		expect(config.blank_issues_enabled).toBe(false);

		for (const formName of expectedIssueForms) {
			if (formName === "config.yml") {
				continue;
			}

			const formPath = join(issueTemplateRoot, formName);
			const form = parse(readFileSync(formPath, "utf8"));
			const formLabel = relative(repoRoot, formPath);

			expect(form.name, formLabel).toEqual(expect.any(String));
			expect(form.description, formLabel).toEqual(expect.any(String));
			expect(form.title, formLabel).toEqual(expect.any(String));
			expect(form.labels, formLabel).toEqual(expect.any(Array));
			expect(form.body, formLabel).toEqual(expect.any(Array));
			expect(form.body.length, formLabel).toBeGreaterThan(0);
			expect(
				form.body.map((entry: { type?: string }) => entry.type),
				formLabel,
			).toContain("checkboxes");
		}
	});

	it("keeps the pull request template useful without becoming an audit checklist", () => {
		const template = readFileSync(pullRequestTemplatePath, "utf8");
		const headings = template
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.startsWith("## "));
		const forbiddenPhrases = [
			"Public Source / Data Boundary",
			"Data Boundary",
			"CI 与合并纪律",
			"CodeQL",
			"Dependency Review",
			"artifact attestation",
			"branch protection",
			"changed-surface",
			"manual / staging / eval lane",
			"private repo",
			"pr-checks / required-checks",
			"source-derived documents",
			"No internal publish/deploy workflow",
			"explicitly redistributable",
		];

		expect(headings).toEqual(["## Summary", "## Related Issue", "## Changes", "## Validation"]);
		expect(template).not.toContain("- [ ]");
		expect(template).toContain("## Related Issue\n\nN/A");
		expect(template).not.toContain("Closes:");
		expect(template).not.toContain("Reviewer Notes");

		for (const phrase of forbiddenPhrases) {
			expect(template).not.toContain(phrase);
		}
	});
});
