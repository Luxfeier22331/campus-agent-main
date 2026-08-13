import { useEffect, useRef, useState } from "react";

import { useCampusSession } from "@/platform/auth/session";
import { AuthDialog } from "../auth-dialog";
import { AccountEntry } from "./account-entry";

export function ProductAccountEntry({
	className,
	onLogin,
	openOnReady = false,
	presentation = "icon",
}: {
	className?: string | undefined;
	onLogin?: (() => void) | undefined;
	openOnReady?: boolean;
	presentation?: "icon" | "label";
}) {
	const [open, setOpen] = useState(false);
	const [accountMenuOpen, setAccountMenuOpen] = useState(false);
	const readyActionHandled = useRef(false);
	const session = useCampusSession();

	useEffect(() => {
		if (!openOnReady || session.status === "loading" || readyActionHandled.current) {
			return;
		}
		readyActionHandled.current = true;
		if (session.status === "authenticated") {
			setAccountMenuOpen(true);
			return;
		}
		if (session.status === "unavailable") {
			return;
		}
		if (onLogin) {
			onLogin();
			return;
		}
		setOpen(true);
	}, [onLogin, openOnReady, session.status]);

	function handleLogin() {
		if (onLogin) {
			onLogin();
			return;
		}
		setOpen(true);
	}

	return (
		<>
			<AccountEntry
				className={className}
				menuOpen={openOnReady && session.status === "authenticated" ? accountMenuOpen : undefined}
				onLogin={handleLogin}
				onMenuOpenChange={openOnReady ? setAccountMenuOpen : undefined}
				presentation={presentation}
			/>
			{!onLogin && open ? <AuthDialog onOpenChange={setOpen} open /> : null}
		</>
	);
}
