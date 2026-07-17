export type DocsReleaseId = `sha256:${string}`;

export function assertDocsReleaseId(value: string): DocsReleaseId {
	if (!/^sha256:[a-f0-9]{64}$/u.test(value)) {
		throw new Error("docs release id must be sha256:<64 lowercase hex characters>");
	}
	return value as DocsReleaseId;
}

export function docsReleaseDigest(releaseId: string): string {
	return assertDocsReleaseId(releaseId).slice("sha256:".length);
}

export function docsReleaseManifestKey(releaseId: string): string {
	return `docs-reader/releases/sha256/${docsReleaseDigest(releaseId)}/manifest.json`;
}
