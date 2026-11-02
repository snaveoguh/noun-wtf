# Road trip browser shots (2026-11-02)

Headless Chromium (SwiftShader), `?offline=1&skip=1&q=low&camintro=0&spot=<id>`, 1280×720 unless `-phone` (390×844).

- `peak-*`, `pines-*`, `diesel-*`: the three side towns (a: top of main street, b: from the road at the spur junction, c: approaching down the line).
- `gas-2-7-*`, `truck-1-23-*`, `rest-2-20-*`: a gas station, a truck stop, a rest area.
- `road-dist-2-1.jpg`: distance sign on the +X line (GAS 2 KM / DRY GULCH 6 KM / PUERTO NOUN 23 KM). `road-bb-2-2.jpg`, `road-dist-2-4.jpg`: more of the +X road.
- `pines-phone-a.jpg`: phone layout in Loon Lake.

The pines / diesel / station shots were taken before the junction-arrow fix (`peak-*` after).

Numbers (`?perf=quiet`, near Diesel Flats / Loon Lake, after 30 s): road chunks 0.6–13 ms each, 2–6 draws; 173–182 draws, 53–55 programs in total (the towns' shared materials: no new programs). The first road chunk of a session costs 100–170 ms (a one-off cold start); warm station chunks 1–22 ms.
