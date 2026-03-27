import * as React from "react";

import { Slot } from "@radix-ui/react-slot";

import { cn } from "../../lib/cn";

const SIDEBAR_WIDTH = "16rem";
const SIDEBAR_WIDTH_ICON = "3rem";
const SIDEBAR_COOKIE_NAME = "sidebar_state";
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;
const SIDEBAR_KEYBOARD_SHORTCUT = "b";

type SidebarContextProps = {
  state: "expanded" | "collapsed";
  open: boolean;
  setOpen: (open: boolean | ((open: boolean) => boolean)) => void;
  openMobile: boolean;
  setOpenMobile: (open: boolean | ((open: boolean) => boolean)) => void;
  isMobile: boolean;
  toggleSidebar: () => void;
};

const SidebarContext = React.createContext<SidebarContextProps | null>(null);

function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia("(max-width: 960px)");
    const update = () => setIsMobile(mediaQuery.matches);

    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, []);

  return isMobile;
}

export function useSidebar() {
  const context = React.useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.");
  }

  return context;
}

export function SidebarProvider(props: React.PropsWithChildren<{ defaultOpen?: boolean }>) {
  const isMobile = useIsMobile();
  const [openMobile, setOpenMobile] = React.useState(false);
  const [open, setOpenState] = React.useState(props.defaultOpen ?? true);

  const setOpen = React.useCallback((value: boolean | ((value: boolean) => boolean)) => {
    setOpenState((current) => {
      const next = typeof value === "function" ? value(current) : value;
      document.cookie = `${SIDEBAR_COOKIE_NAME}=${next}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`;
      return next;
    });
  }, []);

  const toggleSidebar = React.useCallback(() => {
    if (isMobile) {
      setOpenMobile((current) => !current);
      return;
    }

    setOpen((current) => !current);
  }, [isMobile, setOpen]);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === SIDEBAR_KEYBOARD_SHORTCUT && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        toggleSidebar();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleSidebar]);

  const contextValue = React.useMemo<SidebarContextProps>(
    () => ({
      state: open ? "expanded" : "collapsed",
      open,
      setOpen,
      openMobile,
      setOpenMobile,
      isMobile,
      toggleSidebar,
    }),
    [isMobile, open, openMobile, setOpen, toggleSidebar],
  );

  return (
    <SidebarContext.Provider value={contextValue}>
      <div
        className="chatbot-sidebar-provider"
        data-slot="sidebar-wrapper"
        style={
          {
            "--sidebar-width": SIDEBAR_WIDTH,
            "--sidebar-width-icon": SIDEBAR_WIDTH_ICON,
          } as React.CSSProperties
        }
      >
        {props.children}
      </div>
    </SidebarContext.Provider>
  );
}

export function Sidebar(props: React.PropsWithChildren<{ className?: string; collapsible?: "icon" | "none" }>) {
  const { isMobile, state, openMobile } = useSidebar();

  if (props.collapsible === "none") {
    return <div className={cn("chatbot-sidebar-static", props.className)}>{props.children}</div>;
  }

  if (isMobile) {
    return (
      <div
        className={cn("chatbot-mobile-sidebar-shell", openMobile ? "is-open" : "", props.className)}
        data-mobile="true"
        data-slot="sidebar"
      >
        {props.children}
      </div>
    );
  }

  return (
    <div
      className={cn("chatbot-sidebar-root", state === "collapsed" ? "is-collapsed" : "", props.className)}
      data-slot="sidebar"
      data-state={state}
      data-collapsible={state === "collapsed" ? "icon" : ""}
    >
      <div className="chatbot-sidebar-gap" />
      <div className="chatbot-sidebar-container">{props.children}</div>
    </div>
  );
}

export function SidebarInset(props: React.PropsWithChildren<{ className?: string }>) {
  return <main className={cn("chatbot-sidebar-inset", props.className)}>{props.children}</main>;
}

export function SidebarHeader(props: React.PropsWithChildren<{ className?: string }>) {
  return <div className={cn("chatbot-sidebar-header-slot", props.className)}>{props.children}</div>;
}

