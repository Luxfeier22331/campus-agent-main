import type { Conversation } from "../../lib/chat-types";
import { groupConversationsByRecency } from "../../lib/chat-ui";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
} from "../ui/sidebar";
import { ChatHistoryItem } from "./chat-history-item";

export function ChatHistoryList(props: Readonly<{
  activeConversationId?: string | null;
  collapsed?: boolean;
  conversations: Conversation[];
  loading?: boolean;
  onDeleteConversation?: (conversationId: string) => void | Promise<void>;
  onNavigate?: () => void;
}>) {
  if (props.collapsed) {
    return null;
  }

  if (props.loading) {
    return (
      <SidebarGroup className="chatbot-history-group-shell">
        <SidebarGroupLabel className="chatbot-history-group-heading">History</SidebarGroupLabel>
        <SidebarGroupContent>
          <div
            aria-label="Loading conversation history"
            className="chatbot-history-skeleton"
          >
            <span className="chatbot-history-skeleton-line" />
            <span className="chatbot-history-skeleton-line" />
            <span className="chatbot-history-skeleton-line" />
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  if (props.conversations.length === 0) {
    return (
      <SidebarGroup className="chatbot-history-group-shell">
        <SidebarGroupLabel className="chatbot-history-group-heading">History</SidebarGroupLabel>
        <SidebarGroupContent>
          <div className="chatbot-history-empty">
            <p>Your conversations will appear here once you start chatting.</p>
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  return (
    <SidebarGroup className="chatbot-history-group-shell">
      <SidebarGroupLabel className="chatbot-history-group-heading">History</SidebarGroupLabel>
      <SidebarGroupContent>
        <div className="chatbot-history-sections">
          {groupConversationsByRecency(props.conversations).map((group) => (
            <section className="chatbot-history-group" key={group.label}>
              <p className="chatbot-history-group-label">{group.label}</p>
              <SidebarMenu className="chatbot-history-group-items">
                {group.conversations.map((conversation) => {
                  return (
                    <ChatHistoryItem
                      conversation={conversation}
                      isActive={conversation.id === props.activeConversationId}
                      key={conversation.id}
                      onDelete={props.onDeleteConversation}
                      onNavigate={props.onNavigate}
                    />
                  );
                })}
              </SidebarMenu>
            </section>
          ))}
        </div>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
