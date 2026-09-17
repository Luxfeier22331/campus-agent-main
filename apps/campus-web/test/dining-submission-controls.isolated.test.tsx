import type { DiningMySubmission } from "@campus-agent/dining/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
	createDiningSubmission: vi.fn(),
	updateDiningSubmission: vi.fn(),
	deleteDiningSubmission: vi.fn(),
	getMyDiningSubmission: vi.fn(),
	getMyDiningSubmissions: vi.fn(),
}));
const session = vi.hoisted(() => ({
	data: { user: { id: "user-1" } },
	status: "authenticated",
	isRefreshing: false,
	refresh: vi.fn(),
}));
vi.mock("@/features/dining/submission-api", async (original) => ({
	...(await original<typeof import("../src/features/dining/submission-api")>()),
	...api,
}));
vi.mock("@tanstack/react-router", () => ({ useBlocker: vi.fn() }));
vi.mock("@/platform/auth/session", () => ({ useCampusSession: () => session }));

import { DiningMySubmissions } from "../src/components/dining/dining-my-submissions";
import {
	DiningSubmissionExitProvider,
	useDiningSubmissionExit,
} from "../src/components/dining/dining-submission-exit";
import { DiningSubmissionForm } from "../src/components/dining/dining-submission-form";
import { ApiRequestError } from "../src/platform/api/client";

const at = "2026-09-15T00:00:00.000Z";
const own: DiningMySubmission = {
	submissionId: "submission-1",
	windowId: "window-1",
	name: "牛肉面",
	priceText: "12 元",
	status: "public",
	canEdit: true,
	canDelete: true,
	createdAt: at,
	updatedAt: at,
	deletedAt: null,
	expiresAt: null,
	hiddenAt: null,
	revision: 2,
	windowAvailable: true,
	photo: {
		photoId: "photo-1",
		width: 20,
		height: 20,
		url: "/api/dining/me/submissions/submission-1/photos/photo-1",
	},
};
const deleted: DiningMySubmission = {
	submissionId: "submission-1",
	windowId: "window-1",
	status: "deleted",
	canEdit: false,
	canDelete: false,
	createdAt: at,
	updatedAt: at,
	deletedAt: at,
	expiresAt: "2026-10-15T00:00:00.000Z",
	hiddenAt: null,
	revision: 3,
	windowAvailable: true,
};
let client: QueryClient;
const saved = vi.fn();
const cancel = vi.fn();
let createUrl: ReturnType<typeof vi.fn>;
let revokeUrl: ReturnType<typeof vi.fn>;
function wrap(children: ReactNode) {
	return (
		<QueryClientProvider client={client}>
			<DiningSubmissionExitProvider>{children}</DiningSubmissionExitProvider>
		</QueryClientProvider>
	);
}
function form(submission?: DiningMySubmission) {
	return (
		<DiningSubmissionForm
			{...(submission ? { submission } : {})}
			onCancel={cancel}
			onSaved={saved}
			windowId="window-1"
			windowName="第一窗口"
		/>
	);
}
function submit() {
	fireEvent.submit(screen.getByRole("form"));
}

beforeEach(() => {
	vi.clearAllMocks();
	for (const fn of Object.values(api)) {
		fn.mockReset();
	}
	session.data.user.id = "user-1";
	session.status = "authenticated";
	client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	api.createDiningSubmission.mockResolvedValue({ submission: own });
	api.updateDiningSubmission.mockResolvedValue({ submission: own });
	api.deleteDiningSubmission.mockResolvedValue(undefined);
	api.getMyDiningSubmission.mockResolvedValue({ submission: own });
	api.getMyDiningSubmissions.mockResolvedValue({ items: [own], nextCursor: null });
	createUrl = vi.fn().mockReturnValue("blob:preview");
	revokeUrl = vi.fn();
	Object.defineProperty(URL, "createObjectURL", {
		configurable: true,
		writable: true,
		value: createUrl,
	});
	Object.defineProperty(URL, "revokeObjectURL", {
		configurable: true,
		writable: true,
		value: revokeUrl,
	});
});
afterEach(() => {
	client.clear();
});

