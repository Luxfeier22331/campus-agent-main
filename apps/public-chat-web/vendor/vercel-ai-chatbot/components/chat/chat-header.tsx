"use client";

import { PanelLeftIcon, PenSquareIcon } from "lucide-react";
import Link from "next/link";
import { memo } from "react";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";

function PureChatHeader() {
  const { state, toggleSidebar, isMobile } = useSidebar();

  if (state === "collapsed" && !isMobile) {
    return null;
  }

  return (
    <header className="sticky top-0 flex h-14 items-center gap-2 bg-sidebar px-3">
      <Button
        aria-label="切换侧边栏"
        className="min-h-11 min-w-11 md:hidden"
        onClick={toggleSidebar}
        size="icon-sm"
        variant="ghost"
      >
        <PanelLeftIcon className="size-4" />
      </Button>

      <Link
        aria-label="新建对话"
        className="flex min-h-11 min-w-11 items-center justify-center rounded-lg md:hidden"
        href="/"
      >
        <PenSquareIcon className="size-4" />
      </Link>

      <Button
        asChild
        className="hidden rounded-lg bg-foreground px-4 text-background hover:bg-foreground/90 md:ml-auto md:flex"
      >
        <Link
          href="/"
        >
          <PenSquareIcon className="size-4" />
          新建对话
        </Link>
      </Button>
    </header>
  );
}

export const ChatHeader = memo(PureChatHeader);
