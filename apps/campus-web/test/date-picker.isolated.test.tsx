import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CampusDateRangePicker } from "../src/components/ui/date-picker";

describe.each(["2026-09-03", "2026-09-10", "2026-09-11"])("date range editing on %s", (date) => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date(`${date}T12:00:00+08:00`));
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("edits without applying, resets selection after clear, and cancels drafts", async () => {
		const onApply = vi.fn();
		render(<CampusDateRangePicker from="2026-09-07" to="2026-09-10" onApply={onApply} />);
		fireEvent.click(screen.getByRole("button", { name: /发布日期：/ }));
		await screen.findByRole("dialog");
		fireEvent.click(screen.getByRole("button", { name: "清除日期" }));
		fireEvent.click(screen.getByRole("button", { name: /^(今天，即 )?2026年9月3日星期四$/ }));
		expect(onApply).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "应用" }));
		expect(onApply).toHaveBeenLastCalledWith({ from: "2026-09-03", to: undefined });
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		fireEvent.click(screen.getByRole("button", { name: /发布日期：/ }));
		await screen.findByRole("dialog");
		fireEvent.click(screen.getByRole("button", { name: "清除日期" }));
		fireEvent.click(screen.getByRole("button", { name: "取消" }));
		expect(onApply).toHaveBeenCalledOnce();
	});
	it("rejects inverted ranges, allows correction, and follows the endpoint month", async () => {
		const onApply = vi.fn();
		render(<CampusDateRangePicker from="2026-09-07" to="2026-10-10" onApply={onApply} />);
		fireEvent.click(screen.getByRole("button", { name: /发布日期：/ }));
		await screen.findByRole("dialog");
		await userEvent.click(screen.getByRole("spinbutton", { name: "年, 结束" }));
		expect(screen.getByRole("grid", { name: "2026年10月" })).toBeVisible();
		fireEvent.click(screen.getByRole("button", { name: "上个月" }));
		fireEvent.click(screen.getByRole("button", { name: /^(今天，即 )?2026年9月3日星期四$/ }));
		fireEvent.click(screen.getByRole("button", { name: "应用" }));
		expect(onApply).not.toHaveBeenCalled();
		expect(screen.getByRole("alert")).toHaveTextContent("开始日期不能晚于结束日期");
		fireEvent.click(screen.getByRole("button", { name: /^(今天，即 )?2026年9月10日星期四$/ }));
		fireEvent.click(screen.getByRole("button", { name: "应用" }));
		expect(onApply).toHaveBeenLastCalledWith({ from: "2026-09-07", to: "2026-09-10" });
	});
});
