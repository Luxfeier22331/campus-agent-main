import { Link } from "@tanstack/react-router";
import {
	AlertCircle,
	CheckCircle2,
	KeyRound,
	Loader2,
	LogIn,
	LogOut,
	UserRound,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { signOutHubAccount } from "../platform/auth/client";
import { type AccountSessionState, loadAccountSession } from "./account-session";
import { PageDescription, PageTitle, ShellSection } from "./route-layout";

export function AccountPage() {
	const [sessionState, setSessionState] = useState<AccountSessionState>("loading");
	const [email, setEmail] = useState<string | null>(null);
	const [isSigningOut, setIsSigningOut] = useState(false);

	const loadSession = useCallback(async () => {
		setSessionState("loading");
		const nextSession = await loadAccountSession();
		setEmail(nextSession.email);
		setSessionState(nextSession.state);
	}, []);

	useEffect(() => {
		void loadSession();
	}, [loadSession]);

	async function handleSignOut() {
		if (isSigningOut) {
			return;
		}
		setIsSigningOut(true);
		try {
			await signOutHubAccount();
			setEmail(null);
			setSessionState("unauthenticated");
		} catch {
			setSessionState("service_unavailable");
		} finally {
			setIsSigningOut(false);
		}
	}

	return (
		<ShellSection className="max-w-3xl">
			<PageTitle>账号</PageTitle>
			<PageDescription>管理您的 MUC Wiki Hub 账号设置与登录状态。</PageDescription>
			<div className="mt-8">
				{sessionState === "loading" ? <AccountLoadingCard /> : null}
				{sessionState === "service_unavailable" ? (
					<AccountErrorCard
						description="账号服务暂不可用，请稍后重试。"
						onRetry={loadSession}
						title="账号服务暂不可用"
					/>
				) : null}
				{sessionState === "network_error" ? (
					<AccountErrorCard
						description="无法连接账号服务，请检查网络连接后重试。"
						onRetry={loadSession}
						title="无法连接账号服务"
					/>
				) : null}
				{sessionState === "unauthenticated" ? <AccountLoggedOutCard /> : null}
				{sessionState === "ready" && email ? (
					<AccountLoggedInCard
						email={email}
						isSigningOut={isSigningOut}
						onSignOut={handleSignOut}
					/>
				) : null}
			</div>
		</ShellSection>
	);
}

function AccountLoadingCard() {
	return (
		<AccountPanel>
			<div className="flex min-h-44 flex-col items-center justify-center gap-4 text-muted-foreground">
				<Loader2 aria-hidden="true" className="size-7 animate-spin" />
				<p>正在加载账号信息...</p>
			</div>
		</AccountPanel>
	);
}

function AccountErrorCard({
	description,
	onRetry,
	title,
}: {
	description: string;
	onRetry: () => void;
	title: string;
}) {
	return (
		<AccountPanel>
			<div className="flex flex-col gap-4">
				<div className="flex gap-3">
					<span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-destructive/10 text-destructive">
						<AlertCircle aria-hidden="true" className="size-5" />
					</span>
					<div>
						<h2 className="text-lg font-semibold">{title}</h2>
						<p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
					</div>
				</div>
				<Button className="w-fit" onClick={onRetry} type="button" variant="outline">
					重试
				</Button>
			</div>
		</AccountPanel>
	);
}

function AccountLoggedOutCard() {
	return (
		<AccountPanel>
			<div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h2 className="text-lg font-semibold">尚未登录</h2>
					<p className="mt-2 text-sm text-muted-foreground">登录后可访问需要账号的校园应用。</p>
				</div>
				<div className="flex flex-wrap gap-3">
					<Button asChild>
						<Link to="/account/login">
							<LogIn aria-hidden="true" />
							登录
						</Link>
					</Button>
					<Button asChild variant="outline">
						<Link to="/account/register">注册</Link>
					</Button>
				</div>
			</div>
		</AccountPanel>
	);
}

function AccountLoggedInCard({
	email,
	isSigningOut,
	onSignOut,
}: {
	email: string;
	isSigningOut: boolean;
	onSignOut: () => void;
}) {
	return (
		<div className="flex flex-col gap-6">
			<AccountPanel>
				<p className="text-sm font-medium text-muted-foreground">当前登录账号</p>
				<div className="mt-6 rounded-lg border border-border bg-accent/60 p-5">
					<div className="flex items-center gap-4">
						<span className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
							<UserRound aria-hidden="true" className="size-5" />
						</span>
						<div>
							<p className="break-all text-xl font-semibold text-foreground">{email}</p>
							<p className="mt-1 inline-flex items-center gap-1 text-sm text-primary">
								<CheckCircle2 aria-hidden="true" className="size-4" />
								状态正常
							</p>
						</div>
					</div>
				</div>
				<div className="mt-8 flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
					<Button asChild variant="ghost">
						<Link to="/account/forgot-password">
							<KeyRound aria-hidden="true" />
							重置密码
						</Link>
					</Button>
					<Button disabled={isSigningOut} onClick={onSignOut} type="button" variant="outline">
						<LogOut aria-hidden="true" />
						{isSigningOut ? "退出中" : "退出登录"}
					</Button>
				</div>
			</AccountPanel>
			<div className="rounded-lg border border-border bg-accent/70 p-4 text-sm leading-6 text-muted-foreground">
				如果您在公共设备上使用本系统，请在结束使用后退出登录，以确保账号安全。
			</div>
		</div>
	);
}

function AccountPanel({ children }: { children: React.ReactNode }) {
	return (
		<Card className="rounded-lg border-border bg-card shadow-none">
			<CardContent className="p-6 sm:p-8">{children}</CardContent>
		</Card>
	);
}
