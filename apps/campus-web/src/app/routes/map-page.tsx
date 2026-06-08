import { MapPin } from "lucide-react";
import maplibregl from "maplibre-gl";
import { useEffect, useRef, useState } from "react";

import { ErrorPanel, LoadingPanel } from "@/components/shell/state-panels";
import { Card } from "@/components/ui/card";
import { getCampusMapPlaces } from "@/features/map/api";
import type { CampusMapPlace, CampusMapPlacesResponse } from "@/features/map/model";

export function MapPage() {
	const mapRef = useRef<HTMLDivElement | null>(null);
	const mapInstanceRef = useRef<maplibregl.Map | null>(null);
	const [data, setData] = useState<CampusMapPlacesResponse | null>(null);
	const [selected, setSelected] = useState<CampusMapPlace | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		getCampusMapPlaces()
			.then((nextData) => {
				setData(nextData);
				setSelected(nextData.places[0] ?? null);
			})
			.catch((reason: unknown) => {
				setError(reason instanceof Error ? reason.message : "地图加载失败。");
			});
	}, []);

	useEffect(() => {
		if (!(data && mapRef.current && !mapInstanceRef.current)) {
			return;
		}
		const map = new maplibregl.Map({
			center: data.campus.defaultCenter,
			container: mapRef.current,
			style: {
				version: 8,
				sources: {},
				layers: [
					{
						id: "background",
						type: "background",
						paint: {
							"background-color": "#eef0f3",
						},
					},
				],
			},
			zoom: 16,
		});
		mapInstanceRef.current = map;
		for (const place of data.places) {
			const marker = document.createElement("button");
			marker.className = "campus-map-marker";
			marker.type = "button";
			marker.dataset.selected = String(selected?.id === place.id);
			marker.innerHTML = `<span aria-hidden="true">•</span>`;
			marker.addEventListener("click", () => setSelected(place));
			new maplibregl.Marker({ element: marker })
				.setLngLat(place.geojson.geometry.coordinates)
				.addTo(map);
		}
		return () => {
			map.remove();
			mapInstanceRef.current = null;
		};
	}, [data, selected?.id]);

	return (
		<section className="mx-auto max-w-[1440px] px-5 py-6 pb-24 lg:px-6">
			<div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
				<div>
					<p className="text-sm font-medium text-primary">{data?.campus.name ?? "校园地图"}</p>
					<h1 className="mt-1 text-3xl font-semibold tracking-normal text-[var(--sys-text-strong)]">
						校园地图
					</h1>
				</div>
				<input
					className="min-h-11 rounded-lg border border-input px-3 text-sm outline-none focus:border-ring focus:shadow-[var(--state-focus-shadow)]"
					placeholder="搜索地点"
				/>
			</div>
			{error ? <ErrorPanel message={error} /> : null}
			{data ? (
				<div className="grid gap-4 lg:grid-cols-[1fr_320px]">
					<div
						className="min-h-[var(--layout-map-canvas-min-height)] overflow-hidden rounded-2xl border border-border bg-[var(--map-canvas-bg)]"
						ref={mapRef}
					/>
					<Card className="p-4">
						{selected ? (
							<div>
								<span className="grid size-10 place-items-center rounded-lg bg-[var(--sys-brand-interactive-subtle)] text-primary">
									<MapPin aria-hidden="true" className="size-5" />
								</span>
								<h2 className="mt-4 text-xl font-semibold text-[var(--sys-text-strong)]">
									{selected.title}
								</h2>
								<p className="mt-2 text-sm leading-6 text-[var(--sys-text-muted)]">
									{selected.description}
								</p>
								<div className="mt-4 flex flex-wrap gap-2">
									{selected.tags.map((tag) => (
										<span
											className="rounded-full bg-[var(--sys-bg-muted)] px-3 py-1 text-xs text-[var(--sys-text-muted)]"
											key={tag}
										>
											{tag}
										</span>
									))}
								</div>
							</div>
						) : null}
					</Card>
				</div>
			) : (
				<LoadingPanel label="正在读取地图" />
			)}
		</section>
	);
}
