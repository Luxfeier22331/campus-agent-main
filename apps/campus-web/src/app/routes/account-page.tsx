import { Link } from "@tanstack/react-router";
import {
	AlertCircle,
	CheckCircle2,
	Clock3,
	KeyRound,
	Layers3,
	Loader2,
	LogIn,
	LogOut,
	ShieldCheck,
	Sparkles,
	UserRound,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { signOutAccount } from "../../platform/auth/client";
import { PageDescription, PageTitle, ShellSection } from "../root-layout";
import {
	type AccountAccess,
	type AccountIdentity,
	type AccountOverview,
	type AccountOverviewState,
	type AccountPreferences,
	type AccountPreferencesResult,
	loadAccountAccess,
	loadAccountIdentity,
	loadAccountOverview,
	loadAccountPreferences,
	updateAccountPreferences,
} from "./account-session";

type AccountScopedState = Exclude<AccountOverviewState, "unauthenticated">;

export function AccountPage() {
	const [overviewState, setOverviewState] = useState<AccountOverviewState>("loading");
	const [overview, setOverview] = useState<AccountOverview | null>(null);
	const [identityState, setIdentityState] = useState<AccountScopedState>("loading");
	const [identity, setIdentity] = useState<AccountIdentity | null>(null);
	const [accessState, setAccessState] = useState<AccountScopedState>("loading");
	const [access, setAccess] = useState<AccountAccess | null>(null);
	const [preferencesState, setPreferencesState] = useState<AccountScopedState>("loading");
	const [preferences, setPreferences] = useState<AccountPreferences | null>(null);
	const [isSigningOut, setIsSigningOut] = useState(false);
	const [isUpdatingPreferences, setIsUpdatingPreferences] = useState(false);

	const setScopedIdentityResult = useCallback(
		(result: {
			identity: AccountIdentity | null;
			state: Exclude<AccountOverviewState, "loading">;
		}) => {
			if (result.state === "unauthenticated") {
				setOverview(null);
				setOverviewState("unauthenticated");
				setIdentity(null);
				setIdentityState("service_unavailable");
				return;
			}
			setIdentity(result.identity);
			setIdentityState(result.state);
		},
		[],
	);

	const setScopedAccessResult = useCallback(
		(result: { access: AccountAccess | null; state: Exclude<AccountOverviewState, "loading"> }) => {
			if (result.state === "unauthenticated") {
				setOverview(null);
				setOverviewState("unauthenticated");
				setAccess(null);
				setAccessState("service_unavailable");
				return;
			}
			setAccess(result.access);
			setAccessState(result.state);
		},
		[],
	);

	const setScopedPreferencesResult = useCallback((result: AccountPreferencesResult) => {
		if (result.state === "unauthenticated") {
			setOverview(null);
			setOverviewState("unauthenticated");
			setPreferences(null);
			setPreferencesState("service_unavailable");
			return;
		}
		setPreferences(result.preferences);
		setPreferencesState(result.state);
	}, []);

	const loadOverview = useCallback(async () => {
		setOverviewState("loading");
		setIdentityState("loading");
		setAccessState("loading");
		setPreferencesState("loading");
		const nextOverview = await loadAccountOverview();
		setOverview(nextOverview.overview);
		setOverviewState(nextOverview.state);
		if (nextOverview.state !== "ready" || !nextOverview.overview) {
			setIdentity(null);
			setAccess(null);
			setPreferences(null);
			return;
		}

		setIdentity(nextOverview.overview.identity);
		setAccess(nextOverview.overview.access);
		setPreferences(nextOverview.overview.preferences);
		const [nextIdentity, nextAccess, nextPreferences] = await Promise.all([
			loadAccountIdentity(),
			loadAccountAccess(),
			loadAccountPreferences(),
		]);
		setScopedIdentityResult(nextIdentity);
		setScopedAccessResult(nextAccess);
		setScopedPreferencesResult(nextPreferences);
	}, [setScopedAccessResult, setScopedIdentityResult, setScopedPreferencesResult]);

	useEffect(() => {
		void loadOverview();
	}, [loadOverview]);

	async function handleSignOut() {
		if (isSigningOut) {
			return;
		}
		setIsSigningOut(true);
		try {
			await signOutAccount();
			setOverview(null);
			setIdentity(null);
			setAccess(null);
			setPreferences(null);
			setOverviewState("unauthenticated");
		} catch {
			setOverviewState("service_unavailable");
		} finally {
			setIsSigningOut(false);
		}
	}

	async function handleProfileMemoryChange(enabled: boolean) {
		if (isUpdatingPreferences) {
			return;
		}
		setIsUpdatingPreferences(true);
		setPreferencesState("loading");
		const result = await updateAccountPreferences({ profileMemoryEnabled: enabled });
		const updatedPreferences = result.preferences;
		if (result.state === "ready" && updatedPreferences) {
			setPreferences(updatedPreferences);
			setPreferencesState("ready");
			setOverview((current) =>
				current
					? {
							...current,
							preferences: updatedPreferences,
						}
					: current,
			);
		} else {
			setScopedPreferencesResult(result);
		}
		setIsUpdatingPreferences(false);
	}

	return (
		<ShellSection className="max-w-5xl">
			<PageTitle>账号</PageTitle>
			<PageDescription>管理账号信息和个性化设置。</PageDescription>
			<div className="mt-8">
				{overviewState === "loading" ? <AccountLoadingCard /> : null}
				{overviewState === "service_unavailable" ? (
					<AccountErrorCard
						description="账号服务暂不可用，请稍后重试。"
						onRetry={loadOverview}
						title="账号服务暂不可用"
					/>
				) : null}
				{overviewState === "network_error" ? (
					<AccountErrorCard
						description="无法连接账号服务，请检查网络连接后重试。"
						onRetry={loadOverview}
						title="无法连接账号服务"
					/>
				) : null}
				{overviewState === "unauthenticated" ? <AccountLoggedOutCard /> : null}
				{overviewState === "ready" && overview ? (
					<AccountOverviewPanel
						access={access}
						accessState={accessState}
						identity={identity}
						identityState={identityState}
						isSigningOut={isSigningOut}
						isUpdatingPreferences={isUpdatingPreferences}
						onProfileMemoryChange={handleProfileMemoryChange}
						onSignOut={handleSignOut}
						overview={overview}
						preferences={preferences}
						preferencesState={preferencesState}
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

export function AccountOverviewPanel({
	access,
	accessState = "ready",
	identity,
	identityState = "ready",
	isSigningOut,
	isUpdatingPreferences = false,
	onProfileMemoryChange,
	onSignOut,
	overview,
	preferences,
	preferencesState = "ready",
}: {
	access?: AccountAccess | null;
	accessState?: AccountScopedState;
	identity?: AccountIdentity | null;
	identityState?: AccountScopedState;
	isSigningOut: boolean;
	isUpdatingPreferences?: boolean;
	onProfileMemoryChange?: (enabled: boolean) => void;
	onSignOut: () => void;
	overview: AccountOverview;
	preferences?: AccountPreferences | null;
	preferencesState?: AccountScopedState;
}) {
	const resolvedIdentity = identity ?? overview.identity;
	const resolvedAccess = access ?? overview.access;
	const resolvedPreferences = preferences ?? overview.preferences;

	return (
		<div className="flex flex-col gap-6">
			<AccountPanel>
				<div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
					<div className="min-w-0">
						<p className="text-sm font-medium text-muted-foreground">当前登录账号</p>
						<div className="mt-5 flex items-start gap-4">
							<span className="grid size-12 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
								<UserRound aria-hidden="true" className="size-5" />
							</span>
							<div className="min-w-0">
								<p className="break-all text-xl font-semibold text-foreground">
									{overview.account.email}
								</p>
								<p className="mt-1 text-sm text-muted-foreground">{overview.account.displayName}</p>
								<p className="mt-2 inline-flex items-center gap-1 text-sm text-primary">
									<CheckCircle2 aria-hidden="true" className="size-4" />
									{formatAccountStatus(overview.account.status)}
								</p>
							</div>
						</div>
					</div>
					<div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
						<Button asChild variant="ghost">
							<a href="/account/forgot-password">
								<KeyRound aria-hidden="true" />
								重置密码
							</a>
						</Button>
						<Button disabled={isSigningOut} onClick={onSignOut} type="button" variant="outline">
							<LogOut aria-hidden="true" />
							{isSigningOut ? "退出中" : "退出登录"}
						</Button>
					</div>
				</div>
			</AccountPanel>

			<div className="grid gap-4 md:grid-cols-2">
				<AccountFactSection
					icon={<ShieldCheck aria-hidden="true" className="size-5" />}
					items={[
						["账号类型", "用户"],
						["验证状态", formatVerificationStatus(resolvedIdentity.verificationStatus)],
					]}
					state={identityState}
					title="账号信息"
				/>
				<AccountFactSection
					icon={<Layers3 aria-hidden="true" className="size-5" />}
					items={[
						["应用", formatAvailableApps(resolvedAccess.availableApps)],
						["权限", formatPermissions(resolvedAccess.permissions)],
						["受保护内容", resolvedAccess.restrictedSurfacesReady ? "可访问" : "暂不可访问"],
					]}
					state={accessState}
					title="应用与权限"
				/>
				<AccountFactSection
					icon={<Sparkles aria-hidden="true" className="size-5" />}
					items={[
						["状态", resolvedPreferences.profileMemoryEnabled ? "已开启" : "已关闭"],
						["已保存条目", `${resolvedPreferences.profileMemoryItemCount}`],
						["权限影响", "不会授予额外权限"],
					]}
					renderFooter={
						onProfileMemoryChange ? (
							<Button
								disabled={isUpdatingPreferences}
								onClick={() => onProfileMemoryChange(!resolvedPreferences.profileMemoryEnabled)}
								type="button"
								variant="outline"
							>
								{isUpdatingPreferences
									? "正在保存"
									: resolvedPreferences.profileMemoryEnabled
										? "关闭个性化记忆"
										: "开启个性化记忆"}
							</Button>
						) : undefined
					}
					state={preferencesState}
					title="个性化记忆"
				/>
				<AccountFactSection
					icon={<Clock3 aria-hidden="true" className="size-5" />}
					items={[
						["登录方式", formatCredentialRuntime(overview.session.credentialRuntime)],
						["登录状态有效至", formatIsoDateTime(overview.session.expiresAt)],
						["授权登录", overview.federation.enabled ? "可使用" : "暂不可用"],
					]}
					title="登录与授权"
				/>
			</div>
		</div>
	);
}

function AccountFactSection({
	icon,
	items,
	renderFooter,
	state = "ready",
	title,
}: {
	icon: ReactNode;
	items: [string, string][];
	renderFooter?: ReactNode;
	state?: AccountScopedState;
	title: string;
}) {
	return (
		<AccountPanel>
			<div className="flex items-center gap-3">
				<span className="grid size-10 shrink-0 place-items-center rounded-md bg-accent text-primary">
					{icon}
				</span>
				<h2 className="text-base font-semibold">{title}</h2>
			</div>
			{state === "loading" ? (
				<div className="mt-5 flex min-h-28 items-center gap-3 text-sm text-muted-foreground">
					<Loader2 aria-hidden="true" className="size-4 animate-spin" />
					正在加载
				</div>
			) : null}
			{state === "service_unavailable" || state === "network_error" ? (
				<div className="mt-5 flex min-h-28 gap-3 rounded-md border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
					<AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
					<span>{state === "network_error" ? "无法连接账号服务" : "账号服务暂不可用"}</span>
				</div>
			) : null}
			{state === "ready" ? (
				<>
					<dl className="mt-5 flex flex-col gap-3">
						{items.map(([label, value]) => (
							<div className="grid gap-1 sm:grid-cols-[7rem_1fr]" key={label}>
								<dt className="text-sm text-muted-foreground">{label}</dt>
								<dd className="break-words text-sm font-medium text-foreground">{value}</dd>
							</div>
						))}
					</dl>
					{renderFooter ? (
						<div className="mt-5 border-t border-border pt-5">{renderFooter}</div>
					) : null}
				</>
			) : null}
		</AccountPanel>
	);
}

function AccountPanel({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<Card className={cn("rounded-lg border-border bg-card shadow-none", className)}>
			<CardContent className="p-6 sm:p-8">{children}</CardContent>
		</Card>
	);
}

function formatAccountStatus(status: AccountOverview["account"]["status"]): string {
	switch (status) {
		case "active":
			return "状态正常";
		case "deleted":
			return "已删除";
		case "pending_recovery":
			return "恢复处理中";
		case "suspended":
			return "已暂停";
		default:
			return "状态待确认";
	}
}

function formatVerificationStatus(status: AccountIdentity["verificationStatus"]): string {
	switch (status) {
		case "expired":
			return "已过期";
		case "manual_review":
			return "人工审核";
		case "unverified":
			return "未验证";
		case "verified":
			return "已验证";
		default:
			return "状态待确认";
	}
}

function formatPermissions(permissions: AccountAccess["permissions"]): string {
	const enabled = Object.entries(permissions)
		.filter(([, value]) => value)
		.map(([key]) => formatPermissionKey(key));
	return enabled.length > 0 ? enabled.join(" / ") : "无";
}

function formatAvailableApps(apps: string[]): string {
	const labels = apps.map((app) => formatAvailableAppKey(app));
	return labels.length > 0 ? labels.join(" / ") : "无";
}

function formatAvailableAppKey(key: string): string {
	switch (key) {
		case "campus-web":
			return "校园问答";
		default:
			return "其他应用";
	}
}

function formatPermissionKey(key: string): string {
	switch (key) {
		case "chat":
			return "问答";
		case "operator":
			return "运营管理";
		default:
			return "其他权限";
	}
}

function formatCredentialRuntime(runtime: string): string {
	switch (runtime) {
		case "better-auth":
			return "邮箱密码";
		default:
			return "其他方式";
	}
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
