export function parsePrepareDocsReaderBuildArgs(argv: string[]): {
	publicDocsSyncManifestPath: string;
	readModelManifestPath?: string;
};

export function resolvePrepareDocsReaderBuildEnv(env: Record<string, string | undefined>): {
	APP_API_OPERATOR_DATABASE_URL: string;
	OBJECT_STORE_BUCKET_DERIVED: string;
	OBJECT_STORE_CREDENTIAL_MODE: "derived" | "shared";
	OBJECT_STORE_ENDPOINT: string;
};

export function loadPrepareDocsReaderBuildEnvFiles(
	env: Record<string, string | undefined>,
	options: {
		defaultEnvFiles?: string[];
		overrideEnvFiles?: string[];
	},
): void;
