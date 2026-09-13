import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoticeAutomationPanel } from "../src/app/notices/notice-automation";
import type { NoticeAutomation } from "../src/shared/notice-automation-contract";

const data: NoticeAutomation = {
	supported: true,
	enabled: false,
	intervalMinutes: 15,
	timeZone: "Asia/Shanghai",
	lastScheduleTime: null,
	lastSuccessfulTime: null,
	maintenanceRange: { from: "2025-12-01", to: "2026-09-14" },
	credentialAvailable: true,
	scheduleError: null,
	stateError: null,
	credentialError: null,
};
function props() {
	return {
		data,
		error: null,
		saving: false,
		saveError: null,
		busy: false,
		latest: undefined,
		onSave: vi.fn(async (_value: unknown) => undefined),
		onRun: vi.fn(),
		onTasks: vi.fn(),
		onRetry: vi.fn(),
	};
}
describe("notice automation panel", () => {
	beforeEach(() => {
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe = vi.fn();
				unobserve = vi.fn();
				disconnect = vi.fn();
			},
		);
	});
	afterEach(() => vi.unstubAllGlobals());
	it("keeps failed drafts and only shows enabled after the saved response", async () => {
		const input = props();
		input.onSave.mockRejectedValueOnce(new Error("patch denied"));
		const view = render(<NoticeAutomationPanel {...input} />);
		fireEvent.click(screen.getByRole("switch", { name: "启用自动采集" }));
		fireEvent.change(screen.getByRole("combobox", { name: "采集频率" }), {
			target: { value: "30" },
		});
		fireEvent.click(screen.getByRole("button", { name: "保存设置" }));
		await waitFor(() =>
			expect(input.onSave).toHaveBeenCalledWith({ enabled: true, intervalMinutes: 30 }),
		);
		view.rerender(<NoticeAutomationPanel {...input} saveError={new Error("patch denied")} />);
		expect(screen.getByRole("switch")).toBeChecked();
		expect(screen.getByRole("combobox")).toHaveValue("30");
		expect(screen.getByText("已暂停")).toBeInTheDocument();
		expect(screen.getByText("patch denied")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "保存设置" }));
		await waitFor(() => expect(input.onSave).toHaveBeenCalledTimes(2));
		view.rerender(
			<NoticeAutomationPanel {...input} data={{ ...data, enabled: true, intervalMinutes: 30 }} />,
		);
		expect(screen.getByText("已开启 · 每 30 分钟")).toBeInTheDocument();
		expect(screen.getByText("已扫描范围：2025-12-01 至 2026-09-13")).toBeInTheDocument();
	});
	it("distinguishes an unavailable status from loading and does not expose a local scheduler", () => {
		const input = props();
		const view = render(
			<NoticeAutomationPanel {...input} data={undefined} error={new Error("offline")} />,
		);
		expect(screen.getByText("状态暂不可用")).toBeInTheDocument();
		expect(screen.queryByText("正在读取…")).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "重试" }));
		expect(input.onRetry).toHaveBeenCalledOnce();
		view.rerender(
			<NoticeAutomationPanel {...input} data={{ ...data, supported: false, enabled: null }} />,
		);
		expect(screen.getByText("本地环境不运行定时采集")).toBeInTheDocument();
		expect(screen.queryByRole("switch")).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "立即采集" }));
		expect(input.onRun).toHaveBeenCalledOnce();
	});
});
