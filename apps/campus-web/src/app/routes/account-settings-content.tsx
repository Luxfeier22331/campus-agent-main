import { Link } from "@tanstack/react-router";
import {
	AlertCircle,
	CheckCircle2,
	KeyRound,
	Loader2,
	LogIn,
	LogOut,
	ShieldCheck,
	Sparkles,
	Trash2,
	Undo2,
	UserRound,
	X,
} from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import type { ConversationSummary } from "@/features/conversation/model";
import { cn } from "@/lib/utils";
import {
	AccountAuthorizedAppsSection,
	AccountPanel,
	AccountSessionsSection,
} from "./account-security-sections";
import type {
	AccountAccess,
	AccountAuthorizedApp,
	AccountIdentity,
	AccountOverview,
	AccountOverviewState,
	AccountPreferences,
	AccountSecuritySession,
} from "./account-session";

type AccountScopedState = Exclude<AccountOverviewState, "unauthenticated">;
export type AccountSettingsSectionId = "account" | "apps" | "history" | "memory" | "security";

export function AccountSettingsHeader({
	closeHref,
	onClose,
}: {
	closeHref?: string;
	onClose?: () => void;
}) {
	return (
		<header className="flex min-h-14 items-center justify-between gap-4 px-4 sm:px-6">
			<div className="min-w-0">
				<h1 className="truncate text-lg font-semibold text-[var(--sys-text-strong)]">设置</h1>
			</div>
			{closeHref ? (
				<a
					aria-label="关闭设置"
					className="grid size-9 shrink-0 place-items-center rounded-lg text-[var(--sys-text-muted)] hover:bg-[var(--sys-bg-muted)]"
					href={closeHref}
				>
					<X aria-hidden="true" className="size-5" />
				</a>
			) : (
				<button
					aria-label="关闭设置"
					className="grid size-9 shrink-0 place-items-center rounded-lg text-[var(--sys-text-muted)] hover:bg-[var(--sys-bg-muted)]"
					onClick={onClose}
					type="button"
				>
					<X aria-hidden="true" className="size-5" />
				</button>
			)}
		</header>
	);
}

