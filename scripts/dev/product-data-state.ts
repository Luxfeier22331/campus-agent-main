import { rmSync } from "node:fs";
import { resolve } from "node:path";

function removeLegacyProductStateFiles(repoRoot: string): void {
	rmSync(resolve(repoRoot, "var/dev/product-snapshot.json"), { force: true });
	rmSync(resolve(repoRoot, "var/dev/product-sync-pending.json"), { force: true });
}

export function removeProductSnapshot(repoRoot: string): void {
	removeLegacyProductStateFiles(repoRoot);
}
