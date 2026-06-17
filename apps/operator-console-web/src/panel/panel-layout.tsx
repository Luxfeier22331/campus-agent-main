import AccountCircleOutlinedIcon from "@mui/icons-material/AccountCircleOutlined";
import AdminPanelSettingsOutlinedIcon from "@mui/icons-material/AdminPanelSettingsOutlined";
import DashboardOutlinedIcon from "@mui/icons-material/DashboardOutlined";
import FactCheckOutlinedIcon from "@mui/icons-material/FactCheckOutlined";
import FindInPageOutlinedIcon from "@mui/icons-material/FindInPageOutlined";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import LanguageOutlinedIcon from "@mui/icons-material/LanguageOutlined";
import LogoutOutlinedIcon from "@mui/icons-material/LogoutOutlined";
import MarkEmailReadOutlinedIcon from "@mui/icons-material/MarkEmailReadOutlined";
import MenuOutlinedIcon from "@mui/icons-material/MenuOutlined";
import PaidOutlinedIcon from "@mui/icons-material/PaidOutlined";
import PendingActionsOutlinedIcon from "@mui/icons-material/PendingActionsOutlined";
import QueryStatsOutlinedIcon from "@mui/icons-material/QueryStatsOutlined";
import RefreshOutlinedIcon from "@mui/icons-material/RefreshOutlined";
import RestaurantOutlinedIcon from "@mui/icons-material/RestaurantOutlined";
import RuleFolderOutlinedIcon from "@mui/icons-material/RuleFolderOutlined";
import SettingsInputComponentOutlinedIcon from "@mui/icons-material/SettingsInputComponentOutlined";
import TravelExploreOutlinedIcon from "@mui/icons-material/TravelExploreOutlined";
import {
	Box,
	IconButton,
	ListItemIcon,
	ListItemText,
	MenuItem,
	AppBar as MuiAppBar,
	Menu as MuiMenu,
	type Theme,
	Toolbar,
	Tooltip,
	useMediaQuery,
} from "@mui/material";
import { type MouseEvent, type ReactNode, useState } from "react";
import {
	Layout,
	Menu as RaMenu,
	TitlePortal,
	useGetIdentity,
	useLogout,
	useRefresh,
	useSidebarState,
} from "react-admin";

import { clearSequentialCursorHistory } from "./data-provider/cursor";
import { PANEL_COPY } from "./panel-copy";

