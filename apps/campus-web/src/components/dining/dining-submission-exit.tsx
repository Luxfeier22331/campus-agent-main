import {
	AlertDialog,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	Button,
} from "@campus-agent/ui";
import { useBlocker } from "@tanstack/react-router";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";

interface EditState {
	dirty: boolean;
	pending: boolean;
}
interface ExitControl {
	register(read: () => EditState): () => void;
	requestExit(exit: () => void): void;
}
const ExitContext = createContext<ExitControl | null>(null);

// One active Dining editor; the page owns both its overlays and route departures.
export function DiningSubmissionExitProvider({ children }: { children: ReactNode }) {
	const editor = useRef<(() => EditState) | null>(null);
	const decision = useRef<((leave: boolean) => void) | null>(null);
	const [confirming, setConfirming] = useState(false);
	const continueButton = useRef<HTMLButtonElement>(null);
	const register = useCallback((read: () => EditState) => {
		editor.current = read;
		return () => {
			if (editor.current === read) {
				editor.current = null;
			}
		};
	}, []);
	const decide = useCallback((leave: boolean) => {
		const resolve = decision.current;
		decision.current = null;
		setConfirming(false);
		resolve?.(leave);
	}, []);
	const confirmExit = useCallback((): Promise<boolean> => {
		const state = editor.current?.();
		if (state?.pending || decision.current) {
			return Promise.resolve(false);
		}
		if (!state?.dirty) {
			return Promise.resolve(true);
		}
		setConfirming(true);
		return new Promise((resolve) => {
			decision.current = resolve;
		});
	}, []);
	const requestExit = useCallback(
		(exit: () => void) => {
			void confirmExit().then((leave) => {
				if (leave) {
					exit();
				}
			});
		},
		[confirmExit],
	);
	useBlocker({
		shouldBlockFn: async () => !(await confirmExit()),
		enableBeforeUnload: () => {
			const state = editor.current?.();
			return Boolean(state?.dirty || state?.pending);
		},
	});
	useEffect(
		() => () => {
			decision.current?.(false);
		},
		[],
	);
	return (
		<ExitContext.Provider value={{ register, requestExit }}>
			{children}
			<AlertDialog
				open={confirming}
				onOpenChange={(open) => {
					if (!open) {
						decide(false);
					}
				}}
			>
				<AlertDialogContent
					onOpenAutoFocus={(event) => {
						event.preventDefault();
						continueButton.current?.focus();
					}}
				>
					<AlertDialogHeader>
						<AlertDialogTitle>放弃未保存的修改？</AlertDialogTitle>
						<AlertDialogDescription>关闭后，未保存的文字和所选照片将丢失。</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<Button ref={continueButton} variant="outline" onClick={() => decide(false)}>
							继续编辑
						</Button>
						<Button variant="destructive" onClick={() => decide(true)}>
							放弃修改
						</Button>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</ExitContext.Provider>
	);
}

export function useDiningSubmissionExit() {
	const control = useContext(ExitContext);
	if (!control) {
		throw new Error("Dining editor requires DiningSubmissionExitProvider.");
	}
	return control;
}
