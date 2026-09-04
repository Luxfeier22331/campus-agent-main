import { Badge, Button, Card, CardContent } from "@campus-agent/ui";
import { Check, ShieldCheck, TriangleAlert } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
	buildFallbackCampusOAuthClient,
	type CampusOAuthClientContext,
	type CampusOAuthContext,
	parseCampusOAuthClient,
	resolveCampusOAuthContext,
	resolveSafeOAuthRedirectTarget,
} from "@/platform/auth/oauth-context";

export function FederationConsentPage({ search }: { search?: string } = {}) {
	const oauthContext = useMemo(() => readOAuthContext(search), [search]);
	const fallbackClient = useMemo(
		() => (oauthContext ? buildFallbackCampusOAuthClient(oauthContext.clientId) : null),
		[oauthContext],
	);
	const [client, setClient] = useState<CampusOAuthClientContext | null>(fallbackClient);
	const [clientStatus, setClientStatus] = useState<"idle" | "loading" | "ready" | "unavailable">(
		oauthContext ? "loading" : "idle",
	);
	const [submission, setSubmission] = useState<"idle" | "error" | "submitting">("idle");

	useEffect(() => {
		let active = true;
		if (!oauthContext) {
			setClient(null);
			setClientStatus("idle");
			setSubmission("idle");
			return () => {
				active = false;
			};
		}

		setClient(fallbackClient);
		setClientStatus("loading");
		setSubmission("idle");
		void fetch(`/api/federation/client?client_id=${encodeURIComponent(oauthContext.clientId)}`, {
			cache: "no-store",
			credentials: "same-origin",
			headers: { accept: "application/json" },
		})
			.then(async (response) => {
				if (!response.ok) {
					throw new Error("client_unavailable");
				}
				return parseCampusOAuthClient(await response.json(), oauthContext.clientId);
			})
			.then((resolvedClient) => {
				if (!active) {
					return;
				}
				if (!resolvedClient) {
					setClientStatus("unavailable");
					return;
				}
				setClient(resolvedClient);
				setClientStatus("ready");
			})
			.catch(() => {
				if (active) {
					setClientStatus("unavailable");
				}
			});

		return () => {
			active = false;
		};
	}, [fallbackClient, oauthContext]);

	if (!(oauthContext && client)) {
		return (
			<FederationPageShell>
				<FederationStatusHeader
					icon={<ShieldCheck aria-hidden="true" className="size-5" />}
					title="使用校园账号登录"
				/>
				<p className="text-muted-foreground text-sm leading-6">登录请求不可用，请重新开始。</p>
				<Button asChild className="mt-6 w-full" variant="outline">
					<a href="/account">返回账号</a>
				</Button>
			</FederationPageShell>
		);
	}

	const activeOAuthContext = oauthContext;
	const title = `使用校园账号登录 ${client.displayName}`;
	const canAccept = Boolean(activeOAuthContext.oauthQuery) && clientStatus === "ready";
	const canRespond = Boolean(activeOAuthContext.oauthQuery) && submission !== "submitting";

	async function submitConsent(accept: boolean) {
		if (!activeOAuthContext.oauthQuery || (accept && !canAccept)) {
			return;
		}
		setSubmission("submitting");
		try {
			const response = await fetch("/api/federation/consent", {
				body: JSON.stringify({ accept, oauth_query: activeOAuthContext.oauthQuery }),
				cache: "no-store",
				credentials: "same-origin",
				headers: { accept: "application/json", "content-type": "application/json" },
				method: "POST",
			});
			const payload = await response.json().catch(() => null);
			const result =
				payload && typeof payload === "object" && !Array.isArray(payload)
					? (payload as Record<string, unknown>)
					: null;
			if (!(response.ok && result) || result.redirect !== true || typeof result.url !== "string") {
				throw new Error("consent_failed");
			}
			const target = resolveSafeOAuthRedirectTarget(result.url, window.location.origin);
			if (!target) {
				throw new Error("unsafe_redirect");
			}
			window.location.assign(target);
		} catch {
			setSubmission("error");
		}
	}

	return (
		<FederationPageShell>
			<FederationStatusHeader
				icon={<ShieldCheck aria-hidden="true" className="size-5" />}
				title={title}
			/>
			<OAuthClientPanel client={client} oauthContext={oauthContext} />
			<p className="text-muted-foreground text-sm leading-6">
				允许后，{client.displayName} 可以使用这些信息完成登录。
			</p>
			{clientStatus === "unavailable" ? (
				<p className="mt-4 text-destructive text-sm">无法确认此应用，暂不能授权。</p>
			) : null}
			{submission === "error" ? (
				<p className="mt-4 text-destructive text-sm">授权暂未完成，请稍后重试。</p>
			) : null}
			<div className="mt-6 grid gap-3">
				<Button
					className="w-full"
					disabled={!canAccept || submission === "submitting"}
					onClick={() => void submitConsent(true)}
				>
					允许并继续
				</Button>
				<Button
					className="w-full"
					disabled={!canRespond}
					onClick={() => void submitConsent(false)}
					variant="outline"
				>
					取消
				</Button>
			</div>
		</FederationPageShell>
	);
}

