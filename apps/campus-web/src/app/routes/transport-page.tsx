import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
	type RiderFilter,
	type RouteChoice,
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
	const [routeId, setRouteId] = useState<string>();
	const [routeChoices, setRouteChoices] = useState<RouteChoice[]>([]);
	const query = useQuery(transportScheduleQueryOptions(date));
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
		if (!query.data) {
			return;
		}
		setRouteId((selected) => selected ?? query.data.routes[0]?.routeId);
		setRouteChoices((previous) => {
			const retained = previous.filter(
				(item) => !query.data.routes.some((route) => route.routeId === item.routeId),
			);
			return [
				...query.data.routes.map(({ routeId, origin, destination, serviceKind }) => ({
					routeId,
					origin,
					destination,
					serviceKind,
				})),
				...retained,
			];
		});
	}, [query.data]);
	return (
		<TransportPageView
			data={query.data}
			date={date}
			routeId={routeId}
			routeChoices={routeChoices}
			rider={rider}
			now={now}
			onDateChange={setDate}
			onRouteChange={setRouteId}
			onRiderChange={setRider}
			onRefresh={() => void query.refetch()}
			refreshing={query.isFetching}
			loading={query.isPending}
			failed={query.isError}
		/>
	);
}
