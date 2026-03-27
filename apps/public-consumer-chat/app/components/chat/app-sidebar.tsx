import { useState } from "react";

import type { Conversation } from "../../lib/chat-types";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "../ui/sidebar";
import {
  MessageSquareIcon,
  PanelLeftIcon,
  PenSquareIcon,
  TrashIcon,
} from "./chat-icons";
import { ChatConfirmDialog } from "./chat-confirm-dialog";
import { ChatHistoryList } from "./chat-history-list";
import { SidebarUserNav } from "./sidebar-user-nav";

export function AppSidebar(props: Readonly<{
  activeConversationId?: string | null;
  conversations: Conversation[];
  historyLoading?: boolean;
  onDeleteAll?: (() => void | Promise<void>) | null;
  onDeleteConversation?: (conversationId: string) => void | Promise<void>;
  onNewChat: () => void | Promise<void>;
  onSignOut: () => void | Promise<void>;
  user: {
    email?: string | null;
    name?: string | null;
  };
}>) {
  const { state, toggleSidebar, setOpenMobile } = useSidebar();
  const [showDeleteAllDialog, setShowDeleteAllDialog] = useState(false);
  const isCollapsed = state === "collapsed";

  return (
    <>
      <Sidebar collapsible="icon">
        <SidebarHeader className="pb-0 pt-3">
          <SidebarMenu>
            <SidebarMenuItem className="chatbot-sidebar-brand-row">
              <div className="chatbot-sidebar-brand-logo">
                <SidebarMenuButton
                  className="chatbot-sidebar-logo-button"
                  onClick={() => {
                    void props.onNewChat();
                    setOpenMobile(false);
                  }}
                  tooltip="Campus Agent"
                >
                  <MessageSquareIcon />
                </SidebarMenuButton>

                <SidebarMenuButton
                  className="chatbot-sidebar-logo-overlay"
                  aria-label="Open sidebar"
                  tooltip="Open sidebar"
                  onClick={() => toggleSidebar()}
                >
                  <PanelLeftIcon direction="expand" />
                </SidebarMenuButton>
              </div>

              <div className="chatbot-sidebar-brand-trigger">
                <SidebarTrigger aria-label="Toggle Sidebar">
                  <PanelLeftIcon />
                </SidebarTrigger>
              </div>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup className="pt-1">
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    className="chatbot-sidebar-action"
                    onClick={() => {
                      void props.onNewChat();
                      setOpenMobile(false);
                    }}
                    tooltip="New Chat"
                  >
                    <PenSquareIcon size={16} />
                    <span className="chatbot-sidebar-action-copy">New chat</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>

                {props.onDeleteAll ? (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      className="chatbot-sidebar-action chatbot-sidebar-action-destructive"
                      onClick={() => setShowDeleteAllDialog(true)}
                      tooltip="Delete all chats"
                    >
                      <TrashIcon size={16} />
                      <span className="chatbot-sidebar-action-copy">Delete all</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ) : null}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <div className="chatbot-sidebar-history">
            <ChatHistoryList
              activeConversationId={props.activeConversationId}
              collapsed={isCollapsed}
              conversations={props.conversations}
              loading={props.historyLoading}
              onDeleteConversation={props.onDeleteConversation}
              onNavigate={() => setOpenMobile(false)}
            />
          </div>
        </SidebarContent>

        <SidebarFooter className="border-t border-sidebar-border pt-2 pb-3">
          <SidebarUserNav collapsed={isCollapsed} onSignOut={props.onSignOut} user={props.user} />
        </SidebarFooter>

        <SidebarRail />
      </Sidebar>

      <ChatConfirmDialog
        actionLabel="Delete all"
        description="This action cannot be undone. This will permanently delete all your chats."
        onCancel={() => setShowDeleteAllDialog(false)}
        onConfirm={() => {
          setShowDeleteAllDialog(false);
          void props.onDeleteAll?.();
        }}
        open={showDeleteAllDialog && Boolean(props.onDeleteAll)}
        title="Delete all chats?"
      >
        <p className="chatbot-dialog-note">This action removes every saved conversation for this user.</p>
      </ChatConfirmDialog>
    </>
  );
}
