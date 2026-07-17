import { Dropdown } from "@heroui/react";
import { LogOut, Settings, ShieldCheck, UserRound } from "lucide-react";
import { useState } from "react";

import { campusAuthClient } from "@/platform/auth/client";
import "../auth-styles.css";

export function AuthenticatedAccountMenu({
	onOpenChange,
	onSignedOut,
	open,
}: {
	onOpenChange: (open: boolean) => void;
	onSignedOut: () => void;
	open: boolean;
}) {
	const [signingOut, setSigningOut] = useState(false);

	async function handleAction(key: React.Key) {
		if (key === "account") {
			window.location.assign("/account/settings/account");
			return;
		}
		if (key === "security") {
			window.location.assign("/account/settings/security");
			return;
		}
		if (key !== "sign-out" || signingOut) {
			return;
		}
		setSigningOut(true);
		try {
			await campusAuthClient.signOut();
			onSignedOut();
		} finally {
			setSigningOut(false);
		}
	}

	return (
		<Dropdown isOpen={open} onOpenChange={onOpenChange}>
			<Dropdown.Trigger
				aria-label="账号"
				className="inline-flex size-11 items-center justify-center rounded-md text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
			>
				<UserRound aria-hidden="true" className="size-4" />
			</Dropdown.Trigger>
			<Dropdown.Popover placement="bottom end">
				<Dropdown.Menu aria-label="账号菜单" onAction={handleAction}>
					<Dropdown.Item id="account" textValue="账号设置">
						<Settings aria-hidden="true" className="size-4" />
						<span>账号设置</span>
					</Dropdown.Item>
					<Dropdown.Item id="security" textValue="安全设置">
						<ShieldCheck aria-hidden="true" className="size-4" />
						<span>安全设置</span>
					</Dropdown.Item>
					<Dropdown.Item id="sign-out" isDisabled={signingOut} textValue="退出登录">
						<LogOut aria-hidden="true" className="size-4" />
						<span>{signingOut ? "正在退出" : "退出登录"}</span>
					</Dropdown.Item>
				</Dropdown.Menu>
			</Dropdown.Popover>
		</Dropdown>
	);
}
