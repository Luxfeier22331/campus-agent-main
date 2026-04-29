import { type Theme, useMediaQuery } from "@mui/material";
import { BarChart, type BarChartProps } from "@mui/x-charts/BarChart";
import { LineChart, type LineChartProps } from "@mui/x-charts/LineChart";

type ChartMargin = BarChartProps["margin"] | LineChartProps["margin"];

const PANEL_CHART_SX = {
	maxWidth: "100%",
	minWidth: 0,
	width: "100%",
	"& .MuiChartsLegend-root": {
		alignItems: "flex-start",
		flexWrap: "wrap",
		justifyContent: "flex-start",
		maxWidth: "100%",
	},
	"& .MuiChartsSurface-root, & .MuiChartsWrapper-root": {
		maxWidth: "100%",
		minWidth: 0,
	},
};

function clampChartHeight(
	height: BarChartProps["height"] | LineChartProps["height"],
	isSmall: boolean,
) {
	if (!isSmall || typeof height !== "number") {
		return height;
	}

	return Math.min(height, 260);
}

function compactChartMargin(margin: ChartMargin): ChartMargin {
	if (typeof margin === "number") {
		return margin;
	}

	return {
		...margin,
		bottom: Math.min(margin?.bottom ?? 28, 32),
		left: Math.min(margin?.left ?? 36, 40),
		right: Math.min(margin?.right ?? 8, 12),
		top: Math.min(margin?.top ?? 12, 16),
	};
}

export function PanelLineChart({ height, hideLegend, margin, sx: _sx, ...props }: LineChartProps) {
	const isSmall = useMediaQuery<Theme>((theme) => theme.breakpoints.down("sm"));

	return (
		<LineChart
			{...props}
			height={clampChartHeight(height, isSmall)}
			hideLegend={isSmall ? true : hideLegend}
			margin={isSmall ? compactChartMargin(margin) : margin}
			sx={PANEL_CHART_SX}
		/>
	);
}

export function PanelBarChart({ height, hideLegend, margin, sx: _sx, ...props }: BarChartProps) {
	const isSmall = useMediaQuery<Theme>((theme) => theme.breakpoints.down("sm"));

	return (
		<BarChart
			{...props}
			height={clampChartHeight(height, isSmall)}
			hideLegend={isSmall ? true : hideLegend}
			margin={isSmall ? compactChartMargin(margin) : margin}
			sx={PANEL_CHART_SX}
		/>
	);
}
