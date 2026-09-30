import { Button, Field, Input } from "@campus-agent/ui";
import { useNavigate } from "@tanstack/react-router";
import type { TimeFilters } from "campus-contracts/ops-time";
import { SlidersHorizontal } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { replaceTimeQuery, type TimeSearch, timeQueryFields } from "./time-filters";
import { FilterSelect } from "./ui/filter-select";
import { TimeRangeFilter, TimeRangeSummary } from "./ui/time-window-select";

interface ConversationsFilterDraft {
	q: string;
	ownerQuery: string;
	status: string;
	feedback: string;
	hasFailures: string;
}

function filterDraft(search: Record<string, unknown>): ConversationsFilterDraft {
	return {
		q: typeof search.q === "string" ? search.q : "",
		ownerQuery: typeof search.ownerQuery === "string" ? search.ownerQuery : "",
		status: typeof search.status === "string" ? search.status : "",
		feedback: typeof search.feedback === "string" ? search.feedback : "",
		hasFailures: typeof search.hasFailures === "boolean" ? String(search.hasFailures) : "",
	};
}

export function ConversationFilters({
	search,
	filters,
}: {
	search: TimeSearch & Record<string, unknown>;
	filters: TimeFilters | undefined;
}) {
	const navigate = useNavigate();
	const filtersId = useId();
	const [filtersOpen, setFiltersOpen] = useState(
		Boolean(search.status || search.feedback || search.hasFailures !== undefined),
	);
	const { q, ownerQuery, status, feedback, hasFailures } = search;
	const [draft, setDraft] = useState(() => filterDraft(search));
	useEffect(() => {
		setDraft(filterDraft({ q, ownerQuery, status, feedback, hasFailures }));
	}, [q, ownerQuery, status, feedback, hasFailures]);
	const hasFilters =
		["q", "ownerQuery", "ownerId", "status", "feedback", "hasFailures", "from", "to"].some(
			(k) => search[k] !== undefined && search[k] !== "",
		) || Boolean(search.window && search.window !== "today");
	return (
		<>
			<form
				className="ops-conversation-filters grid items-end gap-2"
				onSubmit={(event) => {
					event.preventDefault();
					const value = (name: keyof typeof draft) => draft[name].trim() || undefined;
					void navigate({
						to: "/conversations",
						search: {
							q: value("q"),
							ownerQuery: value("ownerQuery"),
							ownerId: search.ownerId,
							status: value("status"),
							feedback: value("feedback"),
							hasFailures:
								value("hasFailures") === undefined ? undefined : value("hasFailures") === "true",
							...timeQueryFields(search),
						},
					});
				}}
			>
				<Field label="用户" className="ops-conversation-owner-filter">
					<Input
						aria-label="搜索用户"
						value={draft.ownerQuery}
						onChange={(event) =>
							setDraft((previous) => ({ ...previous, ownerQuery: event.target.value }))
						}
						name="ownerQuery"
						maxLength={320}
						placeholder="用户：名称、邮箱或完整 ID"
					/>
				</Field>
				<Field label="会话内容" className="ops-conversation-content-filter">
					<Input
						aria-label="搜索会话"
						value={draft.q}
						onChange={(event) => setDraft((previous) => ({ ...previous, q: event.target.value }))}
						name="q"
						maxLength={256}
						placeholder="内容：标题、问答或请求 ID"
					/>
				</Field>
				<TimeRangeFilter
					search={search}
					scope="conversations"
					label="最近活动"
					onChange={(time) =>
						void navigate({
							to: "/conversations",
							search: {
								...replaceTimeQuery(search, time),
								conversationId: undefined,
								messageId: undefined,
							},
						})
					}
				/>
				<Button type="submit">搜索</Button>
				<Button
					variant="ghost"
					type="button"
					aria-expanded={filtersOpen}
					aria-controls={filtersId}
					onClick={() => setFiltersOpen((open) => !open)}
				>
					<SlidersHorizontal className="size-4" />
					更多筛选
				</Button>
				<div id={filtersId} hidden={!filtersOpen} className="col-span-full">
					<div className="grid gap-3 border-t border-border pt-3 sm:grid-cols-3">
						<Field label="最新一轮状态">
							<FilterSelect
								aria-label="最新一轮状态"
								value={draft.status}
								onValueChange={(nextValue) =>
									setDraft((previous) => ({ ...previous, status: nextValue }))
								}
								name="status"
								options={[
									{ value: "", label: "全部状态" },
									{ value: "COMPLETED", label: "已完成" },
									{ value: "FAILED", label: "失败" },
									{ value: "RUNNING", label: "运行中" },
									{ value: "PENDING", label: "待处理" },
									{ value: "ACTION_REQUIRED", label: "等待用户" },
									{ value: "CANCELLED", label: "已取消" },
								]}
							/>
						</Field>
						<Field label="反馈状态">
							<FilterSelect
								aria-label="反馈状态"
								value={draft.feedback}
								onValueChange={(nextValue) =>
									setDraft((previous) => ({ ...previous, feedback: nextValue }))
								}
								name="feedback"
								options={[
									{ value: "", label: "全部反馈" },
									{ value: "WITH_FEEDBACK", label: "有反馈" },
									{ value: "WITHOUT_FEEDBACK", label: "无反馈" },
								]}
							/>
						</Field>
						<Field label="包含失败请求">
							<FilterSelect
								aria-label="包含失败请求"
								value={draft.hasFailures}
								onValueChange={(nextValue) =>
									setDraft((previous) => ({ ...previous, hasFailures: nextValue }))
								}
								name="hasFailures"
								options={[
									{ value: "", label: "全部运行" },
									{ value: "true", label: "包含失败" },
									{ value: "false", label: "不含失败" },
								]}
							/>
						</Field>
					</div>
					{filters ? <TimeRangeSummary filters={filters} /> : null}
				</div>
			</form>
			<div className="flex min-w-0 flex-wrap items-center gap-2 empty:hidden [&:not(:empty)]:mt-2">
				{Object.entries({
					ownerQuery: "用户",
					ownerId: "用户 ID",
					q: "搜索",
					status: "最新一轮状态",
					feedback: "反馈",
					hasFailures: "包含失败请求",
				}).map(([key, label]) =>
					search[key] !== undefined && search[key] !== "" ? (
						<Button
							key={key}
							variant="secondary"
							size="sm"
							aria-label={`移除${label}筛选`}
							className="max-w-[calc(100%-4rem)] gap-1 text-left"
							onClick={() =>
								void navigate({
									to: "/conversations",
									search: {
										...search,
										[key]: undefined,
										cursor: undefined,
										history: undefined,
										conversationId: undefined,
										messageId: undefined,
									},
								})
							}
						>
							<span className="truncate">
								{label}：
								{key === "q" || key === "ownerQuery" || key === "ownerId"
									? String(search[key])
									: key === "hasFailures"
										? search[key]
											? "是"
											: "否"
										: key === "feedback"
											? search[key] === "WITH_FEEDBACK"
												? "有反馈"
												: "无反馈"
											: ({
													COMPLETED: "已完成",
													FAILED: "失败",
													RUNNING: "运行中",
													PENDING: "待处理",
													ACTION_REQUIRED: "等待用户",
													CANCELLED: "已取消",
												}[String(search[key])] ?? String(search[key]))}
							</span>
							×
						</Button>
					) : null,
				)}
				{hasFilters ? (
					<Button
						onClick={() => {
							setDraft(filterDraft({}));
							void navigate({ to: "/conversations", search: {} });
						}}
						variant="ghost"
						aria-label="清除筛选"
						size="sm"
					>
						清除
					</Button>
				) : null}
			</div>
		</>
	);
}
