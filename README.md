# Weather-Aware Truck Routing

Pick a trip, a departure time and a load. The app returns three truck routes, checks the forecast at every checkpoint **for the hour your truck gets there**, rates each one with the risk and load rules, and recommends the safest route. A map shows the routes, checkpoints, risk and ETAs, plus a weather heatmap along the corridor with a 48‑hour forecast slider.

React + TypeScript (Vite, shadcn/ui, MapLibre GL) on top of Django + DRF.

- **Live app:** https://spotter-weather-routing-zeta.vercel.app
- **Walkthrough (Loom):** _link after recording_

## Try it

Every load opens on a choice:

- **Demo data** (recommended for reviewing). Replays two recorded live trips (Charlotte → New York, Denver → Salt Lake City) under switchable weather scenarios: rain band, high wind, mountain snow, No Travel, mixed, calm, and the recorded forecast. You can see every risk level, badge and load rule, and take a simulated drive. It runs entirely in the browser.
- **Live data.** Real TomTom truck routes for any US or Canada trip and real Open-Meteo forecasts. Navigate uses the phone's GPS and compass when you're at the start.

Refresh the page to switch.

## What it does, mapped to the brief

| Brief | Where |
|---|---|
| Origin, destination, departure, load | Plan panel. Origin offers "Your location". Up to 3 stops. Departure up to 7 days ahead. |
| 3 route options from a routing API | TomTom truck routing (`travelMode=truck`, `vehicleWeight`, `departAt`, alternatives). Forced via-point alternates if TomTom returns fewer than 3. OSRM as a keyless fallback. |
| Weather every 10 / 25 / 50 mi at the truck's ETA | Checkpoints for all three intervals are computed server-side. The 10/25/50 switch is instant. Each checkpoint carries its hourly forecast, read at departure + travel time to that point. |
| Risk from the wind/rain/snow and load rules | `backend/planner/domain/risk.py`, with the scalar and vectorised versions tested against each other on every band edge. |
| Recommend: fewest Severe miles → fewest High miles → lowest average risk → shortest time | `backend/planner/domain/recommend.py`. Each route gets a one-line verdict per risk level (Low "Safe to run" … No Travel "Do not dispatch"). "Why this route" names the deciding criterion and shows the full ranking table. |
| Routes, checkpoints, risk, ETAs and summaries on a map | The selected route is coloured by risk at ETA, with alternatives in grey. Checkpoint dots (once zoomed in) and Severe/No Travel weather badges open a popup: level and verdict, the readings that set it, the load-rule note and ETA. A risk strip shows the route by distance; hover any stretch for its checkpoint. A ranking table backs the recommendation. |
| Weather heatmap along the corridor with a 0–48 h slider | An H3 hex corridor around all routes, Risk/Wind/Rain/Snow layers, and a 48 h track with Play. The heatmap turns on when the forecast plays or the knob is dragged, and Layers turns it on any time. |

Beyond the brief, kept small and in service of it:
- **Departure pin on the timeline.** Drag it and every route, checkpoint and the recommendation re-time instantly. Every departure hour is precomputed, so dragging never waits on the network. The track is tinted by how safe the selected route would be for each departure, and a green flag marks the first safer departure (one tap applies it, with Undo).
- **Start rules.** "Start now" only when leaving now. Otherwise you get "Preview drive", a labelled simulation at the planned time. A route with No Travel miles asks first and offers a safer route or a later departure.
- **Navigate.** A Google Maps-style driving view: close heading-up camera, next turn, weather-ahead warnings, and the map turning with the phone's compass on a real drive.
- **Optional 3D view:** terrain with hillshade.

## Risk logic and the assumptions behind it

The brief's tables leave some edges open. These are the readings I chose, each covered by tests:

- **Band edges are half-open `[lower, upper)`.** Rain 0.25 in/hr is High, not Moderate. Wind 34.9 mph is Moderate. The brief's top edges stay exactly as written: wind ≥ 55 mph is No Travel, but rain of exactly 1.00 in/hr and snow of exactly 3.0 in/hr are still Severe, because No Travel is "> 1.00" and "> 3.0".
- **Inputs.** Wind is sustained 10 m wind; gusts are shown but don't classify, since the brief says "wind". Rain is `rain + showers` (in/hr). Snow is new `snowfall` (in/hr, not depth).
- **Checkpoint level** is the worst of wind, rain, snow and the load rules. The load rules only ever raise the level.
- **Risk miles.** Each checkpoint stands for half the gap to each neighbour, so a route's miles add up to its length. Coarser intervals sample less of the route, so totals can shift between 10, 25 and 50 mi. 10 mi is the default, chosen in Plan and fixed while comparing so totals never shift underfoot.
- **Ranking adds No Travel miles first.** The brief doesn't mention No Travel, but a route through No Travel can't be "safer" than one without. After that it follows the brief: Severe miles, High miles, mile-weighted average risk (Low 0 … No Travel 4), travel time. Values are rounded before comparing (0.1 mi, 0.01, 1 minute) so float noise can't decide a tie.
- **Load rule direction.** As written, heavier loads in high wind rate worse. In practice light or empty trailers are the ones that blow over. I kept the brief's rule and note it under "What I'd do next".
- **ETA** is TomTom's traffic-aware truck travel time for the entered departure. When the departure pin moves, weather exposure is re-timed using that same driving time, and Start re-plans for the exact moment.

## How it works

