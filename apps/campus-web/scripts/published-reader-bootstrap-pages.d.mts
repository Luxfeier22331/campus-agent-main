import type { PublishedReaderManifestEntry } from "./published-reader-manifest.mjs";

export function writeBootstrapPages(docsRoot: string): void;

export function writeGatedReaderPage(input: {
	docsRoot: string;
	entry: PublishedReaderManifestEntry;
}): void;
