import { describe, expect, it } from "vitest";
import { isOnLoginPage } from "../src/extract";

describe("isOnLoginPage", () => {
	it("识别 zfca 登录页", () => {
		expect(
			isOnLoginPage(
				"https://ca.muc.edu.cn/zfca/login?service=http%3A%2F%2Fmy.muc.edu.cn%2Fuser%2FsimpleSSOLogin",
			),
		).toBe(true);
	});

	it("识别 cas 登录页", () => {
		expect(isOnLoginPage("https://sso.muc.edu.cn/cas/login")).toBe(true);
	});

	it("识别 authserver 登录页", () => {
		expect(isOnLoginPage("https://ids.muc.edu.cn/authserver/login")).toBe(true);
	});

	it("不误判门户首页", () => {
		expect(isOnLoginPage("https://my.muc.edu.cn/page/11")).toBe(false);
	});

	it("不将门户 SSO 回调误判为登录页", () => {
		expect(isOnLoginPage("https://my.muc.edu.cn/user/simpleSSOLogin")).toBe(false);
	});
});
