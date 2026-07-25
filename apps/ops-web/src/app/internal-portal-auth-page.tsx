import { Badge, Button, Card, CardContent, Field, Input } from "@campus-agent/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, RefreshCw } from "lucide-react";
import { type FormEvent, useState } from "react";
import type { OpsInternalPortalAuthStatus } from "../shared/ops-contract";
import { formatHumanDuration, formatTimestamp } from "./format";
import {
	fetchInternalPortalAuthStatus,
	replaceInternalPortalCredential,
	validateInternalPortalAuthentication,
} from "./ops-api-client";
import {
	ErrorState,
	InlineError,
	KeyValue,
	PageHeader,
	PageShell,
	StaleDataWarning,
} from "./ops-display";

const STATUS_QUERY_KEY = ["ops", "internal-portal-auth"] as const;

export function InternalPortalAuthPage() {
	const queryClient = useQueryClient();
	const [credential, setCredential] = useState("");
	const status = useQuery({
		queryFn: ({ signal }) => fetchInternalPortalAuthStatus({ signal }),
		queryKey: STATUS_QUERY_KEY,
		refetchInterval: 5_000,
	});
	const replacement = useMutation({
		mutationFn: replaceInternalPortalCredential,
		onSuccess: (nextStatus) => {
			queryClient.setQueryData(STATUS_QUERY_KEY, nextStatus);
			setCredential("");
		},
	});
	const validation = useMutation({
		mutationFn: validateInternalPortalAuthentication,
		onSuccess: (nextStatus) => queryClient.setQueryData(STATUS_QUERY_KEY, nextStatus),
	});

	if (status.isPending) {
		return <PageShell title="门户认证">正在读取门户认证状态...</PageShell>;
	}
	if (status.isError && !status.data) {
		return (
			<section>
				<PageHeader
					description="查看内部门户登录是否可用，并在凭据失效时更新认证。"
					title="门户认证"
				/>
				<ErrorState
					error={status.error}
					onRetry={() => status.refetch()}
					title="门户认证状态读取失败"
				/>
			</section>
		);
	}
	if (!status.data) {
		return <PageShell title="门户认证">正在读取门户认证状态...</PageShell>;
	}

	const submit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (credential.trim() && !replacement.isPending) {
			replacement.mutate(credential);
		}
	};
	const pendingValidation = isPendingValidation(status.data);
	const maintenanceLabel = getMaintenanceLabel(status.data, pendingValidation);
	const maintenanceTone = getMaintenanceTone(status.data, pendingValidation);
	const canValidate = status.data.configured && status.data.maintenance.lastOutcome !== "RUNNING";

	return (
		<section>
			<PageHeader
				description="查看内部门户登录是否可用，并在凭据失效时更新认证。"
				title="门户认证"
			/>
			{status.isRefetchError ? (
				<StaleDataWarning
					error={status.error}
					lastSuccessfulAt={status.dataUpdatedAt}
					onRetry={() => void status.refetch()}
					title="门户认证状态刷新失败"
				/>
			) : null}
			<div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(340px,1fr)]">
				<section aria-labelledby="portal-auth-status-heading" className="min-w-0">
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div>
							<h2 className="font-semibold text-lg" id="portal-auth-status-heading">
								当前状态
							</h2>
							<p className="mt-1 text-muted-foreground text-sm">
								系统会定期验证凭据，失效后暂停依赖门户认证的通知采集。
							</p>
						</div>
						<Badge tone={maintenanceTone}>{maintenanceLabel}</Badge>
					</div>
					<div className="mt-4 grid border-border border-y sm:grid-cols-2 lg:grid-cols-3">
						<KeyValue label="凭据" value={status.data.configured ? "已配置" : "未配置"} />
						<KeyValue
							label="最近更新"
							value={status.data.updatedAt ? formatTimestamp(status.data.updatedAt) : "暂无记录"}
						/>
						<KeyValue label="更新人" value={status.data.updatedBy ?? "暂无记录"} />
						<KeyValue
							label="最近验证"
							value={
								status.data.maintenance.lastAttemptAt
									? formatTimestamp(status.data.maintenance.lastAttemptAt)
									: "暂无记录"
							}
						/>
						<KeyValue
							label="最近验证成功"
							value={
								status.data.maintenance.lastSuccessAt
									? formatTimestamp(status.data.maintenance.lastSuccessAt)
									: "暂无记录"
							}
						/>
						<KeyValue
							label="下次验证"
							value={
								status.data.maintenance.nextRunAt
									? formatTimestamp(status.data.maintenance.nextRunAt)
									: "暂无记录"
							}
						/>
						<KeyValue
							label="已确认有效时长"
							value={formatObservedLifetime(status.data.observedLifetime)}
						/>
					</div>
					{canValidate ? (
						<div className="mt-4">
							<Button
								disabled={validation.isPending}
								onClick={() => validation.mutate()}
								type="button"
							>
								<RefreshCw className="size-4" />
								{validation.isPending ? "提交中" : "立即验证"}
							</Button>
							{validation.isError ? (
								<div className="mt-3">
									<InlineError error={validation.error} title="立即验证失败" />
								</div>
							) : null}
							{validation.isSuccess ? (
								<p className="mt-3 text-success text-sm" role="status">
									验证已提交，成功后通知采集将自动恢复。
								</p>
							) : null}
						</div>
					) : null}
				</section>

				<Card className="self-start">
					<CardContent className="p-5">
						<h2 className="font-semibold text-lg">替换凭据</h2>
						<p className="mt-1 text-muted-foreground text-sm">
							保存后会立即验证，原始内容不会在页面中回显。
						</p>
						<form className="grid gap-4" onSubmit={submit}>
							<Field
								className="mt-4"
								description="可粘贴 SSO_TGC 值，或包含 SSO_TGC 的完整 Cookie。"
								id="portal-credential"
								label="SSO_TGC 或 Cookie"
							>
								<Input
									autoComplete="off"
									className="min-h-11 font-mono"
									disabled={replacement.isPending}
									id="portal-credential"
									maxLength={8 * 1024}
									name="portalCredential"
									onChange={(event) => {
										setCredential(event.target.value);
										replacement.reset();
									}}
									spellCheck={false}
									type="password"
									value={credential}
								/>
							</Field>
							{replacement.isError ? (
								<InlineError error={replacement.error} title="凭据替换失败" />
							) : null}
							{replacement.isSuccess ? (
								<p className="text-success text-sm" role="status">
									凭据已替换并提交验证，验证成功后通知采集将自动恢复。
								</p>
							) : null}
							<div>
								<Button disabled={!credential.trim() || replacement.isPending} type="submit">
									<KeyRound className="size-4" />
									{replacement.isPending ? "替换中" : "替换凭据"}
								</Button>
							</div>
						</form>
					</CardContent>
				</Card>
			</div>
		</section>
	);
}

