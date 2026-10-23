export interface DiningNormalizedPhoto {
	bytes: Uint8Array;
	width: number;
	height: number;
}

export interface DiningImageProcessor {
	normalize(bytes: Uint8Array): Promise<DiningNormalizedPhoto>;
}

export interface DiningSubmissionObjects {
	put(key: string, photo: DiningNormalizedPhoto): Promise<{ versionId: string | null }>;
	get(key: string): Promise<Uint8Array | null>;
	deleteAllVersions(key: string): Promise<void>;
}