describe("Dining submission form", () => {
	it("keeps one key for manual retries and creates a new key only after changing the request", async () => {
		api.createDiningSubmission.mockRejectedValue(new Error("暂时不可用"));
		render(wrap(form()));
		fireEvent.change(screen.getByLabelText("菜品名称"), { target: { value: "牛肉面" } });
		submit();
		await screen.findByRole("alert");
		expect(screen.getByLabelText("菜品名称")).toHaveValue("牛肉面");
		submit();
		await waitFor(() => expect(api.createDiningSubmission).toHaveBeenCalledTimes(2));
		await waitFor(() => expect(screen.getByRole("button", { name: "发布投稿" })).toBeEnabled());
		expect(api.createDiningSubmission.mock.calls[0]?.[0].idempotencyKey).toBe(
			api.createDiningSubmission.mock.calls[1]?.[0].idempotencyKey,
		);
		fireEvent.change(screen.getByLabelText("价格说明（选填）"), { target: { value: "15 元" } });
		submit();
		await waitFor(() => expect(api.createDiningSubmission).toHaveBeenCalledTimes(3));
		expect(api.createDiningSubmission.mock.calls[2]?.[0].idempotencyKey).not.toBe(
			api.createDiningSubmission.mock.calls[0]?.[0].idempotencyKey,
		);
		expect(saved).not.toHaveBeenCalled();
	});
	it("disables duplicate submission while pending and exposes server validation failures", async () => {
		let fail: (error: Error) => void = () => undefined;
		api.createDiningSubmission.mockImplementation(
			() =>
				new Promise((_resolve, reject) => {
					fail = reject;
				}),
		);
		render(wrap(form()));
		fireEvent.change(screen.getByLabelText("菜品名称"), { target: { value: "牛肉面" } });
		submit();
		await waitFor(() => expect(screen.getByRole("button", { name: "正在保存" })).toBeDisabled());
		expect(screen.getByLabelText("菜品名称")).toBeDisabled();
		submit();
		expect(api.createDiningSubmission).toHaveBeenCalledOnce();
		await act(async () =>
			fail(
				new ApiRequestError({
					message: "不支持动画照片",
					status: 422,
					code: "dining_submission_photo_invalid",
				}),
			),
		);
		expect(await screen.findByRole("alert")).toHaveTextContent("包含动画或尺寸超限");
		expect(saved).not.toHaveBeenCalled();
	});
	it("previews a single photo, changes upload identity after replacing it, and releases preview URLs", async () => {
		api.createDiningSubmission.mockRejectedValue(new Error("暂时不可用"));
		const view = render(wrap(form()));
		fireEvent.change(screen.getByLabelText("菜品名称"), { target: { value: "牛肉面" } });
		const first = new File(["photo"], "first.png", { type: "image/png" });
		fireEvent.change(screen.getByLabelText("照片（选填）"), { target: { files: [first] } });
		expect(await screen.findByAltText("投稿照片预览")).toHaveAttribute("src", "blob:preview");
		submit();
		await screen.findByRole("alert");
		const second = new File(["new"], "second.webp", { type: "image/webp" });
		fireEvent.change(screen.getByLabelText("照片（选填）"), { target: { files: [second] } });
		submit();
		await waitFor(() => expect(api.createDiningSubmission).toHaveBeenCalledTimes(2));
		expect(api.createDiningSubmission.mock.calls[1]?.[0]).toMatchObject({
			photo: second,
			metadata: { photoAction: "replace" },
		});
		expect(api.createDiningSubmission.mock.calls[1]?.[0].idempotencyKey).not.toBe(
			api.createDiningSubmission.mock.calls[0]?.[0].idempotencyKey,
		);
		view.unmount();
		expect(revokeUrl).toHaveBeenCalledTimes(2);
	});
	it("clears the unsaved fields and photo when the authenticated user changes", async () => {
		const view = render(wrap(form()));
		fireEvent.change(screen.getByLabelText("菜品名称"), { target: { value: "私有草稿" } });
		fireEvent.change(screen.getByLabelText("照片（选填）"), {
			target: { files: [new File(["photo"], "dish.png", { type: "image/png" })] },
		});
		session.data.user.id = "user-2";
		view.rerender(wrap(form()));
		expect(screen.getByLabelText("菜品名称")).toHaveValue("");
		expect(screen.queryByAltText("投稿照片预览")).toBeNull();
		expect(revokeUrl).toHaveBeenCalledOnce();
	});
	it("keeps a hidden submission hidden and sends keep, remove and replace with the current revision", async () => {
		const hidden: DiningMySubmission = { ...own, status: "hidden", hiddenAt: at };
		render(wrap(form(hidden)));
		expect(screen.getByText("此投稿已隐藏，保存修改后仍不会公开。")).toBeVisible();
		submit();
		await waitFor(() => expect(saved).toHaveBeenCalledOnce());
		expect(api.updateDiningSubmission).toHaveBeenLastCalledWith(
			expect.objectContaining({
				revision: 2,
				metadata: expect.objectContaining({ photoAction: "keep" }),
				photo: null,
			}),
		);
		fireEvent.click(screen.getByRole("radio", { name: "移除照片" }));
		submit();
		await waitFor(() => expect(api.updateDiningSubmission).toHaveBeenCalledTimes(2));
		await waitFor(() => expect(screen.getByRole("button", { name: "保存修改" })).toBeEnabled());
		expect(api.updateDiningSubmission).toHaveBeenLastCalledWith(
			expect.objectContaining({
				metadata: expect.objectContaining({ photoAction: "remove" }),
				photo: null,
			}),
		);
		fireEvent.click(screen.getByRole("radio", { name: "替换照片" }));
		const photo = new File(["new"], "new.png", { type: "image/png" });
		fireEvent.change(screen.getByLabelText("替换照片", { selector: "input[type=file]" }), {
			target: { files: [photo] },
		});
		submit();
		await waitFor(() => expect(api.updateDiningSubmission).toHaveBeenCalledTimes(3));
		expect(api.updateDiningSubmission).toHaveBeenLastCalledWith(
			expect.objectContaining({
				revision: 2,
				metadata: expect.objectContaining({ photoAction: "replace" }),
				photo,
			}),
		);
	});
	it("requires a current read after a revision conflict before submitting an edit", async () => {
		api.updateDiningSubmission.mockRejectedValueOnce(
			new ApiRequestError({ message: "stale", status: 412 }),
		);
		api.getMyDiningSubmission.mockResolvedValue({
			submission: { ...own, name: "更新后的名称", revision: 5 },
		});
		render(wrap(form(own)));
		fireEvent.change(screen.getByLabelText("菜品名称"), { target: { value: "未保存内容" } });
		submit();
		expect(await screen.findByRole("alert")).toHaveTextContent("投稿已发生变化");
		expect(screen.getByRole("button", { name: "保存修改" })).toBeDisabled();
		fireEvent.click(screen.getByRole("button", { name: "重新读取当前投稿" }));
		await waitFor(() => expect(screen.getByLabelText("菜品名称")).toHaveValue("更新后的名称"));
		submit();
		await waitFor(() => expect(api.updateDiningSubmission).toHaveBeenCalledTimes(2));
		expect(api.updateDiningSubmission).toHaveBeenLastCalledWith(
			expect.objectContaining({
				revision: 5,
				metadata: expect.objectContaining({ name: "更新后的名称" }),
			}),
		);
	});
});

