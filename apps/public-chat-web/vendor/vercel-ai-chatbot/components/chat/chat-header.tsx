"use client";

import { PanelLeftIcon, PenSquareIcon } from "lucide-react";
import { memo } from "react";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import type { VisibilityType } from "./visibility-selector";

function PureChatHeader(props: {
  chatId: string;
  conversationTitle: string | null;
  isReadonly: boolean;
  onNewChat: () => void;
  selectedVisibilityType: VisibilityType;
}) {
  const { state, toggleSidebar, isMobile } = useSidebar();

  if (state === "collapsed" && !isMobile) {
    return null;
  }

  return (
    <header className="sticky top-0 flex h-14 items-center gap-2 bg-sidebar px-3">
      <Button
        aria-label="Toggle sidebar"
        className="md:hidden"
        onClick={toggleSidebar}
        size="icon-sm"
        variant="ghost"
      >
        <PanelLeftIcon className="size-4" />
      </Button>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-foreground">
          {props.conversationTitle ?? "Campus chat"}
        </p>
      </div>

      {!props.isReadonly ? (
        <Button
          className="hidden rounded-lg bg-foreground px-4 text-background hover:bg-foreground/90 md:ml-auto md:flex"
          onClick={props.onNewChat}
        >
          <PenSquareIcon className="size-4" />
          新对话
        </Button>
      ) : null}
    </header>
  );
}

export const ChatHeader = memo(PureChatHeader, (previous, next) => {
  return (
    previous.chatId === next.chatId &&
    previous.conversationTitle === next.conversationTitle &&
    previous.selectedVisibilityType === next.selectedVisibilityType &&
    previous.isReadonly === next.isReadonly
  );
});
