import { useChangeEmail, useUpdateUser } from "@better-auth-ui/react";
import { Button, Field, FieldGroup, Input } from "@campus-agent/ui";
import type { FormEvent } from "react";
import { campusAuthClient } from "@/platform/auth/client";
import { useCampusSession } from "@/platform/auth/session";
import { SettingsFeedback, SettingsSection } from "./settings-section";

export function AccountProfile() {
	const session = useCampusSession();
	const update = useUpdateUser(campusAuthClient, {
		onSuccess: async () => {
			await session.refresh();
		},
	});
	const user = session.data?.user;
	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!user || update.isPending) {
			return;
		}
		update.mutate({ name: String(new FormData(event.currentTarget).get("name") ?? "").trim() });
	}
	return (
		<SettingsSection title="账号资料">
			<form aria-label="账号资料" className="grid gap-4" onSubmit={submit}>
				<FieldGroup>
					<Field label="姓名">
						<Input
							key={`${user?.id}:${user?.name}`}
							name="name"
							autoComplete="name"
							defaultValue={user?.name ?? ""}
							disabled={!user || update.isPending}
							onChange={() => update.reset()}
						/>
					</Field>
				</FieldGroup>
				<SettingsFeedback
					error={update.error}
					success={update.isSuccess ? "账号资料已保存" : undefined}
				/>
				<Button
					className="justify-self-start"
					type="submit"
					disabled={!user || update.isPending}
					aria-busy={update.isPending}
				>
					{update.isPending ? "正在保存" : "保存"}
				</Button>
			</form>
		</SettingsSection>
	);
}

export function AccountEmail() {
	const session = useCampusSession();
	const change = useChangeEmail(campusAuthClient, {
		onSuccess: async () => {
			await session.refresh();
		},
	});
	const user = session.data?.user;
	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!user || change.isPending) {
			return;
		}
		change.mutate({
			newEmail: String(new FormData(event.currentTarget).get("email") ?? "").trim(),
			callbackURL: new URL("/account/settings/account", window.location.origin).href,
		});
	}
	return (
		<SettingsSection title="修改邮箱">
			<form aria-label="修改邮箱" className="grid gap-4" onSubmit={submit}>
				<Field label="邮箱" description="修改需要通过邮件确认，确认前仍使用当前邮箱。">
					<Input
						key={`${user?.id}:${user?.email}`}
						name="email"
						type="email"
						autoComplete="email"
						required
						defaultValue={user?.email ?? ""}
						disabled={!user || change.isPending}
						onChange={() => change.reset()}
					/>
				</Field>
				<SettingsFeedback
					error={change.error}
					success={change.isSuccess ? "请查看邮箱确认修改" : undefined}
				/>
				<Button
					className="justify-self-start"
					type="submit"
					disabled={!user || change.isPending}
					aria-busy={change.isPending}
				>
					{change.isPending ? "正在提交" : "更新邮箱"}
				</Button>
			</form>
		</SettingsSection>
	);
}
