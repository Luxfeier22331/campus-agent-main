import { describe, expect, it } from "vitest";

import indexHtmlSource from "../index.html?raw";
import mainSource from "../src/main.tsx?raw";
import appSidebarSource from "../vendor/vercel-ai-chatbot/components/chat/app-sidebar.tsx?raw";
import chatHeaderSource from "../vendor/vercel-ai-chatbot/components/chat/chat-header.tsx?raw";
import multimodalInputSource from "../vendor/vercel-ai-chatbot/components/chat/multimodal-input.tsx?raw";
import shellSource from "../vendor/vercel-ai-chatbot/components/chat/shell.tsx?raw";
import sidebarHistorySource from "../vendor/vercel-ai-chatbot/components/chat/sidebar-history.tsx?raw";
import sidebarHistoryItemSource from "../vendor/vercel-ai-chatbot/components/chat/sidebar-history-item.tsx?raw";
import sidebarToggleSource from "../vendor/vercel-ai-chatbot/components/chat/sidebar-toggle.tsx?raw";
import sidebarUserNavSource from "../vendor/vercel-ai-chatbot/components/chat/sidebar-user-nav.tsx?raw";
import slashCommandsSource from "../vendor/vercel-ai-chatbot/components/chat/slash-commands.tsx?raw";
import submitButtonSource from "../vendor/vercel-ai-chatbot/components/chat/submit-button.tsx?raw";
import sidebarUiSource from "../vendor/vercel-ai-chatbot/components/ui/sidebar.tsx?raw";
import spinnerSource from "../vendor/vercel-ai-chatbot/components/ui/spinner.tsx?raw";

describe("public chat copy localization", () => {
	it("uses Chinese copy across the active public chat shell", () => {
		expect(indexHtmlSource).toContain('<html lang="zh-CN">');
		expect(indexHtmlSource).toContain("<title>校园助理</title>");
		expect(indexHtmlSource).not.toContain("<title>Campus Agent Chat</title>");

		expect(mainSource).toContain("正在载入校园助理");
		expect(mainSource).not.toContain("Loading campus chat");

		expect(chatHeaderSource).toContain("切换侧边栏");
		expect(chatHeaderSource).toContain("新建对话");
		expect(chatHeaderSource).not.toContain("Deploy with Vercel");
		expect(chatHeaderSource).not.toContain("VercelIcon");

		expect(appSidebarSource).toContain("校园助理");
		expect(appSidebarSource).toContain("展开侧边栏");
		expect(appSidebarSource).toContain("新建对话");
		expect(appSidebarSource).toContain("清空历史");
		expect(appSidebarSource).toContain("清空全部对话？");
		expect(appSidebarSource).not.toContain("Delete all chats?");

		expect(sidebarHistorySource).toContain("历史对话");
		expect(sidebarHistorySource).toContain("今天");
		expect(sidebarHistorySource).toContain("昨天");
		expect(sidebarHistorySource).toContain("近 7 天");
		expect(sidebarHistorySource).toContain("近 30 天");
		expect(sidebarHistorySource).toContain("更早");
		expect(sidebarHistorySource).toContain("登录后可保存并继续查看历史对话");
		expect(sidebarHistorySource).toContain("开始提问后，历史对话会显示在这里");
		expect(sidebarHistorySource).toContain("删除这条对话？");
		expect(sidebarHistorySource).not.toContain("Are you absolutely sure?");

		expect(sidebarHistoryItemSource).toContain("更多操作");
		expect(sidebarHistoryItemSource).toContain("<span>删除</span>");
		expect(sidebarHistoryItemSource).not.toContain("<span>Delete</span>");

		expect(sidebarUserNavSource).toContain("加载中...");
		expect(sidebarUserNavSource).toContain("访客");
		expect(sidebarUserNavSource).toContain("登录账号");
		expect(sidebarUserNavSource).toContain("退出登录");
		expect(sidebarUserNavSource).not.toContain("Login to your account");

		expect(sidebarToggleSource).toContain("切换侧边栏");
		expect(sidebarUiSource).toContain("切换侧边栏");
		expect(spinnerSource).toContain('aria-label="加载中"');
		expect(submitButtonSource).toContain("正在提交");
		expect(submitButtonSource).toContain("提交");
		expect(submitButtonSource).not.toContain("Submit form");

		expect(multimodalInputSource).toContain("删除这条对话？");
		expect(multimodalInputSource).toContain("清空全部对话？");
		expect(multimodalInputSource).toContain("请等待当前回答完成后再继续");
		expect(multimodalInputSource).toContain("正在编辑消息");
		expect(multimodalInputSource).toContain("请输入你想了解的校园信息");
		expect(multimodalInputSource).not.toContain("Ask about curriculum plans");
		expect(multimodalInputSource).not.toContain("Search models...");

		expect(slashCommandsSource).toContain("开始新对话");
		expect(slashCommandsSource).toContain("删除当前对话");
		expect(slashCommandsSource).toContain("清空全部对话");
		expect(slashCommandsSource).toContain("快捷指令");

		expect(shellSource).toContain("模型服务暂不可用");
		expect(shellSource).toContain("当前环境尚未启用回答模型");
		expect(shellSource).not.toContain("Activate AI Gateway");
	});
});
