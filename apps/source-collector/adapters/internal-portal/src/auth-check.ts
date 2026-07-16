import { fetchNoticePage } from "./api.js";
import { loadInternalPortalEnv, resolveInternalPortalConfig } from "./config.js";
import { createPortalApiContext } from "./portal.js";
import { formatSafeErrorMessage } from "./safe-error.js";
import type {
	ApiRequestContextLike,
	DisposableApiContextLike,
	NoticeListResponse,
} from "./types.js";

export interface AuthCheckResult {
	ok: boolean;
	notice: {
		sampleCount: number;
	};
}

export interface AuthCheckDependencies {
	authCheckNoticeType: string;
	authCheckPageSize: number;
	createApiContext: () => Promise<ApiRequestContextLike & DisposableApiContextLike>;
	fetchNoticePage: (input: {
		apiContext: ApiRequestContextLike;
		noticeType: string;
		currentPage: number;
		pageSize: number;
	}) => Promise<NoticeListResponse>;
}

export async function checkAuth(dependencies?: AuthCheckDependencies): Promise<AuthCheckResult> {
	const config = resolveInternalPortalConfig(process.env);
	const apiContext = await (
		dependencies?.createApiContext ?? (() => createPortalApiContext(config))
	)();
	try {
		const response = await (
			dependencies?.fetchNoticePage ?? ((input) => fetchNoticePage({ ...input }))
		)({
			apiContext,
			currentPage: 1,
			noticeType: dependencies?.authCheckNoticeType ?? config.authCheckNoticeType,
			pageSize: dependencies?.authCheckPageSize ?? config.authCheckPageSize,
		});
		const rows = response.datas?.tables ?? [];
		if (!response.state) {
			throw new Error("auth check failed: notice surface unavailable");
		}
		return {
			ok: true,
			notice: { sampleCount: rows.length },
		};
	} finally {
		await apiContext.dispose();
	}
}

export async function main(): Promise<void> {
	loadInternalPortalEnv();
	const result = await checkAuth();
	console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(formatSafeErrorMessage(error));
		process.exitCode = 1;
	});
}
