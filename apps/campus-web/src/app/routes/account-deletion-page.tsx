import { Alert, AlertDescription, AlertTitle, Button } from "@campus-agent/ui";
import { useLocation } from "@tanstack/react-router";
import { CheckCircle2, CircleAlert } from "lucide-react";
import { readCampusAuthResultState } from "@/platform/auth/result-state";

export function AccountDeletionPage() {
	const location = useLocation();
	const result = readCampusAuthResultState(location.state.campusAuthResult);
	const accepted = result?.kind === "account-deletion" && result.status === "deleting";
	return (
		<div className="min-h-[calc(100dvh-var(--layout-campus-topnav-height))] px-4 py-8 lg:px-8">
			<Alert
				className="mx-auto w-full max-w-[var(--layout-page-form-width)]"
				tone={accepted ? "success" : "danger"}
			>
				{accepted ? <CheckCircle2 className="size-4" /> : <CircleAlert className="size-4" />}
				<AlertTitle>{accepted ? "注销请求已受理" : "无法确认注销请求"}</AlertTitle>
				<AlertDescription>
					{accepted
						? "账号已停止登录，聊天记录、个人记忆和关联运行数据正在清理。清理完成后无法恢复。"
						: "当前页面没有刚刚提交的注销记录。请从账号设置发起注销，或返回校园问答。"}
				</AlertDescription>
			</Alert>
			<div className="mx-auto mt-6 w-full max-w-[var(--layout-page-form-width)]">
				<Button asChild>
					<a href="/">返回校园问答</a>
				</Button>
			</div>
		</div>
	);
}
