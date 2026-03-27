import { motion } from "motion/react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { ChevronIcon } from "./chat-icons";

function getUserLabel(input: { name?: string | null; email?: string | null }): string {
  return input.name?.trim() || input.email?.trim() || "Campus user";
}

function emailToHue(email: string): number {
  let hash = 0;
  for (const char of email) {
    hash = char.charCodeAt(0) + ((hash << 5) - hash);
  }

  return Math.abs(hash) % 360;
}

export function SidebarUserNav(props: Readonly<{
  collapsed?: boolean;
  user: {
    email?: string | null;
    name?: string | null;
  };
  onSignOut: () => void | Promise<void>;
}>) {
  const label = getUserLabel(props.user);
  const email = props.user.email?.trim() || label;
  const isLoading = !props.user.email && !props.user.name;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            {isLoading ? (
              <SidebarMenuButton className="chatbot-user-trigger is-loading">
                <span aria-hidden="true" className="chatbot-user-avatar chatbot-user-avatar-skeleton" />
                {props.collapsed ? null : (
                  <>
                    <span className="chatbot-user-copy">
                      <span className="chatbot-user-name chatbot-user-text-skeleton">Loading</span>
                      <span className="chatbot-user-email chatbot-user-text-skeleton">Loading</span>
                    </span>
                    <motion.span
                      animate={{ rotate: 360 }}
                      className="chatbot-user-chevron"
                      transition={{ duration: 1.2, ease: "linear", repeat: Infinity }}
                    >
                      <ChevronIcon direction="up" />
                    </motion.span>
                  </>
                )}
              </SidebarMenuButton>
            ) : (
              <SidebarMenuButton
                aria-label={props.collapsed ? `${label} account menu` : undefined}
                className={props.collapsed ? "chatbot-user-trigger is-collapsed" : "chatbot-user-trigger"}
                data-testid="user-nav-button"
              >
                <span
                  aria-hidden="true"
                  className="chatbot-user-avatar"
                  style={{
                    background: `linear-gradient(135deg, oklch(0.35 0.08 ${emailToHue(email)}), oklch(0.25 0.05 ${emailToHue(email) + 40}))`,
                  }}
                />
                {props.collapsed ? null : (
                  <>
                    <span className="chatbot-user-copy">
                      <span className="chatbot-user-name">{label}</span>
                      <span className="chatbot-user-email" data-testid="user-email">
                        {email}
                      </span>
                    </span>
                    <span className="chatbot-user-chevron">
                      <ChevronIcon direction="up" />
                    </span>
                  </>
                )}
              </SidebarMenuButton>
            )}
          </DropdownMenuTrigger>

          <DropdownMenuContent
            align="end"
            className="chatbot-user-menu"
            data-testid="user-nav-menu"
            side="top"
          >
            <DropdownMenuItem disabled={true}>
              <span className="chatbot-user-menu-meta">
                <span className="chatbot-user-menu-name">{label}</span>
                <span className="chatbot-user-menu-email">{email}</span>
              </span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                void props.onSignOut();
              }}
            >
              <span>Sign out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
