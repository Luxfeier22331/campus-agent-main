import type maplibregl from "maplibre-gl";

export type MapLibreRuntime = typeof maplibregl;

const MAPLIBRE_SCRIPT_ID = "campus-maplibre-gl-script";
const MAPLIBRE_STYLE_ID = "campus-maplibre-gl-style";
const MAPLIBRE_SCRIPT_SRC = "/vendor/maplibre-gl/maplibre-gl.js";
const MAPLIBRE_STYLE_HREF = "/vendor/maplibre-gl/maplibre-gl.css";

declare global {
	interface Window {
		maplibregl?: MapLibreRuntime;
	}
}

let loadPromise: Promise<MapLibreRuntime> | null = null;

export function loadMapLibre(): Promise<MapLibreRuntime> {
	if (typeof window === "undefined" || typeof document === "undefined") {
		return Promise.reject(new Error("MapLibre requires a browser document."));
	}

	if (window.maplibregl) {
		return Promise.resolve(window.maplibregl);
	}

	loadPromise ??= new Promise((resolve, reject) => {
		ensureMapLibreStylesheet();

		const existingScript = document.getElementById(MAPLIBRE_SCRIPT_ID) as HTMLScriptElement | null;
		const script = existingScript ?? document.createElement("script");

		script.addEventListener(
			"load",
			() => {
				if (!window.maplibregl) {
					reject(new Error("MapLibre vendor script loaded without registering maplibregl."));
					return;
				}
				resolve(window.maplibregl);
			},
			{ once: true },
		);
		script.addEventListener(
			"error",
			() => {
				reject(new Error("MapLibre vendor script failed to load."));
			},
			{ once: true },
		);

		if (!existingScript) {
			script.id = MAPLIBRE_SCRIPT_ID;
			script.src = MAPLIBRE_SCRIPT_SRC;
			script.async = true;
			document.head.appendChild(script);
		}
	});

	return loadPromise;
}

function ensureMapLibreStylesheet() {
	if (document.getElementById(MAPLIBRE_STYLE_ID)) {
		return;
	}

	const link = document.createElement("link");
	link.id = MAPLIBRE_STYLE_ID;
	link.rel = "stylesheet";
	link.href = MAPLIBRE_STYLE_HREF;
	document.head.appendChild(link);
}
