import type { Page } from "@playwright/test";

export async function installMapLibreMock(page: Page) {
	await page.addInitScript(() => {
		window.maplibregl = {
			Map: class {
				private readonly canvas = document.createElement("canvas");
				constructor(input: { container: HTMLElement }) {
					input.container.appendChild(this.canvas);
				}
				addControl() {
					return this;
				}
				fitBounds() {
					return this;
				}
				flyTo() {
					return this;
				}
				getCanvas() {
					return this.canvas;
				}
				on() {
					return this;
				}
				once(_eventName: string, listener: () => void) {
					window.setTimeout(listener, 0);
					return this;
				}
				queryRenderedFeatures() {
					return [];
				}
				remove() {
					this.canvas.remove();
					return this;
				}
				resize() {
					return this;
				}
				setFilter() {
					return this;
				}
				setMaxBounds() {
					return this;
				}
				setMaxZoom() {
					return this;
				}
				setMinZoom() {
					return this;
				}
				setStyle() {
					return this;
				}
			},
			Marker: class {
				private readonly element: HTMLElement;
				constructor(input: { element: HTMLElement }) {
					this.element = input.element;
				}
				addTo(map: { getCanvas?: () => HTMLCanvasElement }) {
					map.getCanvas?.().parentElement?.appendChild(this.element);
					return this;
				}
				remove() {
					this.element.remove();
					return this;
				}
				setLngLat() {
					return this;
				}
			},
			NavigationControl: class {},
			ScaleControl: class {},
		};
	});
}
