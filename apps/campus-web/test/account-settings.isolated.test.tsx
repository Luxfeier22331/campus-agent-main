import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({
	getSession: vi.fn(),
	updateUser: vi.fn(),
	changeEmail: vi.fn(),
	changePassword: vi.fn(),
	listAccounts: vi.fn(),
	listSessions: vi.fn(),
	revokeSession: vi.fn(),
	revokeOtherSessions: vi.fn(),
	revokeSessions: vi.fn(),
	signOut: vi.fn(),
	signIn: { email: vi.fn() },
	requestPasswordReset: vi.fn(),
}));
const navigate = vi.hoisted(() => vi.fn());
const rootSession = vi.hoisted(() => ({
	data: {
		user: {
			id: "user-1",
			email: "student@example.edu",
			name: "校园用户",
			passwordChangeRequired: false,
		},
		session: { id: "current", token: "current-session" },
	},
	status: "authenticated",
	refresh: vi.fn(),
}));
const memoryApi = vi.hoisted(() => ({ getProfileMemory: vi.fn(), listProfileMemories: vi.fn() }));

vi.mock("@/platform/auth/client", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/platform/auth/client")>()),
	campusAuthClient: client,
}));
vi.mock("@/platform/auth/session", () => ({ useCampusSession: () => rootSession }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-router")>()),
	useNavigate: () => navigate,
}));
vi.mock("@/features/profile-memory/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/features/profile-memory/api")>()),
	getProfileMemory: memoryApi.getProfileMemory,
	listProfileMemories: memoryApi.listProfileMemories,
}));

import { Settings } from "../src/components/auth/settings/settings";

const device = (id: string) => ({
	id,
	token: `${id}-session`,
	userId: "user-1",
	createdAt: new Date("2026-09-01T00:00:00Z"),
	updatedAt: new Date("2026-09-01T00:00:00Z"),
	expiresAt: new Date("2026-10-01T00:00:00Z"),
	ipAddress: "127.0.0.1",
	userAgent:
		"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
});

beforeEach(() => {
	vi.clearAllMocks();
	for (const value of Object.values(client)) {
		if (typeof value === "function") {
			value.mockReset();
		}
	}
	client.signIn.email.mockReset();
	rootSession.data.user.name = "校园用户";
	rootSession.data.user.email = "student@example.edu";
	rootSession.refresh.mockResolvedValue(undefined);
	client.getSession.mockImplementation(async () => structuredClone(rootSession.data));
	client.listAccounts.mockResolvedValue([{ id: "account-1", providerId: "credential" }]);
	client.listSessions.mockResolvedValue([device("other"), device("current")]);
	client.updateUser.mockResolvedValue({ status: true });
	client.changeEmail.mockResolvedValue({ status: true });
	client.changePassword.mockResolvedValue({ token: "current-session" });
	client.revokeSession.mockResolvedValue({ status: true });
	client.revokeOtherSessions.mockResolvedValue({ status: true });
	client.revokeSessions.mockResolvedValue({ status: true });
	client.signOut.mockResolvedValue({ status: true });
	client.signIn.email.mockResolvedValue(rootSession.data);
	client.requestPasswordReset.mockResolvedValue({ status: true });
	memoryApi.getProfileMemory.mockResolvedValue({
		operations: [],
		lifecycleState: "active",
		syncStatus: "synced",
	});
	memoryApi.listProfileMemories.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 });
});

