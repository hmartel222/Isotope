# Google Maps Places — three-case evaluation

One documented Google contract change, one consumer pattern, three code postures. That is the demo, not “clone n8n at v0.1 and bump it to HEAD.”

The change is Places API (Legacy) → Places API (New): `result.formatted_address` goes away; `formattedAddress` appears at the top of the Place object ([migration table](https://developers.google.com/maps/documentation/places/web-service/legacy/migrate-response)). Fixtures in `corpus/cases/fixtures/places-details` are **synthetic and labeled**. They follow those shapes. They are not a live Google capture.

Google did **not** ship this as `@googlemaps/google-maps-services-js` 3.4.2 → 4.0.0. The Legacy Node client stayed Legacy; New is `@googlemaps/places`. The corpus still uses that npm crossing as an L1 stand-in so dependency selection fires. A real fork should record the packages it actually switched.

## What to hold constant vs what to vary

| Hold constant | Vary |
|---|---|
| Same `place_id`, same old JSON, same new JSON | How the **app** reads the payload |
| Same Isotope config (provider mock + DB `recordAll`) | Three handlers / three commits of the same slice |
| Same ChangeSpec | Not the entire n8n git history |

Time-traveling a whole product repo mixes unrelated upgrades. Isotope needs one I/O-touching entry point. Slice a Maps call + a persist, then run old vs new **payloads** against each slice.

## Public system (do not PR upstream)

Prefer a **small Maps-specific Node slice**, not the n8n monorepo:

1. **Primary slice:** a community Google Maps / Places n8n node (for example [n8n-nodes-google-maps-platform](https://github.com/AndrewRatnikov/n8n-nodes-google-maps-platform) or a Places v1 community node). These exist because core n8n still has no first-party Maps node; many workflows use HTTP Request instead.
2. **If that slice boots too much framework:** keep the internal specimen `googlemaps-places` and **say it is that pattern** (workflow/node: Place Details in, address field out to the next step / DB).
3. **Do not** use browser-only `google.maps.places.PlacesService`. The TS harness is Node.

Fork privately. No upstream PR.

## The three cases (same fixtures)

All three return a success-shaped handler result on the **Legacy** payload. The New payload is what splits them.

### 1. PASS — already compatible

Handler reads `formattedAddress` (or both paths with a real fallback that still yields the same address string). Observed DB write and return value match old vs new.

- Isotope: **PASS** (`identical_behavior` or only informational `field_added`)
- Story: the API changed; this consumer already migrated. Isotope stays quiet.

Corpus: `googlemaps-places-migrated`. Dual read `formattedAddress ?? result?.formatted_address` so the same Legacy/New fixture pair yields the same stored address.

### 2. Loud error — operators already see it

Handler does `response.data.result.formatted_address` with **no** guard. New payload has no `result`, so the process throws. HTTP/workflow layer fails.

- Isotope: **FAIL**, divergence `threw_new_only` (mechanical / high)
- Story: the update is visible without Isotope. Isotope still records it as incompatibility, not as “could not run.” Harness INDETERMINATE is the wrong outcome here.

Corpus: `googlemaps-places-throw`.

### 3. Silent behavioral change — the reason Isotope exists

Handler still returns `{ ok: true }` / 200. It copies `result?.formatted_address` (or equivalent) into the DB/next node. New payload writes `undefined` / empty address. The interface looks healthy.

- Isotope: **FAIL**, divergence `value_to_missing` (mechanical / critical)
- Story: this is `googlemaps-places`. Repair stays `unsupported` until a later `path_rename` spec; no auto-merge.

## Run

```bash
node packages/cli/dist/bin.js matrix --case googlemaps-places-migrated
node packages/cli/dist/bin.js matrix --case googlemaps-places-throw
node packages/cli/dist/bin.js matrix --case googlemaps-places
```

Optional later: overlay the same fixtures on a private fork of a community Maps node if the entry point is isolatable. Do not PR upstream.

## Out of scope

Browser Maps JS API, hosted Isotope, auto-merge into n8n, claiming corpus addresses are Google-produced, and treating “old n8n vs new n8n” as a Google Maps version pair.
