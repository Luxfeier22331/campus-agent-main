import { Link } from "@tanstack/react-router";

import type { Conversation } from "../../lib/chat-types";
import { getConversationPreview } from "../../lib/chat-ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "../ui/sidebar";
import { MoreHorizontalIcon, TrashIcon } from "./chat-icons";

export function ChatHistoryItem(props: Readonly<{
  conversation: Conversation;
  collapsed?: boolean;
  isActive: boolean;
  onDelete?: (conversationId: string) => void | Promise<void>;
  onNavigate?: () => void;
}>) {
  const preview = getConversationPreview(props.conversation);

  return (
    <SidebarMenuItem className="chatbot-history-entry">
      <SidebarMenuButton
        asChild
        className="chatbot-history-item"
        isActive={props.isActive}
        tooltip={props.conversation.title}
      >
        <Link
          aria-current={props.isActive ? "page" : undefined}
          onClick={() => props.onNavigate?.()}
          params={{ conversationId: props.conversation.id }}
          to="/chat/$conversationId"
        >
          <span className="chatbot-history-item-title">{props.conversation.title}</span>
          <span className="chatbot-history-item-preview">{preview}</span>
        </Link>
      </SidebarMenuButton>

      {props.onDelete ? (
        <DropdownMenu modal={true}>
          <DropdownMenuTrigger asChild>
            <SidebarMenuAction
              aria-label={`Open actions for ${props.conversation.title}`}
              className="chatbot-history-item-action"
              showOnHover={!props.isActive}
            >
              <MoreHorizontalIcon size={15} />
            </SidebarMenuAction>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            align="end"
            className="chatbot-history-item-menu"
            side="bottom"
          >
            <DropdownMenuItem
              onSelect={() => {
                void props.onDelete?.(props.conversation.id);
              }}
              variant="destructive"
            >
              <TrashIcon size={14} />
              <span>Delete</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </SidebarMenuItem>
  );
}