describe("account settings with shared UI and headless auth hooks", () => {
	it("keeps account, security and memory routes and the deletion entry", async () => {
		const user = userEvent.setup();
		const view = render(<Settings view="account" />);
		expect(screen.getByLabelText("姓名")).toHaveValue("校园用户");
		expect(screen.getByLabelText("邮箱")).toHaveValue("student@example.edu");
		expect(screen.getByRole("button", { name: "注销账号" })).toBeVisible();
		expect(document.querySelector('input[type="file"]')).toBeNull();
		await user.click(screen.getByRole("tab", { name: "安全" }));
		expect(navigate).toHaveBeenCalledWith({ to: "/account/settings/security" });
		view.rerender(<Settings view="memory" />);
		expect(await screen.findByText("没有匹配的记忆")).toBeVisible();
		expect(screen.queryByRole("button", { name: "注销账号" })).toBeNull();
	});

	it("keeps profile saving pending until the request and root session refresh finish", async () => {
		let finish: () => void = () => undefined;
		client.updateUser.mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = () => resolve({ status: true });
				}),
		);
		render(<Settings view="account" />);
		fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "新姓名" } });
		fireEvent.submit(screen.getByRole("form", { name: "账号资料" }));
		await waitFor(() =>
			expect(client.updateUser).toHaveBeenCalledWith(
				expect.objectContaining({ name: "新姓名", fetchOptions: { throw: true } }),
			),
		);
		expect(screen.getByRole("button", { name: "正在保存" })).toBeDisabled();
		expect(screen.queryByText("账号资料已保存")).toBeNull();
		await act(async () => finish());
		expect(await screen.findByText("账号资料已保存")).toBeVisible();
		expect(rootSession.refresh).toHaveBeenCalledOnce();
	});

	it("reports rejected profile changes and leaves the typed name available to retry", async () => {
		client.updateUser.mockRejectedValue(new Error("服务暂不可用"));
		render(<Settings view="account" />);
		fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "待保存姓名" } });
		fireEvent.submit(screen.getByRole("form", { name: "账号资料" }));
		expect(await screen.findByRole("alert")).toBeVisible();
		expect(screen.getByLabelText("姓名")).toHaveValue("待保存姓名");
		expect(screen.queryByText("账号资料已保存")).toBeNull();
		expect(rootSession.refresh).not.toHaveBeenCalled();
	});

	it("requests email confirmation without claiming the new address is already active", async () => {
		render(<Settings view="account" />);
		fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "new@example.edu" } });
		fireEvent.submit(screen.getByRole("form", { name: "修改邮箱" }));
		expect(await screen.findByText("请查看邮箱确认修改")).toBeVisible();
		expect(client.changeEmail).toHaveBeenCalledWith(
			expect.objectContaining({
				newEmail: "new@example.edu",
				callbackURL: new URL("/account/settings/account", window.location.origin).href,
			}),
		);
		expect(rootSession.data.user.email).toBe("student@example.edu");
	});

	it("validates password confirmation and revokes other sessions only on a valid submission", async () => {
		render(<Settings view="security" />);
		await screen.findByLabelText("当前密码");
		fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "oldpassword123" } });
		fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "newpassword123" } });
		fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "different123" } });
		fireEvent.submit(screen.getByRole("form", { name: "修改密码" }));
		expect(await screen.findByText("两次输入的新密码不一致。")).toBeVisible();
		expect(client.changePassword).not.toHaveBeenCalled();
		fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "newpassword123" } });
		fireEvent.submit(screen.getByRole("form", { name: "修改密码" }));
		expect(await screen.findByText("密码已更新，其他设备已退出登录。")).toBeVisible();
		expect(client.changePassword).toHaveBeenCalledWith(
			expect.objectContaining({
				currentPassword: "oldpassword123",
				newPassword: "newpassword123",
				revokeOtherSessions: true,
			}),
		);
		expect(screen.getByLabelText("新密码")).toHaveValue("");
		expect(rootSession.refresh).toHaveBeenCalledOnce();
		expect(client.listSessions.mock.calls.length).toBeGreaterThanOrEqual(2);
	});

	it("provides the existing reset-link flow for accounts without a password", async () => {
		client.listAccounts.mockResolvedValue([]);
		render(<Settings view="security" />);
		fireEvent.click(await screen.findByRole("button", { name: "发送重置链接" }));
		expect(await screen.findByText("重置链接已发送，请查看邮箱。")).toBeVisible();
		expect(client.requestPasswordReset).toHaveBeenCalledWith(
			expect.objectContaining({
				email: "student@example.edu",
				redirectTo: expect.stringContaining("/account/reset-password"),
			}),
		);
	});

	it("does not misclassify a failed account lookup as an account without a password", async () => {
		client.listAccounts.mockRejectedValue({ status: 403, error: { message: "暂时无法读取账号" } });
		render(<Settings view="security" />);
		const section = screen.getByRole("region", { name: "修改密码" });
		expect(await within(section).findByRole("alert")).toBeVisible();
		expect(within(section).queryByRole("button", { name: "发送重置链接" })).toBeNull();
		expect(within(section).getByRole("button", { name: "重试" })).toBeEnabled();
	});

	it("removes a device and refreshes the existing session query", async () => {
		const user = userEvent.setup();
		client.revokeSession.mockImplementation(async () => {
			client.listSessions.mockResolvedValue([device("current")]);
			return { status: true };
		});
		render(<Settings view="security" />);
		await user.click(await screen.findByRole("button", { name: /移除登录设备/ }));
		expect(await screen.findByText("登录设备已移除")).toBeVisible();
		expect(client.revokeSession).toHaveBeenCalledWith(
			expect.objectContaining({ token: "other-session" }),
		);
		expect(screen.queryByRole("button", { name: /移除登录设备/ })).toBeNull();
	});

	it("requires confirmation for bulk device removal and keeps failures in the dialog", async () => {
		const user = userEvent.setup();
		client.revokeOtherSessions.mockRejectedValueOnce(new Error("服务暂不可用"));
		render(<Settings view="security" />);
		await user.click(await screen.findByRole("button", { name: "退出其他设备" }));
		expect(client.revokeOtherSessions).not.toHaveBeenCalled();
		const dialog = screen.getByRole("alertdialog");
		await user.click(within(dialog).getByRole("button", { name: "确认退出" }));
		expect(await within(dialog).findByRole("alert")).toBeVisible();
		expect(dialog).toBeVisible();
		client.revokeOtherSessions.mockResolvedValue({ status: true });
		await user.click(within(dialog).getByRole("button", { name: "确认退出" }));
		await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
		expect(await screen.findByText("其他设备已退出登录")).toBeVisible();
	});

	it("refreshes the root session after signing out all devices", async () => {
		const user = userEvent.setup();
		render(<Settings view="security" />);
		await user.click(await screen.findByRole("button", { name: "退出所有设备" }));
		expect(client.revokeSessions).not.toHaveBeenCalled();
		await user.click(screen.getByRole("button", { name: "确认退出" }));
		await waitFor(() => expect(rootSession.refresh).toHaveBeenCalledOnce());
		expect(navigate).toHaveBeenCalledWith({
			to: "/account/login",
			search: { redirectTo: undefined },
			replace: true,
		});
	});

	it("supports fresh-session verification before showing the device list", async () => {
		client.listSessions.mockRejectedValueOnce({
			status: 403,
			error: { code: "SESSION_NOT_FRESH" },
		});
		render(<Settings view="security" />);
		const password = await screen.findByLabelText("密码", { exact: true });
		fireEvent.change(password, { target: { value: "currentpassword123" } });
		fireEvent.click(screen.getByRole("button", { name: "验证登录" }));
		await waitFor(() =>
			expect(client.signIn.email).toHaveBeenCalledWith(
				expect.objectContaining({ email: "student@example.edu", password: "currentpassword123" }),
			),
		);
		expect(await screen.findByText("当前设备")).toBeVisible();
		expect(rootSession.refresh).toHaveBeenCalledOnce();
	});
});