export function FederationErrorPage({ search }: { search?: string } = {}) {
	const error = useMemo(() => readOAuthError(search), [search]);
	return (
		<FederationPageShell>
			<FederationStatusHeader
				icon={<TriangleAlert aria-hidden="true" className="size-5" />}
				title="登录授权未完成"
			/>
			<div className="rounded-md border border-destructive/20 bg-destructive/5 p-4">
				<p className="font-medium text-destructive text-sm">{error.title}</p>
				<p className="mt-2 text-muted-foreground text-sm leading-6">{error.description}</p>
			</div>
			<Button asChild className="mt-6 w-full" variant="outline">
				<a href="/account/login">返回登录</a>
			</Button>
		</FederationPageShell>
	);
}

function readOAuthContext(search?: string): CampusOAuthContext | null {
	if (search === undefined && typeof window === "undefined") {
		return null;
	}
	return resolveCampusOAuthContext(search ?? window.location.search);
}

function readOAuthError(search?: string): { description: string; title: string } {
	if (search === undefined && typeof window === "undefined") {
		return {
			description: "请回到刚才的应用重新开始。",
			title: "登录请求不可用",
		};
	}
	const params = new URLSearchParams(search ?? window.location.search);
	const code = params.get("error")?.trim() || "invalid_request";
	if (code === "access_denied") {
		return {
			description: "可以返回登录页，或回到刚才的应用重新开始。",
			title: "您已取消授权",
		};
	}
	if (code === "invalid_client" || code === "invalid_redirect_uri") {
		return {
			description: "请回到刚才的应用重新开始，或稍后再试。",
			title: "这个应用暂时无法完成登录",
		};
	}
	return {
		description: "请回到刚才的应用重新开始。",
		title: "登录请求不可用",
	};
}

function FederationPageShell({ children }: { children: ReactNode }) {
	return (
		<section className="mx-auto min-h-[calc(100dvh-var(--layout-campus-topnav-height))] w-full max-w-lg px-5 py-10 lg:px-8 lg:py-14">
			<Card className="rounded-lg border-input shadow-none">
				<CardContent className="p-6 sm:p-8">{children}</CardContent>
			</Card>
		</section>
	);
}

function FederationStatusHeader({ icon, title }: { icon: ReactNode; title: string }) {
	return (
		<div className="mb-8 text-center">
			<span className="mx-auto mb-5 grid size-12 place-items-center rounded-lg bg-foreground text-background">
				{icon}
			</span>
			<h1 className="font-semibold text-2xl tracking-normal">{title}</h1>
		</div>
	);
}

function OAuthClientPanel({
	client,
	oauthContext,
}: {
	client: CampusOAuthClientContext;
	oauthContext: CampusOAuthContext;
}) {
	return (
		<div className="mb-6 rounded-lg border border-border bg-surface-muted/40 p-4">
			<div className="flex items-center justify-between gap-4">
				<div>
					<p className="font-semibold text-foreground text-sm">{client.displayName}</p>
					<p className="mt-1 text-muted-foreground text-xs">{client.hostLabel}</p>
				</div>
				<Badge tone="neutral">授权登录</Badge>
			</div>
			<div className="mt-4 border-border border-t pt-4">
				<p className="font-medium text-muted-foreground text-xs uppercase">
					{client.displayName} 将获得
				</p>
				<ul className="mt-3 grid gap-2">
					{oauthContext.scopeItems.map((item) => (
						<li className="flex items-center gap-2 text-foreground text-sm" key={item}>
							<Check aria-hidden="true" className="size-4 text-selected-foreground" />
							<span>{item}</span>
						</li>
					))}
				</ul>
			</div>
		</div>
	);
}