function getMaintenanceLabel(status: OpsInternalPortalAuthStatus, pendingValidation: boolean) {
	if (!status.configured) {
		return "等待配置";
	}
	if (
		status.maintenance.scheduleState === "MISSING" ||
		status.maintenance.scheduleState === "UNAVAILABLE"
	) {
		return maintenanceStatusLabel(status.maintenance.scheduleState, status.maintenance.lastOutcome);
	}
	if (pendingValidation) {
		return "等待验证";
	}
	return maintenanceStatusLabel(status.maintenance.scheduleState, status.maintenance.lastOutcome);
}

function getMaintenanceTone(
	status: OpsInternalPortalAuthStatus,
	pendingValidation: boolean,
): "success" | "warning" | "danger" {
	if (!status.configured) {
		return "warning";
	}
	if (status.maintenance.scheduleState === "MISSING") {
		return "danger";
	}
	if (status.maintenance.scheduleState === "UNAVAILABLE" || pendingValidation) {
		return "warning";
	}
	if (
		status.maintenance.scheduleState === "PAUSED" ||
		status.maintenance.lastOutcome === "CREDENTIAL_EXPIRED" ||
		status.maintenance.lastOutcome === "CREDENTIAL_UNAVAILABLE"
	) {
		return "danger";
	}
	if (
		status.maintenance.scheduleState === "ACTIVE" &&
		status.maintenance.lastOutcome === "SUCCESS"
	) {
		return "success";
	}
	return "warning";
}

function isPendingValidation(status: {
	maintenance: { lastAttemptAt: string | null };
	updatedAt: string | null;
}) {
	if (!status.updatedAt) {
		return false;
	}
	return !status.maintenance.lastAttemptAt || status.maintenance.lastAttemptAt < status.updatedAt;
}

function maintenanceStatusLabel(
	scheduleState: "ACTIVE" | "PAUSED" | "MISSING" | "UNAVAILABLE",
	lastOutcome:
		| "SUCCESS"
		| "TRANSIENT_FAILURE"
		| "CREDENTIAL_EXPIRED"
		| "CREDENTIAL_UNAVAILABLE"
		| "RUNNING"
		| "UNKNOWN"
		| null,
) {
	if (lastOutcome === "CREDENTIAL_EXPIRED") {
		return "凭据已过期";
	}
	if (lastOutcome === "CREDENTIAL_UNAVAILABLE") {
		return "凭据不可用";
	}
	switch (scheduleState) {
		case "PAUSED":
			return "自动验证已暂停";
		case "MISSING":
			return "自动验证未部署";
		case "UNAVAILABLE":
			return "验证状态不可用";
		default:
			break;
	}
	switch (lastOutcome) {
		case "SUCCESS":
			return "认证正常";
		case "RUNNING":
			return "验证中";
		case "TRANSIENT_FAILURE":
			return "验证暂时异常";
		default:
			return "等待首次验证";
	}
}

function formatObservedLifetime(input: {
	lowerBoundSeconds: number | null;
	upperBoundSeconds: number | null;
}) {
	if (input.lowerBoundSeconds === null) {
		return "暂无记录";
	}
	const lower = formatHumanDuration(input.lowerBoundSeconds * 1_000);
	return input.upperBoundSeconds === null
		? `${lower}以上`
		: `${lower} 至 ${formatHumanDuration(input.upperBoundSeconds * 1_000)}`;
}
