import type { ConfirmDialogProps } from "@campus-agent/ui";
import { useRef, useState } from "react";
import { describeError } from "./ops-display";

/** Page-owned confirmation state; the supplied mutation still owns the request and invalidation. */
export function useConfirmCommand() {
	const [selected, setSelected] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const running = useRef(false);
	return (
		key: string,
		execute: () => Promise<unknown>,
	): Pick<ConfirmDialogProps, "open" | "onOpenChange" | "onConfirm" | "pending" | "error"> => ({
		open: selected === key,
		pending,
		error: selected === key ? error : null,
		onOpenChange(open) {
			if (running.current) {
				return;
			}
			setSelected(open ? key : null);
			setError(null);
		},
		onConfirm() {
			if (running.current) {
				return;
			}
			running.current = true;
			setPending(true);
			setError(null);
			void (async () => {
				try {
					await execute();
					setSelected(null);
				} catch (caught) {
					setError(describeError(caught).message);
				} finally {
					running.current = false;
					setPending(false);
				}
			})();
		},
	});
}