describe("my Dining submissions", () => {
	it("does not confuse a failed read with an empty list and offers a manual retry", async () => {
		api.getMyDiningSubmissions
			.mockRejectedValueOnce(new Error("unavailable"))
			.mockResolvedValue({ items: [], nextCursor: null });
		render(wrap(<DiningMySubmissions onOpenSubmission={vi.fn()} />));
		expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法读取我的投稿");
		expect(screen.queryByText("还没有投稿。")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "重试" }));
		expect(await screen.findByText("还没有投稿。")).toBeVisible();
	});
	it("confirms deletion, retains failures in the dialog, then reloads the restricted owner state", async () => {
		const user = userEvent.setup();
		api.deleteDiningSubmission.mockRejectedValueOnce(new Error("删除未完成"));
		render(wrap(<DiningMySubmissions onOpenSubmission={vi.fn()} />));
		await user.click(await screen.findByRole("button", { name: "删除投稿" }));
		expect(api.deleteDiningSubmission).not.toHaveBeenCalled();
		const dialog = screen.getByRole("alertdialog");
		await user.click(within(dialog).getByRole("button", { name: "确认删除" }));
		expect(await within(dialog).findByRole("alert")).toHaveTextContent("操作结果未确认");
		api.getMyDiningSubmissions.mockResolvedValue({ items: [deleted], nextCursor: null });
		await user.click(within(dialog).getByRole("button", { name: "确认删除" }));
		await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
		expect(api.deleteDiningSubmission).toHaveBeenLastCalledWith({
			submissionId: "submission-1",
			revision: 2,
		});
		expect(screen.getByText("已删除的投稿")).toBeVisible();
		expect(screen.queryByText("牛肉面")).toBeNull();
		expect(screen.queryByRole("button", { name: "删除投稿" })).toBeNull();
		expect(screen.queryByRole("button", { name: /恢复/ })).toBeNull();
	});
});