```
React (Vite)                                   Django + DRF
─────────────                                  ────────────
Plan form ──POST /api/plan──────────────▶ validate (region, 7-day window, load, stops)
                                           routing: TomTom truck ×3 (+ forced alternates, OSRM fallback)
                                           geometry: Douglas–Peucker at 5 m, travel time per vertex
                                           timeline: 48 h track around the departure
                                           checkpoints @ 10/25/50 mi → hourly series per point
                                           weather: Open-Meteo, batched, snapped, cached
                                           risk: vectorised bands → levels per hour
                                           schedule: ranking for every departure hour × interval
                                           corridor: H3 cells × 49 hours
Compare / timeline / map ◀──one JSON (≈165 KB gzipped)──┘
(no more requests while you drag, switch intervals, play or navigate)
```

- **Backend** (`backend/planner`): pure domain modules (`risk`, `recommend`, `geometry`, `timeline`, `corridor`, `guidance`, `region`) with no I/O, services for TomTom, OSRM, Open-Meteo and Photon, and `planner.py` to assemble the plan. 111 pytest tests.
- **Frontend** (`frontend/src`): `api/types.ts` is the contract. `map/MapView.tsx` drives MapLibre directly. `components/` holds the panels, timeline and Navigate overlay. `mocks/` is the demo engine, which builds the same contract in the browser from recorded routes plus synthetic weather run through a mirror of the risk rules.

## API choices

| Need | Choice | Why |
|---|---|---|
| Truck routing | **TomTom** Routing API (free key, no card) | Truck profile with weight, departure-time traffic, and alternatives that also work with waypoints. Keyless options (OSRM, public Valhalla) often return fewer than 3 routes and have no weight. Google's truck routing is allowlisted and returns a single route. |
| Weather | **Open-Meteo** (no key) | Hourly forecasts 15+ days out, in mph and inches, with many points per request. The free tier is rate-limited per *location*, so points snap to a shared 0.1° grid (coarser for very long trips), are deduplicated across routes and intervals, and are cached until the next model hour. Each plan is capped at 200 lookups, and the grid coarsens (0.1° → 0.5°) until it fits. |
| Geocoding | **Photon** (komoot, no key) | Type-ahead search over OpenStreetMap, proxied and cached by Django. |
| Map | **MapLibre GL** + OpenFreeMap tiles + Mapterhorn terrain | Open source, no key, WebGL with pitch and terrain for the 3D view. Google Maps was considered, but its vector map tilts only 30° at trip zoom, has no terrain, and its terms bar mixing in non-Google routes. |

## Performance

- **One request per plan.** Every departure hour × interval × route is precomputed server-side, so dragging the pin, switching interval, playing the forecast or navigating never waits on the network.
- **The heatmap doesn't re-upload data when the hour changes.** Hex colours are driven by MapLibre `feature-state` from typed arrays. Wind, rain and snow blend between hours while scrubbing.
- **The driving camera** updates every animation frame (position exact, heading eased). React state updates only a few times a second.
- **The app bundle preloads behind the start screen.** Vendor code is split (map engine, UI kit) and demo data is lazy-loaded.

## Run it locally

Requirements: Python 3.12+, Node 22+.

```bash
# Backend
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
cp .env.example .env          # add TOMTOM_API_KEY (free at developer.tomtom.com); without it routing falls back to OSRM
python manage.py runserver 8000
pytest -q                     # 111 tests

# Frontend (second terminal)
cd frontend
npm install
npm run dev                   # http://localhost:5173, proxies /api to :8000
npx vitest run
```

Optional `REDIS_URL` (e.g. Upstash free) shares the weather cache across serverless instances. Without it, an in-memory cache is used.

## Deploy

One Vercel project: the Vite build is served as static files, and Django runs as a Python function at `api/index.py` behind a `/api/*` rewrite (`vercel.json`). Set `TOMTOM_API_KEY` (and optionally `REDIS_URL`, `DJANGO_SECRET_KEY`) in the project's environment variables.

## Trade-offs and limits

- **Hours of service** (mandatory breaks) aren't modelled, so ETAs are continuous driving.
- **Weather resolution.** Open-Meteo blends NOAA models at about 3 km, but points snap to a 0.1° grid (about 7 mi) to stay inside the free rate limit. Pulling NOAA's NBM grid directly would give 2.5 km without per-point limits. It worked in a prototype but takes about 35 s cold per corridor through NOAA's public subsetting service, so it's listed as next.
- **Re-timing.** Moving the departure pin re-times weather exposure with the entered departure's driving time; traffic differences between hours are ignored until you Start.
- **Free-tier limits.** Open-Meteo's free tier allows about 10,000 lookups a day per IP. When it's spent, the API answers 503 with `code: "weather_quota"` and the app offers "Use demo data for this trip", which re-runs the same trip on demo data. The allowance resets at 00:00 UTC. A shared `REDIS_URL` cache keeps repeat trips from spending it again. The demo's synthetic weather is clearly labelled and is never mixed with live data.

## What I'd do next

- Use NOAA NBM/HRRR grids directly, preprocessed hourly, for 2.5–3 km weather with no per-point limits.
- An empty or light trailer wind rule alongside the brief's heavy-load rule.
- Hours-of-service-aware ETAs and suggested stops when a window is closing.
- Push alerts when the forecast changes for a planned trip, and re-routing around hazards during Navigate.
- Make the demo scenarios a seeded test fixture for end-to-end UI tests (Playwright).
