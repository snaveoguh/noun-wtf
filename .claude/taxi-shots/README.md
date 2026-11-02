# NOUN TAXI browser shots (2026-11-02)

Headless Chromium (SwiftShader), `/world?offline=1&skip=1&q=low&bday=0&play=taxi&camintro=0&perf=quiet`,
game stepped by hand (`__w2.step`), dev helpers `__w2.taxi.devFare / devRoutePoint / devHitchSpot`.

| shot | what |
| --- | --- |
| 01-cab-waiting | `?play=taxi`: in the NOUN CAB at the kerb, meter FOR HIRE, two fares waiting (name → destination, bearing, distance) |
| 02-pickup | a fare walks to the door; meter HIRED, shift clock frozen, fare clock running, their line in the speech bubble |
| 03-route-guide-city | route planned round the ring road (11.7 km to Dry Gulch), path ribbon on the road |
| 03b-city-ride-guide | city hop: guide arrow over the cab (tilted toward the chase camera) |
| 04b-long-haul-road | long haul on the +X dirt line at 164 km/h, 5.7 km to go, arrow + ribbon |
| 05-drop-off-receipt | drop-off in Dry Gulch: S grade, fare 99 + speed tip 58 = +157 COIN, +40 s; fare walks off; new town fares wait |
| 06-results | out of the cab: SHIFT OVER card with totals and new bests |
| 07-hitchhiker-waiting | in the ROADSTAR on the +X line: a hitchhiker thumbing a lift ("going my way?"), HUD hint |
| 08-hitchhiker-aboard | picked up: seated in the open roadster, `tx: [2, "DRY GULCH"]` |
| phone-01-cab-waiting / phone-02-long-haul | 390 × 844 touch layout: meter clear of the side buttons and icon column |

Perf (`?perf=quiet`, real loop, 40 s of a city fare with W held, 1280 × 800, q=low, SwiftShader):
`taxi` lap mean 0.23 ms, p95 0.40 ms, max 0.6 ms (same as `vehicles`, 0.23 ms); 111 draw calls a frame
in total with the guide up (the guide is 3 meshes); programs 59.
