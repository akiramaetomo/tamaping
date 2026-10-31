import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FrameProfiler,
  PERF_PHASES,
  measurePhase,
  phaseStats,
} from '../.test-build/app/frameProfiler.js';

test('phase stats use nearest-rank p95 and handle empty input', () => {
  assert.deepEqual(phaseStats([]), { avg: 0, p95: 0, max: 0 });
  assert.deepEqual(phaseStats([4]), { avg: 4, p95: 4, max: 4 });

  const values = Array.from({ length: 100 }, (_, index) => index + 1);
  const stats = phaseStats(values.reverse());
  assert.equal(stats.avg, 50.5);
  assert.equal(stats.p95, 95);
  assert.equal(stats.max, 100);
});

test('profiler publishes nothing until the window has elapsed', () => {
  const profiler = new FrameProfiler(1000);
  profiler.record('interval', 16);
  profiler.endFrame(0, 1);
  profiler.record('interval', 16);
  profiler.endFrame(500, 1);
  assert.equal(profiler.summary, null);
  assert.equal(profiler.summaryVersion, 0);
});

test('profiler sums repeated phases within a frame and summarizes the window', () => {
  const profiler = new FrameProfiler(1000);
  for (let frame = 0; frame <= 10; frame += 1) {
    const steps = frame === 5 ? 3 : 1;
    profiler.record('interval', frame === 5 ? 50 : 16);
    for (let step = 0; step < steps; step += 1) {
      profiler.record('worldStep', 2);
    }
    profiler.endFrame(frame * 100, steps);
  }

  const summary = profiler.summary;
  assert.ok(summary);
  assert.equal(profiler.summaryVersion, 1);
  assert.equal(summary.windowMs, 1000);
  assert.equal(summary.frames, 11);
  assert.equal(summary.fps, 11);
  assert.equal(summary.framesOver20Ms, 1);
  assert.equal(summary.framesOver33Ms, 1);
  assert.equal(summary.stepsMax, 3);
  assert.equal(summary.phases.worldStep.max, 6);
  assert.equal(summary.phases.audio.max, 0);
  assert.deepEqual(Object.keys(summary.phases), [...PERF_PHASES]);
});

test('profiler reset drops the open window and the published summary', () => {
  const profiler = new FrameProfiler(10);
  profiler.endFrame(0, 1);
  profiler.endFrame(20, 1);
  assert.ok(profiler.summary);
  profiler.reset();
  assert.equal(profiler.summary, null);
});

test('measurePhase runs without timing when no profiler is active', () => {
  assert.equal(measurePhase(null, 'build', () => 7), 7);

  const profiler = new FrameProfiler(0);
  assert.equal(measurePhase(profiler, 'build', () => 'ok'), 'ok');
  profiler.endFrame(0, 0);
  assert.ok(profiler.summary.phases.build.max >= 0);
});
