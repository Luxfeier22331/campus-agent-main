import { ActionGroup, Button, Field, Input, StateMessage } from "@campus-agent/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import type {
	AccountAdminAccessState,
	AccountAdminState,
	AccountAdminUserSummary,
} from "campus-contracts/account-admin";
import { ChevronLeft, ChevronRight, RefreshCw, Search, UserRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import { AccountAccessBadge, AccountStateBadge, accountStateLabel } from "./account-admin-display";
import { decodeCursorHistory, encodeCursorHistory } from "./account-admin-navigation";
import { formatTimestamp } from "./format";
import { fetchAccountAdminUsers } from "./ops-api/account-admin";
import { ErrorState, PageHeader, StaleDataWarning } from "./ops-display";
import { DataTable } from "./ui/data-table";
import { FilterSelect } from "./ui/filter-select";

const states: AccountAdminState[] = [
	"active",
	"unverified",
	"password_change_required",
	"banned",
	"deleting",
];

export interface UsersSearch {
	access?: AccountAdminAccessState | undefined;
	cursor?: string | undefined;
	history?: string | undefined;
	q?: string | undefined;
	state?: AccountAdminState | undefined;
}

export function UsersPage({ search }: { search: UsersSearch }) {
	const navigate = useNavigate({ from: "/users" });
	const currentHref = useRouterState({ select: (state) => state.location.href });
	const [queryInput, setQueryInput] = useState(search.q ?? "");
	useEffect(() => setQueryInput(search.q ?? ""), [search.q]);
	const history = decodeCursorHistory(search.history);
	const hasFilters = Boolean(search.access || search.q || search.state);
	const users = useQuery({
		placeholderData: keepPreviousData,
		queryFn: ({ signal }) =>
			fetchAccountAdminUsers(
				{
					...(search.access ? { access: search.access } : {}),
					...(search.cursor ? { cursor: search.cursor } : {}),
					limit: 50,
					...(search.q ? { query: search.q } : {}),
					...(search.state ? { state: search.state } : {}),
				},
				{ signal },
			),
		queryKey: ["ops", "users", search],
	});
	const setSearch = (next: UsersSearch) => void navigate({ replace: false, search: next });

	return (
		<section>
			<PageHeader
				actions={
					<Button disabled={users.isFetching} onClick={() => void users.refetch()} variant="ghost">
						<RefreshCw className="size-4" />
						刷新
					</Button>
				}
				description="查询认证账号、验证状态、封禁状态和当前会话。"
				title="用户管理"
			/>
			<form
				className="ops-filter-bar mb-4 grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(15rem,1fr)_10rem_10rem_auto_auto]"
				onSubmit={(event) => {
					event.preventDefault();
					setSearch({
						access: search.access,
						q: queryInput.trim() || undefined,
						state: search.state,
					});
				}}
			>
				<Field label="用户">
					<Input
						className="min-h-11 w-full"
						id="account-user-query"
						name="q"
						onChange={(event) => setQueryInput(event.target.value)}
						placeholder="姓名前缀、完整邮箱或用户 ID"
						value={queryInput}
					/>
				</Field>
				<Field label="访问状态">
					<FilterSelect
						className="min-h-11"
						id="account-user-access"
						onValueChange={(nextValue) =>
							setSearch({
								access: (nextValue || undefined) as AccountAdminAccessState | undefined,
								q: search.q,
								state: search.state,
							})
						}
						value={search.access ?? ""}
						options={[
							{ value: "", label: "全部权限" },
							{ value: "allowed", label: "可访问" },
							{ value: "denied", label: "不可访问" },
						]}
					/>
				</Field>
				<Field label="账号状态">
					<FilterSelect
						className="min-h-11"
						id="account-user-state"
						name="state"
						onValueChange={(nextValue) =>
							setSearch({
								access: search.access,
								q: search.q,
								state: (nextValue || undefined) as AccountAdminState | undefined,
							})
						}
						value={search.state ?? ""}
						options={[
							{ value: "", label: "全部状态" },
							...states.map((value) => ({
								value: value,
								label: accountStateLabel(value),
							})),
						]}
					/>
				</Field>
				<Button type="submit">
					<Search className="size-4" />
					查询
				</Button>
				{hasFilters ? (
					<Button
						onClick={() => {
							setQueryInput("");
							setSearch({});
						}}
						variant="ghost"
					>
						<X className="size-4" />
						清除筛选
					</Button>
				) : null}
			</form>

			{users.isError && !users.data ? (
				<ErrorState error={users.error} onRetry={() => void users.refetch()} title="用户读取失败" />
			) : users.data ? (
				<>
					{users.isError ? (
						<StaleDataWarning
							error={users.error}
							lastSuccessfulAt={users.dataUpdatedAt}
							onRetry={() => void users.refetch()}
							title="用户刷新失败"
						/>
					) : null}
					{users.isFetching ? (
						<StateMessage
							layout="inline"
							role="status"
							className="mb-2"
							description={<>正在更新结果...</>}
						/>
					) : null}
					<div className="hidden sm:block">
						<DataTable<AccountAdminUserSummary>
							busy={users.isFetching}
							caption="用户列表"
							columns={[
								{
									cell: (row) => (
										<div className="grid min-w-0 gap-0.5">
											<span className="font-medium text-foreground">{row.name}</span>
											<span className="break-all text-muted-foreground text-xs">{row.email}</span>
										</div>
									),
									header: "用户",
									id: "user",
									rowHeader: true,
								},
								{
									cell: (row) => <AccountStateBadge state={row.state} />,
									header: "账号状态",
									id: "state",
								},
								{
									cell: (row) => (
										<AccountAccessBadge source={row.accessSource} state={row.accessState} />
									),
									header: "访问状态",
									id: "access",
								},
								{
									cell: (row) => row.activeSessionCount,
									cellClassName: "hidden sm:table-cell",
									header: "有效会话",
									headerClassName: "hidden sm:table-cell",
									id: "sessions",
								},
								{
									cell: (row) => formatTimestamp(row.createdAt),
									cellClassName: "hidden lg:table-cell",
									header: "注册时间",
									headerClassName: "hidden lg:table-cell",
									id: "created",
								},
								{
									cell: (row) => (
										<Button asChild size="sm" variant="ghost">
											<Link
												params={{ userId: row.id }}
												search={{ from: currentHref }}
												to="/users/$userId"
											>
												<UserRound className="size-4" />
												详情
											</Link>
										</Button>
									),
									header: "操作",
									id: "actions",
									stickyRight: true,
								},
							]}
							data={users.data.items}
							emptyMessage={hasFilters ? "没有符合筛选条件的用户。" : "系统中还没有用户。"}
							minWidth="0"
							rowKey={(row) => row.id}
							tableClassName="table-fixed sm:table-auto"
						/>
					</div>
					<div
						className="divide-y divide-border rounded-[var(--radius-lg)] border border-border bg-background px-3 sm:hidden"
						data-testid="users-mobile-list"
					>
						{users.data.items.length === 0 ? (
							<StateMessage
								description={hasFilters ? "没有符合筛选条件的用户。" : "系统中还没有用户。"}
							/>
						) : null}
						{users.data.items.map((row) => (
							<article className="grid gap-3 py-4" key={row.id}>
								<div className="flex min-w-0 items-start justify-between gap-3">
									<div className="min-w-0">
										<h2 className="break-words font-semibold text-foreground">{row.name}</h2>
										<p className="mt-1 break-all text-muted-foreground text-sm">{row.email}</p>
									</div>
									<AccountStateBadge state={row.state} />
								</div>
								<dl className="grid gap-2 text-sm">
									<div>
										<dt className="font-medium text-muted-foreground text-xs">访问状态</dt>
										<dd className="mt-1">
											<AccountAccessBadge source={row.accessSource} state={row.accessState} />
										</dd>
									</div>
									<div>
										<dt className="font-medium text-muted-foreground text-xs">有效会话</dt>
										<dd className="mt-1">{row.activeSessionCount}</dd>
									</div>
									<div>
										<dt className="font-medium text-muted-foreground text-xs">注册时间</dt>
										<dd className="mt-1">{formatTimestamp(row.createdAt)}</dd>
									</div>
								</dl>
								<Button asChild className="w-full" variant="ghost">
									<Link
										params={{ userId: row.id }}
										search={{ from: currentHref }}
										to="/users/$userId"
									>
										<UserRound className="size-4" />
										查看用户详情
									</Link>
								</Button>
							</article>
						))}
					</div>
					<div className="mt-4 flex flex-wrap items-center justify-between gap-3">
						<p className="text-muted-foreground text-sm">
							第 {history.length + 1} 页，本页 {users.data.items.length} 位用户
						</p>
						<ActionGroup>
							<Button
								disabled={users.isFetching || history.length === 0}
								onClick={() => {
									const previous = history.slice();
									const cursor = previous.pop();
									setSearch({
										access: search.access,
										cursor,
										history: encodeCursorHistory(previous),
										q: search.q,
										state: search.state,
									});
								}}
								variant="ghost"
							>
								<ChevronLeft className="size-4" />
								上一页
							</Button>
							<Button
								disabled={users.isFetching || !users.data.nextCursor}
								onClick={() =>
									setSearch({
										access: search.access,
										cursor: users.data?.nextCursor ?? undefined,
										history: encodeCursorHistory([...history, search.cursor ?? ""]),
										q: search.q,
										state: search.state,
									})
								}
								variant="ghost"
							>
								下一页
								<ChevronRight className="size-4" />
							</Button>
						</ActionGroup>
					</div>
				</>
			) : (
				<StateMessage layout="inline" description="正在读取用户..." />
			)}
		</section>
	);
}
