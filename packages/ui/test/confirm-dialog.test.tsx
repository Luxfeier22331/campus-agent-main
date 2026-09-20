import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { Button, ConfirmDialog, Field, Input } from "../src";

afterEach(cleanup);
function Fixture({
	execute,
	remove = false,
	password = false,
}: {
	execute(): Promise<void>;
	remove?: boolean;
	password?: boolean;
}) {
	const [open, setOpen] = useState(false);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState("");
	const [exists, setExists] = useState(true);
	const fallback = useRef<HTMLHeadingElement>(null);
	return (
		<>
			<h1 ref={fallback} tabIndex={-1}>
				列表
			</h1>
			<ConfirmDialog
				open={open}
				onOpenChange={setOpen}
				title="删除记录？"
				description="删除后停止公开。"
				confirmLabel="确认删除"
				pending={pending}
				error={error}
				fallbackFocusRef={fallback}
				formId="confirmation"
				{...(exists ? { trigger: <Button>删除</Button> } : {})}
				onConfirm={() => {
					setPending(true);
					setError("");
					void execute()
						.then(
							() => {
								setOpen(false);
								if (remove) {
									setExists(false);
								}
							},
							() => setError("删除失败"),
						)
						.finally(() => setPending(false));
				}}
			>
				{password ? (
					<Field label="密码">
						<Input required form="confirmation" />
					</Field>
				) : null}
			</ConfirmDialog>
		</>
	);
}
it("keeps cancellation as initial focus, traps pending Escape and preserves rejected dialogs", async () => {
	const user = userEvent.setup();
	let reject!: () => void;
	const execute = vi.fn(
		() =>
			new Promise<void>((_, r) => {
				reject = () => r(new Error("failed"));
			}),
	);
	render(<Fixture execute={execute} />);
	const trigger = screen.getByRole("button", { name: "删除" });
	await user.click(trigger);
	expect(screen.getByRole("button", { name: "取消" })).toHaveFocus();
	await user.click(screen.getByRole("button", { name: "确认删除" }));
	await user.keyboard("{Escape}");
	expect(screen.getByRole("alertdialog")).toBeVisible();
	expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
	expect(execute).toHaveBeenCalledTimes(1);
	await act(async () => reject());
	expect(screen.getByRole("alert")).toHaveTextContent("删除失败");
	await user.click(screen.getByRole("button", { name: "取消" }));
	expect(trigger).toHaveFocus();
});
it("restores a stable destination after the deleted trigger disappears", async () => {
	const user = userEvent.setup();
	render(<Fixture execute={async () => undefined} remove />);
	await user.click(screen.getByRole("button", { name: "删除" }));
	await user.click(screen.getByRole("button", { name: "确认删除" }));
	expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
	expect(screen.getByRole("heading", { name: "列表" })).toHaveFocus();
});
it("honors required fields and native Enter submission without nested forms", async () => {
	const user = userEvent.setup();
	const execute = vi.fn(async () => undefined);
	render(<Fixture execute={execute} password />);
	await user.click(screen.getByRole("button", { name: "删除" }));
	await user.click(screen.getByRole("button", { name: "确认删除" }));
	expect(execute).not.toHaveBeenCalled();
	await user.type(screen.getByRole("textbox", { name: "密码" }), "secret{Enter}");
	expect(execute).toHaveBeenCalledTimes(1);
});
