import { lazy, Suspense, useEffect, useRef, useState } from "react";

import { campusAuthClient } from "@/platform/auth/client";
import { AccountEntry } from "./account-entry";

const AuthDialog = lazy(() =>
	import("../auth-dialog").then((module) => ({ default: module.AuthDialog })),
);
const AuthenticatedAccountMenu = lazy(() =>
	import("./authenticated-account-menu").then((module) => ({
		default: module.AuthenticatedAccountMenu,
	})),
);

export function ProductAccountEntry({
	className,
	openOnReady = false,
	variant = "icon",
}: {
	className?: string;
	openOnReady?: boolean;
	variant?: "icon" | "label";
}) {
	const [open, setOpen] = useState(false);
	const [accountMenuOpen, setAccountMenuOpen] = useState(false);
	const readyActionHandled = useRef(false);
	const session = campusAuthClient.useSession();

	useEffect(() => {
		if (!openOnReady || session.isPending || readyActionHandled.current) {
			return;
		}
		readyActionHandled.current = true;
		if (session.data) {
			setAccountMenuOpen(true);
			return;
		}
		setOpen(true);
	}, [openOnReady, session.data, session.isPending]);

	return (
		<>
			{openOnReady && session.data ? (
				<Suspense
					fallback={
						<AccountEntry
							authenticated={false}
							className={className}
							onLogin={() => undefined}
							pending
							variant={variant}
						/>
					}
				>
					<AuthenticatedAccountMenu
						onOpenChange={setAccountMenuOpen}
						onSignedOut={() => setAccountMenuOpen(false)}
						open={accountMenuOpen}
					/>
				</Suspense>
			) : (
				<AccountEntry
					authenticated={Boolean(session.data)}
					className={className}
					onLogin={() => setOpen(true)}
					pending={session.isPending}
					variant={variant}
				/>
			)}
			{open ? (
				<Suspense fallback={null}>
					<AuthDialog onOpenChange={setOpen} open />
				</Suspense>
			) : null}
		</>
	);
}
