import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const decisionsDir = resolve(process.cwd(), "docs/decisions");
const files = readdirSync(decisionsDir)
	.filter((name) => /^adr-\d{4}-.+\.md$/u.test(name))
	.sort();
const filesById = new Map<string, string[]>();
const errors: string[] = [];

for (const file of files) {
	const content = readFileSync(resolve(decisionsDir, file), "utf8");
	const filenameId = file.match(/^adr-(\d{4})-/u)?.[1];
	const decisionId = content.match(/^decision_id:\s*ADR-(\d{4})\s*$/mu)?.[1];
	const headingId = content.match(/^# ADR-(\d{4})(?::|：|\s)/mu)?.[1];

	if (!decisionId) {
		errors.push(`${file}: missing decision_id: ADR-XXXX`);
		continue;
	}
	const id = `ADR-${decisionId}`;
	filesById.set(id, [...(filesById.get(id) ?? []), file]);
	if (filenameId !== decisionId) {
		errors.push(`${file}: filename id does not match ${id}`);
	}
	if (headingId !== decisionId) {
		errors.push(`${file}: H1 id does not match ${id}`);
	}
}

for (const [id, matchingFiles] of filesById) {
	if (matchingFiles.length > 1) {
		errors.push(`${id}: duplicate decision id in ${matchingFiles.join(", ")}`);
	}
}

if (errors.length > 0) {
	for (const error of errors) {
		console.error(error);
	}
	process.exitCode = 1;
} else {
	console.log(`ADR identity check passed for ${files.length} decisions.`);
}
