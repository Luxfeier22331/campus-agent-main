import { campusAuthClient } from "@/platform/auth/client";
import { UserButton } from "./user-button";

export function QAAccountEntry() {
	const session = campusAuthClient.useSession();

	if (session.isPending) {
		return (
			<button aria-label="账号" disabled type="button">
				<span className="text-sm" aria-hidden="true">
					账号
				</span>
			</button>
		);
	}

	if (session.data) {
		return <UserButton />;
	}

	return <span className="text-xs">登录</span>;
}
