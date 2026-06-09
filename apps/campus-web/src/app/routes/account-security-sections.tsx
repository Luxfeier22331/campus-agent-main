import { AlertCircle, Clock3, Layers3, Loader2 } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type {
	AccountAuthorizedApp,
	AccountOverviewState,
	AccountSecuritySession,
} from "./account-session";

type AccountScopedState = Exclude<AccountOverviewState, "unauthenticated">;

export function AccountPanel({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<Card className={cn("rounded-lg border-border bg-card shadow-none", className)}>
			<CardContent className="p-6 sm:p-8">{children}</CardContent>
		</Card>
	);
}

export function AccountSessionsSection({
	credentialRuntime,
	deletingSessionId,
	onDeleteSecuritySession,
	sessions,
	state,
}: {
	credentialRuntime: string;
	deletingSessionId: string | null;
	onDeleteSecuritySession?: (sessionId: string) => void;
	sessions: AccountSecuritySession[];
	state: AccountScopedState;
}) {
	return (
		<AccountPanel>
			<AccountSectionHeader
				icon={<Clock3 aria-hidden="true" className="size-5" />}
				title="登录与安全"
			/>
			<AccountAsyncState state={state} />
			{state === "ready" ? (
				<div className="mt-5 flex flex-col gap-5">
					<dl className="grid gap-1 sm:grid-cols-[7rem_1fr]">
						<dt className="text-sm text-muted-foreground">登录方式</dt>
						<dd className="text-sm font-medium text-foreground">
							{formatCredentialRuntime(credentialRuntime)}
						</dd>
					</dl>
					{sessions.length === 0 ? (
						<p className="rounded-md border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
							当前没有其他登录记录。
						</p>
					) : (
						<ul className="flex flex-col gap-3">
							{sessions.map((session) => (
								<li className="rounded-md border border-border p-4" key={session.sessionId}>
									<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
										<div className="min-w-0">
											<div className="flex flex-wrap items-center gap-2">
												<p className="font-medium text-foreground">{session.deviceLabel}</p>
												{session.current ? (
													<span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
														当前登录
													</span>
												) : null}
											</div>
											<p className="mt-2 text-sm text-muted-foreground">
												最近使用 {formatIsoDateTime(session.lastActiveAt)}
											</p>
											<p className="mt-1 text-sm text-muted-foreground">
												有效至 {formatIsoDateTime(session.expiresAt)}
											</p>
										</div>
										{session.current ? null : (
											<Button
												disabled={deletingSessionId === session.sessionId}
												onClick={() => onDeleteSecuritySession?.(session.sessionId)}
												type="button"
												variant="outline"
											>
												{deletingSessionId === session.sessionId ? "正在移除" : "移除此设备"}
											</Button>
										)}
									</div>
								</li>
							))}
						</ul>
					)}
				</div>
			) : null}
		</AccountPanel>
	);
}

export function AccountAuthorizedAppsSection({
	apps,
	deletingClientId,
	onDeleteAuthorizedApp,
	state,
}: {
	apps: AccountAuthorizedApp[];
	deletingClientId: string | null;
	onDeleteAuthorizedApp?: (clientId: string) => void;
	state: AccountScopedState;
}) {
	return (
		<AccountPanel>
			<AccountSectionHeader
				icon={<Layers3 aria-hidden="true" className="size-5" />}
				title="授权应用"
			/>
			<AccountAsyncState state={state} />
			{state === "ready" ? (
				<div className="mt-5">
					{apps.length === 0 ? (
						<p className="rounded-md border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
							当前没有已授权应用。
						</p>
					) : (
						<ul className="flex flex-col gap-3">
							{apps.map((app) => (
								<li className="rounded-md border border-border p-4" key={app.clientId}>
									<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
										<div className="min-w-0">
											<p className="font-medium text-foreground">{app.displayName}</p>
											<p className="mt-2 text-sm text-muted-foreground">
												{formatGrantedScopes(app.grantedScopes)}
											</p>
											<p className="mt-1 text-sm text-muted-foreground">
												授权于 {formatIsoDateTime(app.authorizedAt)}
											</p>
										</div>
										<Button
											aria-label={`取消授权 ${app.displayName}`}
											disabled={deletingClientId === app.clientId}
											onClick={() => onDeleteAuthorizedApp?.(app.clientId)}
											type="button"
											variant="outline"
										>
											{deletingClientId === app.clientId ? "正在取消" : "取消授权"}
										</Button>
									</div>
								</li>
							))}
						</ul>
					)}
				</div>
			) : null}
		</AccountPanel>
	);
}

function AccountSectionHeader({ icon, title }: { icon: ReactNode; title: string }) {
	return (
		<div className="flex items-center gap-3">
			<span className="grid size-10 shrink-0 place-items-center rounded-md bg-accent text-primary">
				{icon}
			</span>
			<h2 className="text-base font-semibold">{title}</h2>
		</div>
	);
}

function AccountAsyncState({ state }: { state: AccountScopedState }) {
	if (state === "loading") {
		return (
			<div className="mt-5 flex min-h-28 items-center gap-3 text-sm text-muted-foreground">
				<Loader2 aria-hidden="true" className="size-4 animate-spin" />
				正在加载
			</div>
		);
	}
	if (state === "service_unavailable" || state === "network_error") {
		return (
			<div className="mt-5 flex min-h-28 gap-3 rounded-md border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
				<AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
				<span>{state === "network_error" ? "无法连接账号服务" : "账号服务暂不可用"}</span>
			</div>
		);
	}
	return null;
}

function formatCredentialRuntime(runtime: string): string {
	switch (runtime) {
		case "better-auth":
		case "better_auth":
			return "邮箱密码";
		default:
			return "其他方式";
	}
}

function formatGrantedScopes(scopes: string[]): string {
	const labels = scopes.map((scope) => {
		switch (scope) {
			case "openid":
				return "基础登录信息";
			case "profile":
				return "个人资料";
			case "email":
				return "邮箱地址";
			default:
				return "账号信息";
		}
	});
	const uniqueLabels = Array.from(new Set(labels));
	return uniqueLabels.length > 0 ? uniqueLabels.join(" / ") : "账号信息";
}

function formatIsoDateTime(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.valueOf())) {
		return "时间待确认";
	}
	return date.toLocaleString("zh-CN", {
		dateStyle: "medium",
		timeStyle: "short",
	});
}