function OperatorConsoleSidebarToggleButton() {
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

function OperatorConsoleRefreshButton() {
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

function OperatorConsoleLogoutMenuItem() {
	const logout = useLogout();

	return (
		<MenuItem
			onClick={() => {
				clearSequentialCursorHistory();
				void logout(null);
			}}
		>
			<ListItemIcon>
				<LogoutOutlinedIcon fontSize="small" />
			</ListItemIcon>
			<ListItemText>{PANEL_COPY.appBar.logout}</ListItemText>
		</MenuItem>
	);
}

export function OperatorConsoleUserMenu() {
	const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
	const { identity } = useGetIdentity();
	const open = Boolean(anchorEl);
	const label = identity?.fullName || PANEL_COPY.appBar.account;

	const handleOpen = (event: MouseEvent<HTMLButtonElement>) => {
		setAnchorEl(event.currentTarget);
	};
	const handleClose = () => {
		setAnchorEl(null);
	};

	return (
		<>
			<Tooltip enterDelay={300} title={label}>
				<IconButton
					aria-controls={open ? "operator-console-account-menu" : undefined}
					aria-expanded={open ? "true" : undefined}
					aria-haspopup="menu"
					aria-label={PANEL_COPY.appBar.account}
					color="inherit"
					onClick={handleOpen}
					size="large"
				>
					<AccountCircleOutlinedIcon />
				</IconButton>
			</Tooltip>
			<MuiMenu
				anchorEl={anchorEl}
				id="operator-console-account-menu"
				onClose={handleClose}
				open={open}
			>
				<MenuItem disabled>{label}</MenuItem>
				<OperatorConsoleLogoutMenuItem />
			</MuiMenu>
		</>
	);
}

interface OperatorConsoleAppBarProps {
	alwaysOn?: boolean;
	className?: string;
}

export function OperatorConsoleAppBar(props: OperatorConsoleAppBarProps) {
	const isXSmall = useMediaQuery<Theme>((theme) => theme.breakpoints.down("sm"));

	return (
		<MuiAppBar className={props.className} color="default">
			<Toolbar disableGutters sx={{ px: 1 }} variant={isXSmall ? "regular" : "dense"}>
				<OperatorConsoleSidebarToggleButton />
				<Box sx={{ alignItems: "center", display: "flex", flex: 1, minWidth: 0, px: 1 }}>
					<TitlePortal />
				</Box>
				<OperatorConsoleRefreshButton />
				<OperatorConsoleUserMenu />
			</Toolbar>
		</MuiAppBar>
	);
}

function OperatorConsoleMenu() {
	return (
		<RaMenu>
			<RaMenu.Item
				leftIcon={<DashboardOutlinedIcon />}
				primaryText={PANEL_COPY.menu.overview}
				to="/observability/overview"
			/>
			<RaMenu.Item
				leftIcon={<QueryStatsOutlinedIcon />}
				primaryText={PANEL_COPY.menu.quality}
				to="/observability/quality"
			/>
			<RaMenu.Item
				leftIcon={<FactCheckOutlinedIcon />}
				primaryText={PANEL_COPY.menu.evalCoverage}
				to="/observability/eval-coverage"
			/>
			<RaMenu.Item
				leftIcon={<QueryStatsOutlinedIcon />}
				primaryText={PANEL_COPY.menu.intent}
				to="/observability/intent"
			/>
			<RaMenu.Item
				leftIcon={<AdminPanelSettingsOutlinedIcon />}
				primaryText={PANEL_COPY.menu.safety}
				to="/observability/safety"
			/>
			<RaMenu.Item
				leftIcon={<PaidOutlinedIcon />}
				primaryText={PANEL_COPY.menu.cost}
				to="/observability/cost"
			/>
			<RaMenu.Item
				leftIcon={<FindInPageOutlinedIcon />}
				primaryText={PANEL_COPY.menu.requests}
				to="/requests"
			/>
			<RaMenu.Item
				leftIcon={<MarkEmailReadOutlinedIcon />}
				primaryText={PANEL_COPY.menu.authenticatedNoticeProcessing}
				to="/authenticatedNoticeProcessing"
			/>
			<RaMenu.Item
				leftIcon={<PendingActionsOutlinedIcon />}
				primaryText={PANEL_COPY.menu.authenticatedNoticeRunProcessing}
				to="/authenticatedNoticeRunProcessing"
			/>
			<RaMenu.Item
				leftIcon={<LanguageOutlinedIcon />}
				primaryText={PANEL_COPY.menu.officialWebSites}
				to="/officialWebSites"
			/>
			<RaMenu.Item
				leftIcon={<RuleFolderOutlinedIcon />}
				primaryText={PANEL_COPY.menu.officialWebTargetJobs}
				to="/officialWebTargetJobs"
			/>
			<RaMenu.Item
				leftIcon={<Inventory2OutlinedIcon />}
				primaryText={PANEL_COPY.menu.officialWebTargetInventory}
				to="/officialWebTargetInventory"
			/>
			<RaMenu.Item
				leftIcon={<TravelExploreOutlinedIcon />}
				primaryText={PANEL_COPY.menu.officialWebRuns}
				to="/officialWebRuns"
			/>
			<RaMenu.Item
				leftIcon={<RuleFolderOutlinedIcon />}
				primaryText={PANEL_COPY.menu.jobs}
				to="/jobs"
			/>
			<RaMenu.Item
				leftIcon={<RestaurantOutlinedIcon />}
				primaryText={PANEL_COPY.menu.diningOperations}
				to="/operations/dining"
			/>
			<RaMenu.Item
				leftIcon={<SettingsInputComponentOutlinedIcon />}
				primaryText={PANEL_COPY.menu.providerConfig}
				to="/operations/provider-config"
			/>
			<RaMenu.Item
				leftIcon={<HistoryOutlinedIcon />}
				primaryText={PANEL_COPY.menu.audit}
				to="/observability/audit"
			/>
		</RaMenu>
	);
}

export function OperatorConsoleLayout({ children }: { children: ReactNode }) {
	return (
		<Layout
			appBar={OperatorConsoleAppBar}
			menu={OperatorConsoleMenu}
			sx={{
				boxSizing: "border-box",
				maxWidth: "100%",
				minWidth: 0,
				width: "100%",
				"& .RaLayout-appFrame, & .RaLayout-contentWithSidebar, & .RaLayout-content": {
					boxSizing: "border-box",
					maxWidth: "100%",
					minWidth: 0,
					width: "100%",
				},
				"& .RaList-root, & .RaList-main, & .RaList-actions, & .RaList-content": {
					maxWidth: "100%",
					minWidth: 0,
				},
				"& .RaLayout-content": {
					minWidth: 0,
					overflowX: "clip",
				},
				"@media (max-width: 599.95px)": {
					"& .RaLayout-content": {
						flexBasis: "auto",
						maxWidth: "100%",
						width: "100%",
					},
					"& .RaLayout-contentWithSidebar": {
						display: "block",
					},
				},
			}}
		>
			{children}
		</Layout>
	);
}
