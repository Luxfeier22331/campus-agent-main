import { Button } from "@/components/ui/button";
import { campusAuthClient } from "@/platform/auth/client";
import { UserButton } from "./user-button";

export function QAAccountEntry({ onLoginPress }: { onLoginPress: () => void }) {
	const session = campusAuthClient.useSession();

	if (session.isPending) {
		return (
			<Button aria-label="账号" disabled size="sm" variant="ghost">
				<span className="text-sm" aria-hidden="true">
					账号
				</span>
			</Button>
		);
	}

	if (session.data) {
		return <UserButton />;
	}

	return (
		<Button
			aria-label="登录"
			className="min-h-8 px-2 text-xs sm:px-3"
			onClick={onLoginPress}
			size="sm"
			variant="ghost"
		>
			登录
		</Button>
	);
}
