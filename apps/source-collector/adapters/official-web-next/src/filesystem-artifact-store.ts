import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { sha256Hex } from "./hash.ts";
import type { OfficialWebNextArtifactStore, StoredArtifactRef } from "./types.ts";

export class FilesystemOfficialWebNextArtifactStore implements OfficialWebNextArtifactStore {
	private readonly rootDir: string;

	constructor(rootDir: string) {
		this.rootDir = resolve(rootDir);
	}

	async putObject(input: {
		objectKey: string;
		data: Uint8Array;
		contentType: string;
		recordCount?: number;
	}): Promise<StoredArtifactRef> {
		const targetPath = resolve(this.rootDir, input.objectKey);
		if (!isPathUnderRoot(targetPath, this.rootDir)) {
			throw new Error(
				`official-web-next object key must stay under artifact root: ${input.objectKey}`,
			);
		}
		await mkdir(dirname(targetPath), { recursive: true });
		await writeFile(targetPath, input.data);
		return {
			objectKey: input.objectKey,
			contentSha256: sha256Hex(input.data),
			byteSize: input.data.byteLength,
			recordCount: input.recordCount,
		};
	}
}

function isPathUnderRoot(targetPath: string, rootDir: string): boolean {
	return targetPath === rootDir || targetPath.startsWith(`${rootDir}${sep}`);
}
