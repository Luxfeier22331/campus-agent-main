import { Check, ShieldCheck, TriangleAlert } from "lucide-react";
import { type ReactNode, useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { type CampusOAuthContext, resolveCampusOAuthContext } from "@/platform/auth/oauth-context";

export function FederationConsentPage() {
	const oauthContext = useMemo(readOAuthContext, []);
	const title = oauthContext
		? `使用校园账号登录 ${oauthContext.client.displayName}`
		: "使用校园账号登录";

	return (
		<FederationPageShell>
			<FederationStatusHeader
				icon={<ShieldCheck aria-hidden="true" className="size-5" />}
				title={title}
			/>
			{oauthContext ? <OAuthClientPanel oauthContext={oauthContext} /> : null}
			<p className="text-muted-foreground text-sm leading-6">
				允许后，{oauthContext?.client.displayName ?? "发起应用"} 可以使用这些信息完成登录。
			</p>
			<Button asChild className="mt-6 w-full">
				<a href={oauthContext?.authorizePath ?? "/account"}>允许并继续</a>
			</Button>
		</FederationPageShell>
	);
}

export function FederationErrorPage() {
	const error = useMemo(readOAuthError, []);
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

function readOAuthContext(): CampusOAuthContext | null {
	if (typeof window === "undefined") {
		return null;
	}
	return resolveCampusOAuthContext(window.location.search);
}

function readOAuthError(): { description: string; title: string } {
	if (typeof window === "undefined") {
		return {
			description: "请回到刚才的应用重新开始。",
			title: "登录请求不可用",
		};
	}
	const params = new URLSearchParams(window.location.search);
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
		<section className="mx-auto w-full max-w-lg px-5 py-10 lg:px-8 lg:py-14">
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

function OAuthClientPanel({ oauthContext }: { oauthContext: CampusOAuthContext }) {
	return (
		<div className="mb-6 rounded-lg border border-border bg-surface-muted/40 p-4">
			<div className="flex items-center justify-between gap-4">
				<div>
					<p className="font-semibold text-foreground text-sm">{oauthContext.client.displayName}</p>
					<p className="mt-1 text-muted-foreground text-xs">{oauthContext.client.hostLabel}</p>
				</div>
				<Badge variant="outline">授权登录</Badge>
			</div>
			<div className="mt-4 border-border border-t pt-4">
				<p className="font-medium text-muted-foreground text-xs uppercase">
					{oauthContext.client.displayName} 将获得
				</p>
				<ul className="mt-3 grid gap-2">
					{oauthContext.client.scopeItems.map((item) => (
						<li className="flex items-center gap-2 text-foreground text-sm" key={item}>
							<Check aria-hidden="true" className="size-4 text-primary" />
							<span>{item}</span>
						</li>
					))}
				</ul>
			</div>
		</div>
	);
}
