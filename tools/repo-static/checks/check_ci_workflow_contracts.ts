import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { auditCiWorkflowContracts as auditCiWorkflowContractsForRoot } from "../ci-workflow-contracts/core.ts";
import type { CiWorkflowContractIssue } from "../ci-workflow-contracts/lib.ts";
import { renderIssue } from "../ci-workflow-contracts/lib.ts";
import { runCiWorkflowContractSelfTest } from "../ci-workflow-contracts/self-test.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(scriptDir, "../../..");

export function auditCiWorkflowContracts(root = repoRoot): CiWorkflowContractIssue[] {
	return auditCiWorkflowContractsForRoot(root);
}

function main(): number {
	if (process.argv.includes("--self-test")) {
		return runCiWorkflowContractSelfTest(repoRoot);
	}
	const issues = auditCiWorkflowContracts();
	if (issues.length > 0) {
		console.error("CI workflow contract check failed:");
		for (const issue of issues) {
			console.error(`- ${renderIssue(issue)}`);
		}
		return 1;
	}
	console.log("Validated CI workflow contracts.");
	return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	process.exitCode = main();
}
