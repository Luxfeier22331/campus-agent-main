import { Button, ConfirmDialog } from "@campus-agent/ui";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useConfirmCommand } from "../src/app/use-confirm-command";

function Fixture({ execute }: { execute(): Promise<unknown> }) {
	const confirm = useConfirmCommand();
	return (
		<ConfirmDialog
			{...confirm("delete", execute)}
			title="删除配置？"
			description="配置将移除。"
			confirmLabel="确认删除"
			trigger={<Button>删除配置</Button>}
		/>
	);
}
it("awaits a command, exposes rejection, then closes only after successful retry", async () => {
	let reject!: (error: Error) => void;
	let resolve!: (value: unknown) => void;
	const execute = vi.fn(
		() =>
			new Promise((r, j) => {
				resolve = r;
				reject = j;
			}),
	);
	render(<Fixture execute={execute} />);
	fireEvent.click(screen.getByRole("button", { name: "删除配置" }));
	fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
	expect(screen.getByRole("button", { name: "处理中…" })).toBeDisabled();
	await act(async () => reject(new Error("服务暂时不可用")));
	expect(screen.getByRole("alertdialog")).toBeVisible();
	expect(screen.getByRole("alert")).toHaveTextContent("服务暂时不可用");
	fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
	await act(async () => resolve({ accepted: true }));
	await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
	expect(execute).toHaveBeenCalledTimes(2);
});
