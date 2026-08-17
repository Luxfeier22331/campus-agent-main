import { readFileSync } from "node:fs";
import path from "node:path";

const EXACT_NODE_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\r?\n?$/u;

export function readNodeVersion(repositoryRoot: string): string {
	const source = readFileSync(path.join(repositoryRoot, ".node-version"), "utf8");
	if (!EXACT_NODE_VERSION.test(source)) {
		throw new Error(".node-version must contain one exact x.y.z version");
	}
	return source.trimEnd();
}
