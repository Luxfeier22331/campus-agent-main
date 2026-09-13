import { isSessionNotFreshError } from "@better-auth-ui/core";
import {
	useListSessions,
	useRevokeOtherSessions,
	useRevokeSession,
	useRevokeSessions,
	useSignInEmail,
	useSignOut,
} from "@better-auth-ui/react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogTitle,
	Badge,
	Button,
	Field,
	Input,
} from "@campus-agent/ui";
import { useNavigate } from "@tanstack/react-router";
import Bowser from "bowser";
import { type FormEvent, useRef, useState } from "react";
import { campusAuthClient, readCampusAuthErrorMessage } from "@/platform/auth/client";
import { useCampusSession } from "@/platform/auth/session";
import {
	authRetryAfterMessage,
	resolveCaptchaHeaders,
	useAuthRetryAfter,
} from "../auth-form-retry";
import { CampusCaptcha, type CampusCaptchaHandle } from "../campus-captcha";
import { SettingsFeedback, SettingsSection } from "./settings-section";

export function AccountSessions() {
	const session = useCampusSession();
	const navigate = useNavigate();
	const sessions = useListSessions(campusAuthClient);
	const [action, setAction] = useState<"other" | "all" | null>(null);
	const [notice, setNotice] = useState<string>();
	const revoke = useRevokeSession(campusAuthClient, {
		onSuccess: () => setNotice("登录设备已移除"),
	});
	const others = useRevokeOtherSessions(campusAuthClient, {
		onSuccess: () => {
			setAction(null);
			setNotice("其他设备已退出登录");
		},
	});
	const onSignedOut = async () => {
		await session.refresh();
		void navigate({ to: "/account/login", search: { redirectTo: undefined }, replace: true });
	};
	const all = useRevokeSessions(campusAuthClient, { onSuccess: onSignedOut });
	const signOut = useSignOut(campusAuthClient, { onSuccess: onSignedOut });
	const busy = revoke.isPending || others.isPending || all.isPending || signOut.isPending;
	const error = sessions.error ?? revoke.error ?? signOut.error;
	const bulkError = action === "all" ? all.error : others.error;
	const devices = [...(sessions.data ?? [])].sort(
		(left, right) =>
			Number(right.id === session.data?.session.id) - Number(left.id === session.data?.session.id),
	);
	const fresh = async () => {
		revoke.reset();
		signOut.reset();
		await sessions.refetch();
	};
	return (
		<SettingsSection title="登录设备">
			<div className="grid gap-4">
				{isSessionNotFreshError(error) ? (
					<FreshSessionForm onFresh={fresh} />
				) : (
					<SettingsFeedback
						error={error}
						onRetry={sessions.isError ? () => void sessions.refetch() : undefined}
						success={notice}
					/>
				)}
				{sessions.isPending ? (
					<p className="ui-supporting" role="status">
						正在读取登录设备…
					</p>
				) : null}
				{sessions.data && devices.length === 0 ? (
					<p className="ui-supporting">没有可显示的登录设备。</p>
				) : null}
				{devices.length > 0 ? (
					<ul className="divide-y divide-border border-y border-border">
						{devices.map((device) => {
							const current = device.id === session.data?.session.id;
							const ua = Bowser.parse(device.userAgent ?? "");
							const deviceLabel = [ua.browser.name ?? "未知浏览器", ua.os.name]
								.filter(Boolean)
								.join(" · ");
							return (
								<li
									className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-4"
									key={device.id}
								>
									<div className="grid min-w-0 gap-1">
										<p className="break-words font-medium text-sm">{deviceLabel}</p>
										{current ? (
											<Badge className="w-fit" tone="neutral">
												当前设备
											</Badge>
										) : null}
										<p className="ui-metadata break-words">
											{device.ipAddress ?? "IP 未提供"} ·{" "}
											{new Date(device.createdAt).toLocaleString("zh-CN")}
										</p>
									</div>
									<Button
										variant="outline"
										size="sm"
										aria-label={current ? "退出登录" : `移除登录设备：${deviceLabel}`}
										disabled={busy}
										aria-busy={
											current
												? signOut.isPending
												: revoke.isPending && revoke.variables?.token === device.token
										}
										onClick={() => {
											setNotice(undefined);
											if (current) {
												signOut.mutate();
											} else {
												revoke.mutate({ token: device.token });
											}
										}}
									>
										{current
											? signOut.isPending
												? "正在退出"
												: "退出登录"
											: revoke.isPending && revoke.variables?.token === device.token
												? "正在移除"
												: "移除"}
									</Button>
								</li>
							);
						})}
					</ul>
				) : null}
				{sessions.data && !sessions.isError ? (
					<div className="flex flex-wrap gap-2">
						<Button
							variant="outline"
							disabled={busy || !devices.some((device) => device.id !== session.data?.session.id)}
							onClick={() => {
								others.reset();
								setAction("other");
							}}
						>
							退出其他设备
						</Button>
						<Button
							variant="destructive"
							disabled={busy}
							onClick={() => {
								all.reset();
								setAction("all");
							}}
						>
							退出所有设备
						</Button>
					</div>
				) : null}
			</div>
			<AlertDialog
				open={action !== null}
				onOpenChange={(open) => {
					if (!(open || busy)) {
						setAction(null);
					}
				}}
			>
				<AlertDialogContent>
					<AlertDialogTitle>
						{action === "all" ? "退出所有设备？" : "退出其他设备？"}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{action === "all"
							? "包括当前设备在内的所有登录设备都会退出，需要重新登录。"
							: "其他设备会退出登录，当前设备保持登录。"}
					</AlertDialogDescription>
					{isSessionNotFreshError(bulkError) ? (
						<FreshSessionForm
							onFresh={async () => {
								others.reset();
								all.reset();
								await sessions.refetch();
							}}
						/>
					) : (
						<SettingsFeedback error={bulkError} />
					)}
					<AlertDialogFooter>
						<AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
						<AlertDialogAction
							disabled={busy}
							aria-busy={busy}
							onClick={(event) => {
								event.preventDefault();
								setNotice(undefined);
								if (action === "all") {
									all.mutate();
								} else {
									others.mutate();
								}
							}}
						>
							{busy ? "正在退出" : "确认退出"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</SettingsSection>
	);
}

function FreshSessionForm({ onFresh }: { onFresh: () => Promise<unknown> }) {
	const session = useCampusSession();
	const captcha = useRef<CampusCaptchaHandle>(null);
	const [password, setPassword] = useState("");
	const [preparing, setPreparing] = useState(false);
	const [error, setError] = useState<string>();
	const retryAfter = useAuthRetryAfter();
	const signIn = useSignInEmail(campusAuthClient, {
		onSuccess: async () => {
			setPassword("");
			await session.refresh();
			await onFresh();
		},
	});
	const busy = preparing || signIn.isPending;
	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!session.data || busy || retryAfter.secondsRemaining > 0) {
			return;
		}
		setPreparing(true);
		setError(undefined);
		try {
			const headers = await resolveCaptchaHeaders(captcha.current);
			await signIn.mutateAsync({
				email: session.data.user.email,
				password,
				fetchOptions: headers ? { headers } : {},
			});
		} catch (cause) {
			setPassword("");
			retryAfter.start(cause);
			setError(readCampusAuthErrorMessage(cause));
		} finally {
			setPreparing(false);
			captcha.current?.reset();
		}
	}
	return (
		<form className="grid gap-3" onSubmit={(event) => void submit(event)}>
			<p className="font-medium">请重新验证登录</p>
			<p className="ui-supporting">查看和管理登录设备需要确认当前账号，请输入密码。</p>
			<Field label="密码">
				<Input
					type="password"
					autoComplete="current-password"
					value={password}
					onChange={(event) => setPassword(event.target.value)}
					disabled={busy}
					required
				/>
			</Field>
			<CampusCaptcha ref={captcha} />
			<SettingsFeedback error={authRetryAfterMessage(retryAfter.secondsRemaining) ?? error} />
			<Button
				className="justify-self-start"
				type="submit"
				disabled={busy || !password || retryAfter.secondsRemaining > 0}
				aria-busy={busy}
			>
				{busy ? "正在验证" : "验证登录"}
			</Button>
		</form>
	);
}
