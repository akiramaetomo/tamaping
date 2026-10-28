# tamaping

[日本語版 README](README.ja.md)

**Flick the particles. Let the sound unwind. Let your mind soften.**

tamaping is a small particle-and-sound playground for the browser.

Particles drift, collide, gather, scatter, glow, and sometimes arrange
themselves into words. You do not play it by clearing a stage or chasing a
score. You play it by touching motion, listening to collisions, and discovering
which preset starts to feel alive in your hands.

Open tamaping:

https://akiramaetomo.github.io/tamaping/

## Purpose

tamaping exists to turn the simple pleasure of flicking particles into a small
moment of comfort, immersion, and surprise.

The app starts from very plain ingredients: particles, a ball, collisions,
gravity, color, and short sounds. But when many small reactions overlap, they
can turn into rhythms, noise, swarms, waves, sparks, and little accidents that
feel more expressive than the rules that made them.

The purpose is not to explain physics perfectly. It is to give you a place to
touch a simple system, listen to it loosen into sound, and find your own
favorite moments inside it.

## A Particle Instrument

tamaping sits somewhere between a screen toy, a sound effect machine, a physics
sketchbook, and a tiny visual instrument.

The large ball is your hand inside the world. Push it through the particles,
tap it into a dense field, or flick it across the screen. The particles answer
with motion and sound. A quiet preset can become percussive. A dense preset can
turn into a storm. A simple setting can suddenly behave like a living thread.

There is no correct way to use it. The point is to try a mood, disturb it, and
watch what the system gives back.

## Start Here

1. Open the app.
2. Tap or click once so the browser can unlock sound.
3. Choose a preset from the Settings panel.
4. Drag or flick the ball.
5. Switch presets and compare how the same gesture feels different.

For casual viewing, keep Settings in `Small` mode. It leaves more of the scene
visible while you move through presets.

## Presets

The preset selector uses compact labels:

- `F01`, `F02`, ... are built-in factory presets.
- `U01`, `U02`, ... are your own user preset slots.

Factory presets are read-only starting points. They are arranged as a small
gallery of motion and sound ideas:

- bright particle clouds
- dense gravitational fields
- percussive ball-and-particle scenes
- snake-like linking experiments
- name and flash formations
- noisy effects and softer viewing presets

Some factory presets begin with an authored formation:

- `Flash`: starts from a spiral-like particle arrangement.
- `Name`: starts from text made of particles.
- Random start: begins from the normal scattered field.

These starting moments are part of the preset's personality. If the Settings
panel is hiding too much of the screen, switch it to `Small` or close it.

## Controls

### Ball

The large ball is the main control.

- Desktop: move it with a mouse or pointer.
- Smartphone: touch and drag it with your finger.
- Flicking quickly can make impacts sharper and sounds stronger.

### Settings Size

The Settings panel has three sizes:

- `Small`: best for browsing presets while still watching the scene.
- `Medium`: a half-height editing view.
- `Large`: full editing view for deeper tuning.

## Sound

tamaping uses Web Audio. Most browsers require a user gesture before sound can
start, so tap or click inside the app first.

If you do not hear sound:

- Check the device volume.
- Check that the browser tab is not muted.
- Tap or click inside the app once.
- Check browser audio/autoplay permissions.
- On older phones, try another browser.

The sound is intentionally part of the experiment. Some presets are clean and
percussive; others are noisy, unstable, or strange when collisions overlap.

## User Presets

You can save your own settings into user preset slots.

User presets are stored in your browser's local storage:

- They stay on the same device and browser.
- They can disappear if you clear site data.
- They are not uploaded to a server.
- They are not shared between devices automatically.

## Screen Size: Fit and 1:1

The button left of the gear sets how screen size is handled.

- `Fit` (default): the view and the motion are scaled to the screen the
  preset was made on. A preset made on a phone fills a desktop screen the
  same way and moves at the same speed relative to the screen. The button
  shows the scale factor.
- `1:1`: screen pixels are used as they are. A large screen gives more room,
  so balls look smaller and calmer. This is part of exploring the same system
  at different scales.

Settings values always show the preset's own numbers in both modes. Saving a
preset also records the size of the screen it was made on.

## Privacy

tamaping is a static browser app.

- No account is required.
- No analytics are included.
- User presets are stored locally in the browser.

## Recommended Environment

Recent desktop and mobile browsers are recommended.

The app uses a rendering library, physics simulation, and Web Audio. Very old
devices may still open it, but dense presets, high particle counts, or browser
audio behavior may be limited.

## Development

tamaping is the public Web version of dotping.

For normal use, the Pages link above is the intended entry point.
