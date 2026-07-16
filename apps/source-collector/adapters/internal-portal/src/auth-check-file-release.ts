import { fetchFileReleasePage } from "./api.js";
import { loadInternalPortalEnv, resolveInternalPortalConfig } from "./config.js";
import { createPortalApiContext } from "./portal.js";
import { formatSafeErrorMessage } from "./safe-error.js";
import type {
	ApiRequestContextLike,
	DisposableApiContextLike,
	FileReleasePageResponse,
} from "./types.js";

export interface FileReleaseAuthCheckDependencies {
	authCheckPageSize: number;
	createApiContext: () => Promise<ApiRequestContextLike & DisposableApiContextLike>;
	fetchFileReleasePage: (input: {
		apiContext: ApiRequestContextLike;
		currentPage: number;
		pageSize: number;
	}) => Promise<FileReleasePageResponse>;
}

export async function checkFileReleaseAuth(
	dependencies?: FileReleaseAuthCheckDependencies,
): Promise<{ ok: boolean; fileRelease: { sampleCount: number } }> {
	const config = resolveInternalPortalConfig(process.env);
	const apiContext = await (
		dependencies?.createApiContext ?? (() => createPortalApiContext(config))
	)();
	try {
		const response = await (
			dependencies?.fetchFileReleasePage ?? ((input) => fetchFileReleasePage({ ...input }))
		)({
			apiContext,
			currentPage: 1,
			pageSize: dependencies?.authCheckPageSize ?? config.authCheckPageSize,
		});
		if (!response.state) {
			throw new Error("auth check failed: file-release surface unavailable");
		}
		return {
			fileRelease: { sampleCount: response.data?.length ?? 0 },
			ok: true,
		};
	} finally {
		await apiContext.dispose();
	}
}

export async function main(): Promise<void> {
	loadInternalPortalEnv();
	console.log(JSON.stringify(await checkFileReleaseAuth(), null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(formatSafeErrorMessage(error));
		process.exitCode = 1;
	});
}