export function AccountSettingsContent({
	access,
	accessState,
	activeSection,
	archivedConversations,
	archivedConversationsState,
	authorizedApps,
	authorizedAppsState,
	deletingClientId,
	deletingConversationId,
	deletingSessionId,
	identity,
	identityState,
	isSigningOut,
	isUpdatingPreferences,
	onActiveSectionChange,
	onDeleteAuthorizedApp,
	onDeleteArchivedConversation,
	onDeleteSecuritySession,
	onProfileMemoryChange,
	onRetry,
	onRestoreArchivedConversation,
	onSignOut,
	overview,
	overviewState,
	preferences,
	preferencesState,
	restoringConversationId,
	securitySessions,
	securitySessionsState,
}: {
	access: AccountAccess | null;
	accessState: AccountScopedState;
	activeSection: AccountSettingsSectionId;
	archivedConversations: ConversationSummary[];
	archivedConversationsState: AccountScopedState;
	authorizedApps: AccountAuthorizedApp[];
	authorizedAppsState: AccountScopedState;
	deletingClientId: string | null;
	deletingConversationId: string | null;
	deletingSessionId: string | null;
	identity: AccountIdentity | null;
	identityState: AccountScopedState;
	isSigningOut: boolean;
	isUpdatingPreferences: boolean;
	onActiveSectionChange: (section: AccountSettingsSectionId) => void;
	onDeleteAuthorizedApp: (clientId: string) => void;
	onDeleteArchivedConversation: (conversationId: string) => void;
	onDeleteSecuritySession: (sessionId: string) => void;
	onProfileMemoryChange: (enabled: boolean) => void;
	onRetry: () => void;
	onRestoreArchivedConversation: (conversationId: string) => void;
	onSignOut: () => void;
	overview: AccountOverview | null;
	overviewState: AccountOverviewState;
	preferences: AccountPreferences | null;
	preferencesState: AccountScopedState;
	restoringConversationId: string | null;
	securitySessions: AccountSecuritySession[];
	securitySessionsState: AccountScopedState;
}) {
	if (overviewState === "loading") {
		return <AccountLoadingCard />;
	}
	if (overviewState === "service_unavailable") {
		return (
			<AccountErrorCard
				description="账号服务暂不可用，请稍后重试。"
				onRetry={onRetry}
				title="账号服务暂不可用"
			/>
		);
	}
	if (overviewState === "network_error") {
		return (
			<AccountErrorCard
				description="无法连接账号服务，请检查网络连接后重试。"
				onRetry={onRetry}
				title="无法连接账号服务"
			/>
		);
	}
	if (overviewState === "unauthenticated" || !overview) {
		return <AccountLoggedOutCard />;
	}
	return (
		<AccountOverviewPanel
			access={access}
			accessState={accessState}
			activeSection={activeSection}
			archivedConversations={archivedConversations}
			archivedConversationsState={archivedConversationsState}
			authorizedApps={authorizedApps}
			authorizedAppsState={authorizedAppsState}
			deletingClientId={deletingClientId}
			deletingConversationId={deletingConversationId}
			deletingSessionId={deletingSessionId}
			identity={identity}
			identityState={identityState}
			isSigningOut={isSigningOut}
			isUpdatingPreferences={isUpdatingPreferences}
			onActiveSectionChange={onActiveSectionChange}
			onDeleteAuthorizedApp={onDeleteAuthorizedApp}
			onDeleteArchivedConversation={onDeleteArchivedConversation}
			onDeleteSecuritySession={onDeleteSecuritySession}
			onProfileMemoryChange={onProfileMemoryChange}
			onRestoreArchivedConversation={onRestoreArchivedConversation}
			onSignOut={onSignOut}
			overview={overview}
			preferences={preferences}
			preferencesState={preferencesState}
			restoringConversationId={restoringConversationId}
			securitySessions={securitySessions}
			securitySessionsState={securitySessionsState}
		/>
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

function AccountOverviewPanel({
	access,
	accessState = "ready",
	activeSection = "account",
	archivedConversations = [],
	archivedConversationsState = "ready",
	authorizedApps = [],
	authorizedAppsState = "ready",
	deletingClientId = null,
	deletingConversationId = null,
	deletingSessionId = null,
	identity,
	identityState = "ready",
	isSigningOut,
	isUpdatingPreferences = false,
	onActiveSectionChange,
	onDeleteAuthorizedApp,
	onDeleteArchivedConversation,
	onDeleteSecuritySession,
	onProfileMemoryChange,
	onRestoreArchivedConversation,
	onSignOut,
	overview,
	preferences,
	preferencesState = "ready",
	restoringConversationId = null,
	securitySessions = [],
	securitySessionsState = "ready",
}: {
	access?: AccountAccess | null;
	accessState?: AccountScopedState;
	activeSection?: AccountSettingsSectionId;
	archivedConversations?: ConversationSummary[];
	archivedConversationsState?: AccountScopedState;
	authorizedApps?: AccountAuthorizedApp[];
	authorizedAppsState?: AccountScopedState;
	deletingClientId?: string | null;
	deletingConversationId?: string | null;
	deletingSessionId?: string | null;
	identity?: AccountIdentity | null;
	identityState?: AccountScopedState;
	isSigningOut: boolean;
	isUpdatingPreferences?: boolean;
	onActiveSectionChange?: (section: AccountSettingsSectionId) => void;
	onDeleteAuthorizedApp?: (clientId: string) => void;
	onDeleteArchivedConversation?: (conversationId: string) => void;
	onDeleteSecuritySession?: (sessionId: string) => void;
	onProfileMemoryChange?: (enabled: boolean) => void;
	onRestoreArchivedConversation?: (conversationId: string) => void;
	onSignOut: () => void;
	overview: AccountOverview;
	preferences?: AccountPreferences | null;
	preferencesState?: AccountScopedState;
	restoringConversationId?: string | null;
	securitySessions?: AccountSecuritySession[];
	securitySessionsState?: AccountScopedState;
}) {
	const resolvedIdentity = identity ?? overview.identity;
	const resolvedAccess = access ?? overview.access;
	const resolvedPreferences = preferences ?? overview.preferences;

	return (
		<div className="grid min-h-[520px] gap-6 md:grid-cols-[176px_minmax(0,1fr)]">
			<nav
				aria-label="设置分类"
				className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible"
			>
				{accountSettingsSections.map((section) => (
					<button
						className={cn(
							"min-h-10 shrink-0 rounded-lg px-3 text-left text-sm font-medium text-[var(--sys-text-muted)] hover:bg-[var(--sys-bg-muted)] hover:text-[var(--sys-text-strong)]",
							activeSection === section.id &&
								"bg-[var(--sys-bg-muted)] text-[var(--sys-text-strong)]",
						)}
						key={section.id}
						onClick={() => onActiveSectionChange?.(section.id)}
						type="button"
					>
						{section.label}
					</button>
				))}
			</nav>
			<div className="min-w-0">
				{renderAccountSettingsSection({
					accessState,
					activeSection,
					archivedConversations,
					archivedConversationsState,
					authorizedApps,
					authorizedAppsState,
					deletingClientId,
					deletingConversationId,
					deletingSessionId,
					identityState,
					isSigningOut,
					isUpdatingPreferences,
					onDeleteAuthorizedApp,
					onDeleteArchivedConversation,
					onDeleteSecuritySession,
					onProfileMemoryChange,
					onRestoreArchivedConversation,
					onSignOut,
					overview,
					preferencesState,
					restoringConversationId,
					resolvedAccess,
					resolvedIdentity,
					resolvedPreferences,
					securitySessions,
					securitySessionsState,
				})}
			</div>
		</div>
	);
}

const accountSettingsSections: { id: AccountSettingsSectionId; label: string }[] = [
	{ id: "account", label: "账号" },
	{ id: "security", label: "登录与安全" },
	{ id: "apps", label: "授权应用" },
	{ id: "memory", label: "个性化" },
	{ id: "history", label: "历史记录" },
];

function renderAccountSettingsSection({
	accessState,
	activeSection,
	archivedConversations,
	archivedConversationsState,
	authorizedApps,
	authorizedAppsState,
	deletingClientId,
	deletingConversationId,
	deletingSessionId,
	identityState,
	isSigningOut,
	isUpdatingPreferences,
	onDeleteAuthorizedApp,
	onDeleteArchivedConversation,
	onDeleteSecuritySession,
	onProfileMemoryChange,
	onRestoreArchivedConversation,
	onSignOut,
	overview,
	preferencesState,
	restoringConversationId,
	resolvedAccess,
	resolvedIdentity,
	resolvedPreferences,
	securitySessions,
	securitySessionsState,
}: {
	accessState: AccountScopedState;
	activeSection: AccountSettingsSectionId;
	archivedConversations: ConversationSummary[];
	archivedConversationsState: AccountScopedState;
	authorizedApps: AccountAuthorizedApp[];
	authorizedAppsState: AccountScopedState;
	deletingClientId: string | null;
	deletingConversationId: string | null;
	deletingSessionId: string | null;
	identityState: AccountScopedState;
	isSigningOut: boolean;
	isUpdatingPreferences: boolean;
	onDeleteAuthorizedApp?: (clientId: string) => void;
	onDeleteArchivedConversation?: (conversationId: string) => void;
	onDeleteSecuritySession?: (sessionId: string) => void;
	onProfileMemoryChange?: (enabled: boolean) => void;
	onRestoreArchivedConversation?: (conversationId: string) => void;
	onSignOut: () => void;
	overview: AccountOverview;
	preferencesState: AccountScopedState;
	restoringConversationId: string | null;
	resolvedAccess: AccountAccess;
	resolvedIdentity: AccountIdentity;
	resolvedPreferences: AccountPreferences;
	securitySessions: AccountSecuritySession[];
	securitySessionsState: AccountScopedState;
}) {
	if (activeSection === "security") {
		return (
			<AccountSessionsSection
				credentialRuntime={overview.session.credentialRuntime}
				deletingSessionId={deletingSessionId}
				onDeleteSecuritySession={onDeleteSecuritySession}
				sessions={securitySessions}
				state={securitySessionsState}
			/>
		);
	}
	if (activeSection === "apps") {
		return (
			<AccountAuthorizedAppsSection
				apps={authorizedApps}
				deletingClientId={deletingClientId}
				onDeleteAuthorizedApp={onDeleteAuthorizedApp}
				state={authorizedAppsState}
			/>
		);
	}
	if (activeSection === "memory") {
		return (
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
				title="个性化"
			/>
		);
	}
	if (activeSection === "history") {
		return (
			<ArchivedConversationsSection
				conversations={archivedConversations}
				deletingConversationId={deletingConversationId}
				onDeleteArchivedConversation={onDeleteArchivedConversation}
				onRestoreArchivedConversation={onRestoreArchivedConversation}
				restoringConversationId={restoringConversationId}
				state={archivedConversationsState}
			/>
		);
	}
	return (
		<div className="flex flex-col gap-4">
			<AccountPanel>
				<div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
					<div className="min-w-0">
						<div className="flex items-start gap-4">
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
			<AccountFactSection
				icon={<ShieldCheck aria-hidden="true" className="size-5" />}
				items={[
					["账号类型", "用户"],
					["验证状态", formatVerificationStatus(resolvedIdentity.verificationStatus)],
					["应用与权限", formatAvailableApps(resolvedAccess.availableApps)],
					["权限", formatPermissions(resolvedAccess.permissions)],
					["受保护内容", resolvedAccess.restrictedSurfacesReady ? "可访问" : "暂不可访问"],
				]}
				state={identityState === "ready" ? accessState : identityState}
				title="账号信息"
			/>
		</div>
	);
}

function ArchivedConversationsSection({
	conversations,
	deletingConversationId,
	onDeleteArchivedConversation,
	onRestoreArchivedConversation,
	restoringConversationId,
	state,
}: {
	conversations: ConversationSummary[];
	deletingConversationId: string | null;
	onDeleteArchivedConversation?: (conversationId: string) => void;
	onRestoreArchivedConversation?: (conversationId: string) => void;
	restoringConversationId: string | null;
	state: AccountScopedState;
}) {
	return (
		<AccountPanel>
			<div className="flex items-center gap-3">
				<span className="grid size-10 shrink-0 place-items-center rounded-md bg-accent text-primary">
					<Undo2 aria-hidden="true" className="size-5" />
				</span>
				<h2 className="text-base font-semibold">已归档聊天</h2>
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
					<span>历史记录暂不可用</span>
				</div>
			) : null}
			{state === "ready" ? (
				conversations.length > 0 ? (
					<ul className="mt-5 divide-y divide-border">
						{conversations.map((conversation) => {
							const busy =
								restoringConversationId === conversation.id ||
								deletingConversationId === conversation.id;
							return (
								<li className="flex min-h-14 items-center gap-3 py-2" key={conversation.id}>
									<p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
										{conversation.title}
									</p>
									<Button
										aria-label={`恢复 ${conversation.title}`}
										disabled={busy}
										onClick={() => onRestoreArchivedConversation?.(conversation.id)}
										type="button"
										variant="ghost"
									>
										<Undo2 aria-hidden="true" />
										恢复
									</Button>
									<Button
										aria-label={`删除 ${conversation.title}`}
										disabled={busy}
										onClick={() => onDeleteArchivedConversation?.(conversation.id)}
										type="button"
										variant="ghost"
									>
										<Trash2 aria-hidden="true" />
										删除
									</Button>
								</li>
							);
						})}
					</ul>
				) : (
					<p className="mt-5 text-sm text-muted-foreground">没有已归档聊天</p>
				)
			) : null}
		</AccountPanel>
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
	const labels = Array.from(new Set(apps.map((app) => formatAvailableAppKey(app))));
	return labels.length > 0 ? labels.join(" / ") : "无";
}

function formatAvailableAppKey(key: string): string {
	switch (key) {
		case "account":
			return "账号";
		case "campus-web":
			return "校园问答";
		case "chat":
			return "问答";
		case "docs":
			return "文档";
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