export function SidebarContent(props: React.PropsWithChildren<{ className?: string }>) {
  return <div className={cn("chatbot-sidebar-content-slot", props.className)}>{props.children}</div>;
}

export function SidebarFooter(props: React.PropsWithChildren<{ className?: string }>) {
  return <div className={cn("chatbot-sidebar-footer-slot", props.className)}>{props.children}</div>;
}

export function SidebarGroup(props: React.PropsWithChildren<{ className?: string }>) {
  return <section className={cn("chatbot-sidebar-group", props.className)}>{props.children}</section>;
}

export function SidebarGroupContent(props: React.PropsWithChildren<{ className?: string }>) {
  return <div className={cn("chatbot-sidebar-group-content", props.className)}>{props.children}</div>;
}

export function SidebarGroupLabel(props: React.PropsWithChildren<{ className?: string }>) {
  return <p className={cn("chatbot-sidebar-group-label", props.className)}>{props.children}</p>;
}

export function SidebarMenu(props: React.PropsWithChildren<{ className?: string }>) {
  return <div className={cn("chatbot-sidebar-menu", props.className)}>{props.children}</div>;
}

export function SidebarMenuItem(props: React.PropsWithChildren<{ className?: string }>) {
  return <div className={cn("chatbot-sidebar-menu-item", props.className)}>{props.children}</div>;
}

export function SidebarMenuButton(
  props: React.PropsWithChildren<{
    asChild?: boolean;
    className?: string;
    onClick?: React.MouseEventHandler<HTMLElement>;
    isActive?: boolean;
    tooltip?: string;
  }> &
    Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children" | "onClick">,
) {
  const {
    asChild,
    children,
    className,
    isActive,
    onClick,
    tooltip,
    ...buttonProps
  } = props;
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      {...buttonProps}
      className={cn("chatbot-sidebar-menu-button", className)}
      data-active={isActive}
      onClick={onClick as React.MouseEventHandler<HTMLButtonElement> | undefined}
      title={tooltip}
      {...(asChild ? {} : { type: buttonProps.type ?? "button" })}
    >
      {children}
    </Comp>
  );
}

export function SidebarMenuAction(
  props: React.PropsWithChildren<{
    asChild?: boolean;
    className?: string;
    showOnHover?: boolean;
  }> &
    Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children">,
) {
  const { asChild, children, className, showOnHover = false, ...buttonProps } =
    props;
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      {...buttonProps}
      className={cn(
        "chatbot-sidebar-menu-action",
        showOnHover && "show-on-hover",
        className,
      )}
      {...(asChild ? {} : { type: buttonProps.type ?? "button" })}
    >
      {children}
    </Comp>
  );
}

export function SidebarTrigger(props: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type">) {
  const { toggleSidebar } = useSidebar();

  return (
    <button
      {...props}
      className={cn("chatbot-sidebar-trigger-button", props.className)}
      onClick={(event) => {
        props.onClick?.(event);
        toggleSidebar();
      }}
      type="button"
    />
  );
}

export function SidebarRail(props: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type">) {
  const { toggleSidebar, state, isMobile } = useSidebar();

  if (isMobile) {
    return null;
  }

  return (
    <div className="chatbot-sidebar-rail-wrap" data-state={state}>
      <button
        {...props}
        aria-label={props["aria-label"] ?? "Toggle Sidebar"}
        className={cn("chatbot-sidebar-rail-hit", props.className)}
        onClick={(event) => {
          props.onClick?.(event);
          toggleSidebar();
        }}
        tabIndex={-1}
        type="button"
      />
      <button
        aria-label={props["aria-label"] ?? "Toggle Sidebar"}
        className={cn("chatbot-sidebar-rail-knob", state === "collapsed" ? "is-collapsed" : "")}
        onClick={toggleSidebar}
        tabIndex={-1}
        type="button"
      />
      <div className={cn("chatbot-sidebar-rail-border", state === "collapsed" ? "is-collapsed" : "")} />
    </div>
  );
}
