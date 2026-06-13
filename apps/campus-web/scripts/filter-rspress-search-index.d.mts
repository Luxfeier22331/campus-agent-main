export interface RspressSearchIndexFilterResult {
	files: Array<{
		file: string;
		keptPageCount: number;
		removedPageCount: number;
	}>;
}

export function filterRspressSearchIndexFile(filePath: string): {
	keptPageCount: number;
	removedPageCount: number;
};

export function filterRspressSearchIndexes(buildRoot: string): RspressSearchIndexFilterResult;
