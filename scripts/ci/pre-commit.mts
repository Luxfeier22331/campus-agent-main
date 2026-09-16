import path from "node:path";
import { pathToFileURL } from "node:url";
import { runPreCommitEvidence } from "./evidence.mts";

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	try {
		runPreCommitEvidence({ repositoryRoot: process.cwd() });
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
}
