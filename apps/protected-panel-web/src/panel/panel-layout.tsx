import AdminPanelSettingsOutlinedIcon from "@mui/icons-material/AdminPanelSettingsOutlined";
import DashboardOutlinedIcon from "@mui/icons-material/DashboardOutlined";
import FindInPageOutlinedIcon from "@mui/icons-material/FindInPageOutlined";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import LanguageOutlinedIcon from "@mui/icons-material/LanguageOutlined";
import LogoutOutlinedIcon from "@mui/icons-material/LogoutOutlined";
import MenuOutlinedIcon from "@mui/icons-material/MenuOutlined";
import PaidOutlinedIcon from "@mui/icons-material/PaidOutlined";
import PendingActionsOutlinedIcon from "@mui/icons-material/PendingActionsOutlined";
import QueryStatsOutlinedIcon from "@mui/icons-material/QueryStatsOutlined";
import RefreshOutlinedIcon from "@mui/icons-material/RefreshOutlined";
import RuleFolderOutlinedIcon from "@mui/icons-material/RuleFolderOutlined";
import TravelExploreOutlinedIcon from "@mui/icons-material/TravelExploreOutlined";
import {
	Box,
	IconButton,
	ListItemIcon,
	ListItemText,
	MenuItem,
	AppBar as MuiAppBar,
	type Theme,
	Toolbar,
	Tooltip,
	useMediaQuery,
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
	useUserMenu,
} from "react-admin";

import { PANEL_COPY } from "./panel-copy";

function ProtectedPanelSidebarToggleButton() {
	const [open, setOpen] = useSidebarState();
	const label = open ? PANEL_COPY.appBar.closeMenu : PANEL_COPY.appBar.openMenu;

	return (
		<Tooltip enterDelay={300} title={label}>
			<IconButton aria-label={label} color="inherit" onClick={() => setOpen(!open)} size="large">
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
				<ProtectedPanelUserMenu />
			</Toolbar>
		</MuiAppBar>
	);
}

function ProtectedPanelMenu() {
	return (
		<Menu>
			<Menu.Item
				leftIcon={<DashboardOutlinedIcon />}
				primaryText={PANEL_COPY.menu.overview}
				to="/observability/overview"
			/>
			<Menu.Item
				leftIcon={<QueryStatsOutlinedIcon />}
				primaryText={PANEL_COPY.menu.quality}
				to="/observability/quality"
			/>
			<Menu.Item
				leftIcon={<AdminPanelSettingsOutlinedIcon />}
				primaryText={PANEL_COPY.menu.safety}
				to="/observability/safety"
			/>
			<Menu.Item
				leftIcon={<PaidOutlinedIcon />}
				primaryText={PANEL_COPY.menu.cost}
				to="/observability/cost"
			/>
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
			<Menu.Item
				leftIcon={<RuleFolderOutlinedIcon />}
				primaryText={PANEL_COPY.menu.jobs}
				to="/jobs"
			/>
			<Menu.Item
				leftIcon={<PendingActionsOutlinedIcon />}
				primaryText={PANEL_COPY.menu.operations}
				to="/operations"
			/>
			<Menu.Item
				leftIcon={<HistoryOutlinedIcon />}
				primaryText={PANEL_COPY.menu.audit}
				to="/observability/audit"
			/>
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
