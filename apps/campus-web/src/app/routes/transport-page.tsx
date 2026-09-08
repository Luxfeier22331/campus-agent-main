import type {
	TransportPublicScheduleResponse,
	TransportServiceKind,
} from "@campus-agent/transport/domain";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
	type RiderFilter,
	TransportPageView,
	transportDate,
} from "@/components/transport/transport-page-view";
import { transportScheduleQueryOptions } from "@/features/transport/queries";
import { createCampusQueryClient } from "@/platform/query/client";

const transportQueryClient = createCampusQueryClient();
export function TransportPage() {
	return (
		<QueryClientProvider client={transportQueryClient}>
			<TransportPageContent />
		</QueryClientProvider>
	);
}
export function TransportPageContent() {
	const [now, setNow] = useState(() => new Date());
	const [date, setDate] = useState(() => transportDate(new Date()));
	const [rider, setRider] = useState<RiderFilter>("all");
	const [serviceKind, setServiceKind] = useState<TransportServiceKind>("commute");
	const [selectedRoutes, setSelectedRoutes] = useState<
		Partial<Record<TransportServiceKind, string>>
	>({});
	const query = useQuery(transportScheduleQueryOptions(date));
	const [lastSuccess, setLastSuccess] = useState<TransportPublicScheduleResponse>();
	const [slowDate, setSlowDate] = useState<string>();
	const data = query.data ?? lastSuccess;
	useEffect(() => {
		if (query.isSuccess && !query.isPlaceholderData) {
			setLastSuccess(query.data);
		}
	}, [query.data, query.isSuccess, query.isPlaceholderData]);
	const allRouteChoices = data?.routeCatalog ?? [];
	const availableKinds = (["commute", "subway", "special"] as const).filter((kind) =>
		allRouteChoices.some((route) => route.serviceKind === kind),
	);
	const activeServiceKind = availableKinds.includes(serviceKind)
		? serviceKind
		: (availableKinds[0] ?? "commute");
	const routeChoices = allRouteChoices.filter((route) => route.serviceKind === activeServiceKind);
	const routeId = selectedRoutes[activeServiceKind];
	const selectedRouteId = routeChoices.some((route) => route.routeId === routeId)
		? routeId
		: routeChoices[0]?.routeId;
	useEffect(() => {
		let timer: ReturnType<typeof setTimeout>;
		const tick = () => {
			setNow(new Date());
			timer = setTimeout(tick, 60_000 - (Date.now() % 60_000));
		};
		const visible = () => {
			if (document.visibilityState === "visible") {
				clearTimeout(timer);
				tick();
			}
		};
		tick();
		document.addEventListener("visibilitychange", visible);
		return () => {
			clearTimeout(timer);
			document.removeEventListener("visibilitychange", visible);
		};
	}, []);
	useEffect(() => {
		setSlowDate(undefined);
		if (!query.isFetching) {
			return;
		}
		const timer = setTimeout(() => setSlowDate(date), 800);
		return () => clearTimeout(timer);
	}, [date, query.isFetching]);
	return (
		<TransportPageView
			data={data}
			date={date}
			routeId={selectedRouteId}
			routeChoices={routeChoices}
			rider={rider}
			now={now}
			onDateChange={setDate}
			onRouteChange={(id) =>
				setSelectedRoutes((current) => ({ ...current, [activeServiceKind]: id }))
			}
			onServiceKindChange={(kind) => {
				setServiceKind(kind);
			}}
			serviceKind={activeServiceKind}
			serviceKinds={availableKinds}
			onRiderChange={setRider}
			onRefresh={() => void query.refetch()}
			refreshing={query.isFetching}
			loading={query.isPending && !data}
			updating={query.isFetching && Boolean(data)}
			slowUpdating={query.isFetching && slowDate === date}
			failed={query.isError && !query.isFetching}
		/>
	);
}
