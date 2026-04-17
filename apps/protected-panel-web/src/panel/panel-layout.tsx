import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import DashboardOutlinedIcon from "@mui/icons-material/DashboardOutlined";
import FindInPageOutlinedIcon from "@mui/icons-material/FindInPageOutlined";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import LanguageOutlinedIcon from "@mui/icons-material/LanguageOutlined";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import LogoutOutlinedIcon from "@mui/icons-material/LogoutOutlined";
import MenuOutlinedIcon from "@mui/icons-material/MenuOutlined";
import PendingActionsOutlinedIcon from "@mui/icons-material/PendingActionsOutlined";
import RefreshOutlinedIcon from "@mui/icons-material/RefreshOutlined";
import RuleFolderOutlinedIcon from "@mui/icons-material/RuleFolderOutlined";
import TravelExploreOutlinedIcon from "@mui/icons-material/TravelExploreOutlined";
import {
  AppBar as MuiAppBar,
  Box,
  IconButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Toolbar,
  Tooltip,
  useMediaQuery,
  type Theme,
} from "@mui/material";
import type { ReactNode } from "react";
import {
  Layout,
  Menu,
  TitlePortal,
  UserMenu,
  useLogout,
  useRefresh,
  useSidebarState,
  useTheme,
  useUserMenu,
} from "react-admin";

import { PANEL_COPY } from "./panel-copy";

function ProtectedPanelThemeToggleButton() {
  const [theme, setTheme] = useTheme("light");
  const isDark = theme === "dark";

  return (
    <IconButton
      aria-label={isDark ? PANEL_COPY.appBar.switchToLightMode : PANEL_COPY.appBar.switchToDarkMode}
      color="inherit"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      size="large"
      title={isDark ? PANEL_COPY.appBar.switchToLightMode : PANEL_COPY.appBar.switchToDarkMode}
    >
      {isDark ? <LightModeOutlinedIcon /> : <DarkModeOutlinedIcon />}
    </IconButton>
  );
}

function ProtectedPanelSidebarToggleButton() {
  const [open, setOpen] = useSidebarState();
  const label = open ? PANEL_COPY.appBar.closeMenu : PANEL_COPY.appBar.openMenu;

  return (
    <Tooltip enterDelay={300} title={label}>
      <IconButton
        aria-label={label}
        color="inherit"
        onClick={() => setOpen(!open)}
        size="large"
        title={label}
      >
        <MenuOutlinedIcon />
      </IconButton>
    </Tooltip>
  );
}

function ProtectedPanelRefreshButton() {
  const refresh = useRefresh();

  return (
    <Tooltip enterDelay={300} title={PANEL_COPY.appBar.refresh}>
      <IconButton
        aria-label={PANEL_COPY.appBar.refresh}
        color="inherit"
        onClick={() => refresh()}
        size="large"
        title={PANEL_COPY.appBar.refresh}
      >
        <RefreshOutlinedIcon />
      </IconButton>
    </Tooltip>
  );
}

function ProtectedPanelLogoutMenuItem() {
  const logout = useLogout();
  const userMenu = useUserMenu();

  return (
    <MenuItem
      onClick={() => {
        userMenu?.onClose?.();
        void logout();
      }}
    >
      <ListItemIcon>
        <LogoutOutlinedIcon fontSize="small" />
      </ListItemIcon>
      <ListItemText>{PANEL_COPY.appBar.logout}</ListItemText>
    </MenuItem>
  );
}

export function ProtectedPanelUserMenu() {
  return (
    <UserMenu label={PANEL_COPY.appBar.account}>
      <ProtectedPanelLogoutMenuItem />
    </UserMenu>
  );
}

type ProtectedPanelAppBarProps = {
  alwaysOn?: boolean;
  className?: string;
};

export function ProtectedPanelAppBar(props: ProtectedPanelAppBarProps) {
  const isXSmall = useMediaQuery<Theme>((theme) => theme.breakpoints.down("sm"));

  return (
    <MuiAppBar className={props.className} color="primary">
      <Toolbar disableGutters sx={{ px: 1 }} variant={isXSmall ? "regular" : "dense"}>
        <ProtectedPanelSidebarToggleButton />
        <Box sx={{ alignItems: "center", display: "flex", flex: 1, minWidth: 0, px: 1 }}>
          <TitlePortal />
        </Box>
        <ProtectedPanelRefreshButton />
        <ProtectedPanelThemeToggleButton />
        <ProtectedPanelUserMenu />
      </Toolbar>
    </MuiAppBar>
  );
}

function ProtectedPanelMenu() {
  return (
    <Menu>
      <Menu.Item leftIcon={<DashboardOutlinedIcon />} primaryText={PANEL_COPY.menu.overview} to="/" />
      <Menu.Item
        leftIcon={<FindInPageOutlinedIcon />}
        primaryText={PANEL_COPY.menu.requests}
        to="/requests"
      />
      <Menu.Item
        leftIcon={<LanguageOutlinedIcon />}
        primaryText={PANEL_COPY.menu.officialWebSites}
        to="/officialWebSites"
      />
      <Menu.Item
        leftIcon={<TravelExploreOutlinedIcon />}
        primaryText={PANEL_COPY.menu.officialWebRuns}
        to="/officialWebRuns"
      />
      <Menu.Item leftIcon={<RuleFolderOutlinedIcon />} primaryText={PANEL_COPY.menu.jobs} to="/jobs" />
      <Menu.Item
        leftIcon={<PendingActionsOutlinedIcon />}
        primaryText={PANEL_COPY.menu.operations}
        to="/operations"
      />
      <Menu.Item leftIcon={<HistoryOutlinedIcon />} primaryText={PANEL_COPY.menu.audit} to="/audit" />
    </Menu>
  );
}

export function ProtectedPanelLayout({ children }: { children: ReactNode }) {
  return (
    <Layout
      appBar={ProtectedPanelAppBar}
      menu={ProtectedPanelMenu}
      sx={{
        "& .skip-nav-button": {
          display: "none",
        },
      }}
    >
      {children}
    </Layout>
  );
}
