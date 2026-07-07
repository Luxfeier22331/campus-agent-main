export function parsePublishedReaderSyncArgs(argv: string[]): {
	command: "all" | "docs" | "assets";
	manifestFilePath?: string;
	manifestObjectKey?: string;
};
