/**
 * Weather enrichment via Open-Meteo — free, no API key, no signup.
 *
 * Chain: caller area-code → city/region (phone-geo) → geocode to lat/lon
 * (Open-Meteo geocoding) → current conditions (Open-Meteo forecast).
 *
 * Geocoding results are cached in-process (keyed by the location string) so repeated
 * callers from the same area code don't re-geocode. Everything is best-effort and
 * returns null on any failure.
 */

const geoCache = new Map<string, { lat: number; lon: number; label: string } | null>();

// WMO weather interpretation codes → short description.
const WMO: Record<number, string> = {
	0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
	45: 'Fog', 48: 'Freezing fog',
	51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
	56: 'Freezing drizzle', 57: 'Freezing drizzle',
	61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
	66: 'Freezing rain', 67: 'Heavy freezing rain',
	71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
	80: 'Rain showers', 81: 'Rain showers', 82: 'Violent rain showers',
	85: 'Snow showers', 86: 'Heavy snow showers',
	95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Severe thunderstorm'
};

export interface Weather {
	tempC: number | null;
	tempF: number | null;
	description: string | null;
	windKph: number | null;
	location: string | null;
}

/** "Washington (Seattle)" → "Seattle"; "New Jersey (Newark, Jersey City)" → "Newark". */
function cityFromLocation(location: string): string {
	const m = location.match(/\(([^,)]+)/);
	return (m ? m[1] : location).trim();
}

export async function geocodeLocation(
	location: string
): Promise<{ lat: number; lon: number; label: string } | null> {
	if (geoCache.has(location)) return geoCache.get(location)!;
	const city = cityFromLocation(location);
	try {
		const res = await fetch(
			`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`
		);
		if (!res.ok) {
			geoCache.set(location, null);
			return null;
		}
		const j = await res.json();
		const r = j?.results?.[0];
		const val = r
			? { lat: r.latitude, lon: r.longitude, label: `${r.name}${r.admin1 ? ', ' + r.admin1 : ''}` }
			: null;
		geoCache.set(location, val);
		return val;
	} catch {
		geoCache.set(location, null);
		return null;
	}
}

export async function getWeather(lat: number, lon: number, label?: string): Promise<Weather | null> {
	try {
		const res = await fetch(
			`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m`
		);
		if (!res.ok) return null;
		const c = (await res.json())?.current;
		if (!c) return null;
		const tempC = c.temperature_2m ?? null;
		return {
			tempC,
			tempF: tempC != null ? Math.round((tempC * 9) / 5 + 32) : null,
			description: WMO[c.weather_code] ?? null,
			windKph: c.wind_speed_10m ?? null,
			location: label ?? null
		};
	} catch {
		return null;
	}
}

/** Current weather for a phone-geo location string (area-code city). Best-effort. */
export async function weatherForLocation(location: string | null | undefined): Promise<Weather | null> {
	if (!location) return null;
	const geo = await geocodeLocation(location);
	if (!geo) return null;
	return getWeather(geo.lat, geo.lon, geo.label);
}
