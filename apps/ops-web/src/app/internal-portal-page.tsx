import { Badge, Button, Field, Input } from "@campus-agent/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, RefreshCw } from "lucide-react";
import { type FormEvent, useState } from "react";
import {
	type InternalPortalAuthStatus,
	InternalPortalAuthUpdateSchema,
} from "../shared/ops-contract";
import { formatTimestamp } from "./format";
import {
	fetchInternalPortalAuthStatus,
	replaceInternalPortalAuthCredential,
} from "./ops-api-client";
import { ErrorState, InlineError, PageHeader, PageShell, StaleDataWarning } from "./ops-display";

const INTERNAL_PORTAL_AUTH_QUERY_KEY = ["internal-portal", "auth"] as const;

export function InternalPortalPage() {
	const queryClient = useQueryClient();
	const [ssoTgc, setSsoTgc] = useState("");
	const [inputError, setInputError] = useState<string | null>(null);
	const status = useQuery({
		queryFn: ({ signal }) => fetchInternalPortalAuthStatus({ signal }),
		queryKey: INTERNAL_PORTAL_AUTH_QUERY_KEY,
		refetchInterval: (query) => {
			const current = query.state.data;
			return current && (current.latestRun === "running" || !current.currentCredentialChecked)
				? 30_000
				: false;
		},
		refetchIntervalInBackground: false,
	});
	const replacement = useMutation({
		mutationFn: replaceInternalPortalAuthCredential,
		onSuccess: (nextStatus) => {
			queryClient.setQueryData(INTERNAL_PORTAL_AUTH_QUERY_KEY, nextStatus);
			setSsoTgc("");
			setInputError(null);
		},
	});

	if (status.isPending) {
		return <PageShell title="内部门户">正在读取认证状态...</PageShell>;
	}
	if (status.isError && !status.data) {
		return (
			<PageShell title="内部门户">
				<ErrorState
					error={status.error}
					onRetry={() => status.refetch()}
					title="认证状态读取失败"
				/>
			</PageShell>
		);
	}
	if (!status.data) {
		return <PageShell title="内部门户">正在读取认证状态...</PageShell>;
	}

	const submit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const parsed = InternalPortalAuthUpdateSchema.safeParse({ ssoTgc });
		if (!parsed.success) {
			setInputError("请输入原始 SSO_TGC 值，不要包含 Cookie 名称或其他 Cookie 字段。");
			return;
		}
		setInputError(null);
		replacement.mutate(parsed.data);
	};

	return (
		<section>
			<PageHeader
				actions={
					<Button
						aria-busy={status.isFetching}
						disabled={status.isFetching}
						onClick={() => status.refetch()}
						variant="outline"
					>
						<RefreshCw />
						{status.isFetching ? "刷新中" : "刷新"}
					</Button>
				}
				description="查看 TGC 更新时间和定期认证检查结果。"
				title="内部门户"
			/>

			{status.isRefetchError ? (
				<StaleDataWarning
					error={status.error}
					lastSuccessfulAt={status.dataUpdatedAt}
					onRetry={() => void status.refetch()}
					title="认证状态刷新失败"
				/>
			) : null}

			<AuthStatusSummary status={status.data} />

			<section className="mt-8 max-w-2xl border-border border-t pt-6">
				<div className="mb-4 space-y-1">
					<h2 className="font-semibold text-lg">替换 TGC</h2>
					<p className="text-muted-foreground text-sm">新值将在下一次定期认证检查中使用。</p>
				</div>
				<form className="grid gap-4" onSubmit={submit}>
					<Field error={inputError} label="新的 SSO_TGC">
						<Input
							autoComplete="off"
							disabled={replacement.isPending}
							onChange={(event) => {
								setSsoTgc(event.target.value);
								setInputError(null);
								replacement.reset();
							}}
							spellCheck={false}
							type="password"
							value={ssoTgc}
						/>
					</Field>
					<div>
						<Button disabled={replacement.isPending || ssoTgc.length === 0} type="submit">
							<KeyRound />
							{replacement.isPending ? "替换中" : "替换"}
						</Button>
					</div>
				</form>
				{replacement.isError ? (
					<div className="mt-4">
						<InlineError error={replacement.error} title="TGC 替换失败" />
					</div>
				) : null}
				{replacement.isSuccess ? (
					<p
						className="mt-4 rounded-md border border-success/20 bg-success-subtle px-3 py-2 text-success text-sm"
						role="status"
					>
						TGC 已替换，等待下一次定期认证检查。
					</p>
				) : null}
			</section>
		</section>
	);
}

function AuthStatusSummary({ status }: { status: InternalPortalAuthStatus }) {
	const run = latestRunPresentation(status.latestRun);
	return (
		<dl className="grid border-border border-y sm:grid-cols-2 xl:grid-cols-5 xl:divide-x xl:divide-border">
			<StatusValue label="凭据更新时间" value={formatTimestamp(status.credentialUpdatedAt)} />
			<StatusValue label="最近调度" value={formatTimestamp(status.lastScheduledAt)} />
			<StatusValue label="最近一次成功使用" value={formatTimestamp(status.lastSuccessfulAt)} />
			<div className="grid content-start gap-2 border-border border-b px-1 py-4 sm:px-4 xl:border-b-0">
				<dt className="font-medium text-muted-foreground text-xs">最近任务</dt>
				<dd>
					<Badge tone={run.tone}>{run.label}</Badge>
				</dd>
			</div>
			<div className="grid content-start gap-2 px-1 py-4 sm:px-4">
				<dt className="font-medium text-muted-foreground text-xs">当前值检查记录</dt>
				<dd>
					<Badge tone={status.currentCredentialChecked ? "success" : "warning"}>
						{status.currentCredentialChecked ? "已有成功记录" : "尚无成功记录"}
					</Badge>
				</dd>
			</div>
		</dl>
	);
}

function StatusValue({ label, value }: { label: string; value: string }) {
	return (
		<div className="grid content-start gap-2 border-border border-b px-1 py-4 sm:px-4 xl:border-b-0">
			<dt className="font-medium text-muted-foreground text-xs">{label}</dt>
			<dd className="font-medium text-sm">{value}</dd>
		</div>
	);
}

function latestRunPresentation(status: InternalPortalAuthStatus["latestRun"]): {
	label: string;
	tone: "danger" | "info" | "neutral" | "success";
} {
	return {
		failed: { label: "失败", tone: "danger" as const },
		never_run: { label: "尚未运行", tone: "neutral" as const },
		running: { label: "运行中", tone: "info" as const },
		succeeded: { label: "成功", tone: "success" as const },
	}[status];
}
