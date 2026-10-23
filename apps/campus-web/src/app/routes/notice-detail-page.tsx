import { Button, StateMessage } from "@campus-agent/ui";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearch } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import {
	NoticeContent,
	NoticeDetailSkeleton,
	NoticeMetadata,
	NoticePortalAction,
} from "@/components/notices/notice-content";
import { NoticeCategoryBadge } from "@/features/notices/category-badge";
import { noticeDetailQueryOptions } from "@/features/notices/queries";
import { noticeQueryClient } from "@/features/notices/query-client";
import { parseTransportSearch, transportReturnTarget } from "@/features/transport/route-search";
import { ApiRequestError } from "@/platform/api/client";

export function NoticeDetailPage() {
	return (
		<QueryClientProvider client={noticeQueryClient}>
			<NoticeDetailPageContent />
		</QueryClientProvider>
	);
}

export function NoticeDetailPageContent() {
	const { noticeId } = useParams({ from: "/notices/$noticeId" });
	const search = useSearch({ from: "/notices/$noticeId" });
	const returnTo = transportReturnTarget(search.returnTo);
	const notice = useQuery(noticeDetailQueryOptions(noticeId));

	const noticeNotFound = notice.error instanceof ApiRequestError && notice.error.status === 404;
	const isCampusNews = notice.data?.category === "campus_news";

	return (
		<article className="mx-auto w-full max-w-[var(--layout-docs-content-width)] px-4 py-6 pb-24 sm:px-5 lg:px-6">
			<Button asChild className="-ml-3" size="sm" variant="ghost">
				{returnTo ? (
					<Link
						to="/transport"
						search={parseTransportSearch(
							Object.fromEntries(new URL(returnTo, "https://campus.local").searchParams),
						)}
					>
						<ArrowLeft />
						返回班车
					</Link>
				) : (
					<Link
						search={{
							page: 1,
							stream: isCampusNews ? "campus_news" : "notices",
						}}
						to="/notices"
					>
						<ArrowLeft />
						{isCampusNews ? "返回校园动态" : "返回通知目录"}
					</Link>
				)}
			</Button>

			{notice.isPending ? <NoticeDetailSkeleton /> : null}
			{notice.isError ? (
				<StateMessage
					className="mt-5"
					description={
						noticeNotFound ? "这条通知不存在，或你没有权限查看。" : "通知暂时无法读取，请稍后重试。"
					}
					layout="section"
					primaryAction={
						noticeNotFound ? (
							<Button asChild>
								<Link search={{ page: 1, stream: "notices" }} to="/notices">
									返回通知目录
								</Link>
							</Button>
						) : (
							<Button onClick={() => void notice.refetch()}>重试</Button>
						)
					}
					role="alert"
					title={noticeNotFound ? "通知不存在" : "通知暂时不可用"}
					tone={noticeNotFound ? "neutral" : "danger"}
				/>
			) : null}
			{notice.data ? (
				<>
					<header className="border-b border-border pb-6 pt-4">
						<NoticeCategoryBadge category={notice.data.category} />
						<h1 className="mt-4 break-words text-2xl font-semibold leading-9 tracking-normal text-[var(--sys-text-strong)] md:text-3xl md:leading-10">
							{notice.data.title}
						</h1>
						<div className="mt-5 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-3 sm:gap-x-6">
							<NoticeMetadata notice={notice.data} />
							<NoticePortalAction notice={notice.data} />
						</div>
					</header>

					<NoticeContent notice={notice.data} />
				</>
			) : null}
		</article>
	);
}
