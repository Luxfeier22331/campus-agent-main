import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
	DialogTrigger,
	Sheet,
	SheetContent,
	SheetDescription,
	SheetTitle,
	SheetTrigger,
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@campus-agent/ui";
import { MoreHorizontalIcon } from "lucide-react";
import { useState } from "react";
import type { StyleDevStory } from "../contracts";

function DialogExample() {
	const [open, setOpen] = useState(false);
	return (
		<Dialog onOpenChange={setOpen} open={open}>
			<DialogTrigger asChild>
				<Button variant="outline">打开确认窗口</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogTitle>确认保存当前筛选</DialogTitle>
				<DialogDescription>关闭后焦点返回触发按钮。</DialogDescription>
				<Button onClick={() => setOpen(false)}>完成</Button>
			</DialogContent>
		</Dialog>
	);
}

function SheetExample() {
	const [open, setOpen] = useState(false);
	return (
		<Sheet onOpenChange={setOpen} open={open}>
			<SheetTrigger asChild>
				<Button variant="outline">打开移动菜单</Button>
			</SheetTrigger>
			<SheetContent aria-label="移动菜单" side="right">
				<SheetTitle>移动菜单</SheetTitle>
				<SheetDescription>通过关闭按钮或外部区域退出。</SheetDescription>
				<nav aria-label="移动菜单项" className="mt-5 grid gap-1">
					<Button className="justify-start" variant="ghost">
						问答
					</Button>
					<Button className="justify-start" variant="ghost">
						文档
					</Button>
					<Button className="justify-start" onClick={() => setOpen(false)} variant="ghost">
						关闭菜单
					</Button>
				</nav>
			</SheetContent>
		</Sheet>
	);
}

function TooltipExample() {
	return (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button aria-label="更多操作" size="icon" variant="ghost">
						<MoreHorizontalIcon aria-hidden />
					</Button>
				</TooltipTrigger>
				<TooltipContent>更多操作</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}

export const OVERLAY_ENTRIES: readonly StyleDevStory[] = [
	{
		defaultVariant: "dialog",
		variants: [
			{ id: "dialog", label: "Dialog", render: () => <DialogExample /> },
			{ id: "sheet", label: "Sheet", render: () => <SheetExample /> },
			{ id: "tooltip", label: "Tooltip", render: () => <TooltipExample /> },
		],
		group: "浮层",
		id: "style-dev-overlays",
		title: "浮层组件",
	},
];
