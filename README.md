# Incident Light Meter

Type in the lux reading from a handheld incident meter and get the settings to
dial into a Fujifilm X-T3. A static page: no server, no network, installable to
a home screen and fully usable in the field with no signal.

## The idea

An incident meter measures the light falling on the subject. ISO 2720 relates
that illuminance to the exposure settings by

```
N² / t = E · S / C
```

where `N` is the f-number, `t` the shutter time in seconds, `E` the illuminance
in lux, `S` the ISO speed, and `C` the meter calibration constant. Take log2 of
both sides and the reading collapses to a single exposure value:

```
EV = log2(E · S / C)
```

Every valid combination of settings hits that same EV. So the app computes EV
once, solves for whichever of the three settings you have not fixed, and shows
the whole row of equivalent exposures alongside it — the same thing the rotating
dial on a Sekonic does.

## Calibration matters

`C` is the usual reason an app and a real meter disagree by a third of a stop.
ISO 2720 permits 250 for a flat receptor and 320 for a hemispherical dome;
Sekonic calibrates to about 340, which is the default here. Set it under **Setup**
to match the meter you actually carry and the two will agree from then on.

## What it knows about the camera

Only settings the X-T3 can actually be set to are ever recommended: mechanical
shutter to 1/8000 (1/32000 with the electronic shutter on), 4s in P/A/S and 15
minutes in M/T, native ISO 160–12800 with the extended range behind a toggle,
and third-stop scales throughout. Aperture range follows the selected lens.

The scales hold the *nominal* values the camera displays rather than exact powers
of two — 1/8000 where the exact third-stop value is 1/8192, f/11 where it is
11.31. Each label sits within about a twentieth of a stop of the true grid, and
every number the app prints is one you can dial in.

When the answer falls off the end of what the camera can do, it says so and
suggests the fix — an ND of roughly the right density, a wider lens, a tripod.

## Running it

```bash
npm install
npm run dev
```

```bash
npm test
```

```bash
npm run build
```

The build typechecks, draws the PWA icons, bundles to `dist/`, and emits a
service worker whose precache list is the real set of built files.

## Deploying

Vercel, as a static site — `vercel.json` sets the build command and output
directory, so importing the repository is enough. There is no server component
and nothing to configure.

## Layout

```
src/exposure/    the maths: scales, camera limits, the solver, the advice
src/ui/          the gauge and the dial control
src/main.ts      state, wiring, rendering
tests/           the maths under test, including sunny 16 and the range limits
```

`src/exposure/` has no DOM dependency, which is why it is the part with tests.
