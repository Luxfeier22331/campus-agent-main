import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, RefreshCw } from "lucide-react";
import { type FormEvent, useState } from "react";

import type { OpsInternalPortalAuthStatus } from "../shared/ops-contract";
import { formatDuration, formatTimestamp } from "./format";
import {
	fetchInternalPortalAuthStatus,
	replaceInternalPortalCredential,
	validateInternalPortalAuthentication,
} from "./ops-api-client";
import { ErrorState, InlineError, KeyValue, PageHeader, PageShell } from "./ops-display";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

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
	if (status.isError || !status.data) {
		return (
			<section>
				<PageHeader description="内部门户凭据、保活状态与轮换记录。" title="门户认证" />
				<Card>
					<CardContent className="p-4 sm:p-5">
						<ErrorState
							error={status.error}
							onRetry={() => status.refetch()}
							title="门户认证状态读取失败"
						/>
					</CardContent>
				</Card>
			</section>
		);
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
			<PageHeader description="内部门户凭据、保活状态与轮换记录。" title="门户认证" />
			<div className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
				<Card>
					<CardHeader>
						<CardTitle>保活状态</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="mb-3 flex items-center gap-2">
							<Badge tone={status.data.configured ? "success" : "warning"}>
								{status.data.configured ? "已配置" : "未配置"}
							</Badge>
							<Badge tone={maintenanceTone}>{maintenanceLabel}</Badge>
						</div>
						<KeyValue
							label="最近更新"
							value={status.data.updatedAt ? formatTimestamp(status.data.updatedAt) : "暂无记录"}
						/>
						<KeyValue label="更新人" value={status.data.updatedBy ?? "暂无记录"} />
						<KeyValue
							label="最近保活"
							value={
								status.data.maintenance.lastAttemptAt
									? formatTimestamp(status.data.maintenance.lastAttemptAt)
									: "暂无记录"
							}
						/>
						<KeyValue
							label="最近成功"
							value={
								status.data.maintenance.lastSuccessAt
									? formatTimestamp(status.data.maintenance.lastSuccessAt)
									: "暂无记录"
							}
						/>
						<KeyValue
							label="下次保活"
							value={
								status.data.maintenance.nextRunAt
									? formatTimestamp(status.data.maintenance.nextRunAt)
									: "暂无记录"
							}
						/>
						<KeyValue
							label="已观测有效时长"
							value={formatObservedLifetime(status.data.observedLifetime)}
						/>
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
									<p className="mt-3 text-emerald-700 text-sm" role="status">
										验证已提交，成功后通知采集将自动恢复。
									</p>
								) : null}
							</div>
						) : null}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>替换凭据</CardTitle>
					</CardHeader>
					<CardContent>
						<form className="grid gap-4" onSubmit={submit}>
							<div className="grid gap-2">
								<label className="font-medium text-slate-700 text-sm" htmlFor="portal-credential">
									SSO_TGC 或 Cookie
								</label>
								<input
									autoComplete="off"
									className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 font-mono text-sm outline-none focus:border-slate-600 focus:ring-2 focus:ring-slate-200"
									disabled={replacement.isPending}
									id="portal-credential"
									maxLength={8 * 1024}
									onChange={(event) => {
										setCredential(event.target.value);
										replacement.reset();
									}}
									spellCheck={false}
									type="password"
									value={credential}
								/>
							</div>
							{replacement.isError ? (
								<InlineError error={replacement.error} title="凭据替换失败" />
							) : null}
							{replacement.isSuccess ? (
								<p className="text-emerald-700 text-sm" role="status">
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
		return "等待保活验证";
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
			return "保活已暂停";
		case "MISSING":
			return "保活未部署";
		case "UNAVAILABLE":
			return "保活状态不可用";
		default:
			break;
	}
	switch (lastOutcome) {
		case "SUCCESS":
			return "保活正常";
		case "RUNNING":
			return "保活中";
		case "TRANSIENT_FAILURE":
			return "暂时异常";
		default:
			return "等待首次保活";
	}
}

function formatObservedLifetime(input: {
	lowerBoundSeconds: number | null;
	upperBoundSeconds: number | null;
}) {
	if (input.lowerBoundSeconds === null) {
		return "暂无记录";
	}
	const lower = formatDuration(input.lowerBoundSeconds * 1_000);
	return input.upperBoundSeconds === null
		? `至少 ${lower}`
		: `${lower} - ${formatDuration(input.upperBoundSeconds * 1_000)}`;
}