describe("Dining editor exit protection", () => {
	it("does not confirm unchanged or reverted values, but protects a photo-only change", async () => {
		render(wrap(form(own)));
		fireEvent.change(screen.getByLabelText("菜品名称"), { target: { value: "改名" } });
		fireEvent.change(screen.getByLabelText("菜品名称"), { target: { value: own.name } });
		fireEvent.click(screen.getByRole("button", { name: "取消" }));
		await waitFor(() => expect(cancel).toHaveBeenCalledOnce());
		expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("radio", { name: "移除照片" }));
		fireEvent.click(screen.getByRole("button", { name: "取消" }));
		expect(await screen.findByRole("alertdialog")).toBeVisible();
		fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
		expect(screen.getByRole("radio", { name: "移除照片" })).toBeChecked();
		expect(cancel).toHaveBeenCalledOnce();
	});
	it("keeps unsaved fields and the original revision after a background update", async () => {
		const view = render(wrap(form(own)));
		fireEvent.change(screen.getByLabelText("菜品名称"), { target: { value: "正在编辑" } });
		view.rerender(wrap(form({ ...own, name: "远端修改", revision: 99 })));
		expect(screen.getByLabelText("菜品名称")).toHaveValue("正在编辑");
		submit();
		await waitFor(() => expect(api.updateDiningSubmission).toHaveBeenCalledOnce());
		expect(api.updateDiningSubmission.mock.calls[0]?.[0]).toMatchObject({ revision: own.revision });
	});
	it("blocks exit through the container while a save is pending and allows it after success", async () => {
		let resolveSave!: (result: { submission: DiningMySubmission }) => void;
		api.createDiningSubmission.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveSave = resolve;
				}),
		);
		function Container() {
			const { requestExit } = useDiningSubmissionExit();
			return (
				<>
					{form()}
					<button type="button" onClick={() => requestExit(cancel)}>
						容器关闭
					</button>
				</>
			);
		}
		render(wrap(<Container />));
		fireEvent.change(screen.getByLabelText("菜品名称"), { target: { value: "牛肉面" } });
		submit();
		await waitFor(() => expect(screen.getByRole("button", { name: "正在保存" })).toBeDisabled());
		fireEvent.click(screen.getByRole("button", { name: "容器关闭" }));
		await act(async () => Promise.resolve());
		expect(cancel).not.toHaveBeenCalled();
		expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
		await act(async () => resolveSave({ submission: own }));
		fireEvent.click(screen.getByRole("button", { name: "容器关闭" }));
		await waitFor(() => expect(cancel).toHaveBeenCalledOnce());
	});
});
