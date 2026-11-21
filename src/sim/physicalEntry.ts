// Safe entry into `Physical collision` (spec `Safe Entry Into Physical
// Collision`). Rapier solves every overlapping particle pair in one
// uninterruptible step, and a packed crowd (easy to make in `Independent
// overlap`) froze the page for seconds to minutes. Before Rapier takes over,
// the TS engine pushes overlapping particles apart over a few frames, and
// dots covered by others in the heap rest (not simulated, not drawn) until
// the physics time limit leaves room for them to flow out. Pure code, no Rapier.

// Named knobs. Each one shapes one part of the entry.
// Grid estimate (see `overlapEstimate`) above which the crowd is spread
// before Rapier takes over: the larger of a floor and a share per dot.
// Measured (2026-11-20): Rapier's own packed crowds stay at about 1.9 per dot
// (bench E, 2000 dots: 3822); crowds packed by `Independent overlap` reach
// 5 to 20 per dot and cost Rapier 0.16 s to 71 s in one step.
export const PHYSICAL_ENTRY_PAIR_BUDGET = 3000;
export const PHYSICAL_ENTRY_PAIRS_PER_DOT = 2.5;
// The spread hands over to Rapier once the estimate is below this share of
// the budget. At 0.6, Rapier's first step on F34 at 10000 dots (Gravity 3)
// took 0.6 s; at 0.3 it took 0.14 s, the same as the first step of a fresh
// 10000-dot world that needed no spread.
export const PHYSICAL_ENTRY_HANDOVER = 0.3;
// Frames the spread may take; after that every dot that still overlaps a
// dot drawn above it rests, so Rapier never receives a packed crowd.
export const PHYSICAL_ENTRY_MAX_FRAMES = 45;
// Time (ms) the spread may use per frame; one pass always runs.
export const PHYSICAL_ENTRY_FRAME_MS = 6;
// A dot is covered when its centre is closer than this share of a diameter
// to a dot drawn above it (higher ID). Covered dots in a heap rest.
export const PHYSICAL_REST_COVER = 0.8;
// Physics time limit: the Rapier step time (ms, smoothed) above which
// covered dots rest. It follows from a target frame rate (setting
// `physicalTargetFps`, `?physfps=`; a goal, not a guarantee) and the share
// of that frame Rapier may use; the rest of the frame is left for the
// other work (contacts, sound, drawing). Measured, so a slower device rests
// more.
export const PHYSICAL_TARGET_FPS = 60;
export const PHYSICAL_FRAME_SHARE = 0.75;
// Resting dots flow out while the step time is below this share of the
// limit; between it and the limit nothing changes.
export const PHYSICAL_FLOW_HEADROOM = 0.7;
// Resting dots released per step at most during the flow-out.
export const PHYSICAL_FLOW_PER_STEP = 24;
// A pair counts as deep when its centres are closer than this share of a
// diameter (reported by a pass, for tests and probes).
const DEEP_DISTANCE = 0.8;
// Share of an overlap a pass corrects (both particles together).
const RELAX = 0.8;
// Directions for pairs at the same point, spread by the golden angle.
const GOLDEN_ANGLE = 2.399963229728653;

// Legacy entry (`?entry=held`, the 2026-11-20 version, kept for comparison):
// a crowd that needs a spread keeps at most this fill (dot areas added up,
// over the field area); the dots past it, highest IDs first, are held off
// the field, and the spread hands over after `PHYSICAL_ENTRY_MAX_FRAMES`
// whatever it reached.
export const PHYSICAL_FILL_LIMIT = 1.5;

// Physics time limit (ms) for a target frame rate.
export function physicalTimeLimitMs(targetFps: number) {
  const fps = Number.isFinite(targetFps) && targetFps > 0 ? targetFps : PHYSICAL_TARGET_FPS;
  return (1000 / fps) * PHYSICAL_FRAME_SHARE;
}

export function physicalCapacity(width: number, height: number, radius: number) {
  const area = Math.PI * radius * radius;
  if (!(area > 0)) {
    return Number.MAX_SAFE_INTEGER;
  }
  return Math.max(1, Math.floor((PHYSICAL_FILL_LIMIT * Math.max(width, 0) * Math.max(height, 0)) / area));
}

// Grid estimate a crowd of `count` dots may have when Rapier receives it.
export function physicalEntryBudget(count: number) {
  return Math.max(PHYSICAL_ENTRY_PAIR_BUDGET, count * PHYSICAL_ENTRY_PAIRS_PER_DOT);
}

// True when Rapier must not receive the crowd as it is.
export function needsPhysicalSpread(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  count: number,
  radius: number,
) {
  return overlapEstimate(x, y, count, radius) > physicalEntryBudget(count);
}

// Cheap measure of how packed the crowd is: the particles go into square
// cells of one diameter, and the estimate sums n(n-1)/2 over the cells. It
// follows the true number of overlapping pairs at about half its value, in
// one pass over the particles.
export function overlapEstimate(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  count: number,
  radius: number,
) {
  const cell = Math.max(radius * 2, 1e-6);
  const cells = new Map<number, number>();
  let estimate = 0;
  for (let index = 0; index < count; index += 1) {
    const cx = Math.floor(x[index] / cell);
    const cy = Math.floor(y[index] / cell);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) {
      continue;
    }
    const key = cx * 1_000_003 + cy;
    const n = cells.get(key) ?? 0;
    // Adding the (n+1)th particle to a cell adds n new pairs.
    estimate += n;
    cells.set(key, n + 1);
  }
  return estimate;
}

// Covered dots, found from the top of the drawing order down: a dot is
// covered when its centre is closer than `cover` (a share of a diameter) to
// a dot above it that is itself not covered. Returns, per index, the index
// of the covering dot (the host), or -1. `rank` is the drawing order (the
// dot ID); higher is drawn above. At most `limit` dots are marked; the
// search goes from the top, so the dots marked first lie under the most
// visible ones.
export function findCoveredDots(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  rank: ArrayLike<number>,
  count: number,
  radius: number,
  cover = PHYSICAL_REST_COVER,
  limit = Number.MAX_SAFE_INTEGER,
) {
  const host = new Int32Array(count).fill(-1);
  if (count <= 1 || !(radius > 0) || limit <= 0) {
    return host;
  }
  const reach = radius * 2 * cover;
  const reachSq = reach * reach;
  const cell = Math.max(reach, 1e-6);
  const order = Array.from({ length: count }, (_, index) => index).sort((a, b) => rank[b] - rank[a]);
  // Kept dots per cell, as linked lists through `next`.
  const heads = new Map<number, number>();
  const next = new Int32Array(count).fill(-1);
  let marked = 0;
  for (const index of order) {
    const px = x[index];
    const py = y[index];
    const cx = Math.floor(px / cell);
    const cy = Math.floor(py / cell);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) {
      continue;
    }
    if (marked < limit) {
      let best = -1;
      let bestSq = reachSq;
      for (let ny = cy - 1; ny <= cy + 1; ny += 1) {
        for (let nx = cx - 1; nx <= cx + 1; nx += 1) {
          for (let other = heads.get(nx * 1_000_003 + ny) ?? -1; other >= 0; other = next[other]) {
            const dx = x[other] - px;
            const dy = y[other] - py;
            const distSq = dx * dx + dy * dy;
            if (distSq < bestSq) {
              bestSq = distSq;
              best = other;
            }
          }
        }
      }
      if (best >= 0) {
        host[index] = best;
        marked += 1;
        continue;
      }
    }
    const key = cx * 1_000_003 + cy;
    next[index] = heads.get(key) ?? -1;
    heads.set(key, index);
  }
  return host;
}

// Finds free spots for dots that flow out of a heap: the nearest spot to a
// given point with no dot within a diameter, outside the Ball and inside the
// walls. Spots are cell centres on a grid of one diameter, searched ring by
// ring outward. A spot handed out counts as taken for later searches.
export class FreeSpotFinder {
  private readonly cell: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly heads: Int32Array;
  private next: Int32Array;
  private xs: Float64Array;
  private ys: Float64Array;
  private size = 0;

  constructor(
    x: ArrayLike<number>,
    y: ArrayLike<number>,
    count: number,
    private readonly radius: number,
    private readonly width: number,
    private readonly height: number,
    private readonly ball: { x: number; y: number; radius: number } | null = null,
  ) {
    this.cell = Math.max(radius * 2, 1e-6);
    this.cols = Math.max(1, Math.ceil(width / this.cell));
    this.rows = Math.max(1, Math.ceil(height / this.cell));
    this.heads = new Int32Array(this.cols * this.rows).fill(-1);
    this.next = new Int32Array(count + 16);
    this.xs = new Float64Array(count + 16);
    this.ys = new Float64Array(count + 16);
    for (let index = 0; index < count; index += 1) {
      this.add(x[index], y[index]);
    }
  }

  // The nearest free spot to (x, y), or null when the field has none.
  find(x: number, y: number) {
    const cx = clampIndex(Math.floor(x / this.cell), this.cols);
    const cy = clampIndex(Math.floor(y / this.cell), this.rows);
    const maxRing = Math.max(this.cols, this.rows);
    for (let ring = 0; ring <= maxRing; ring += 1) {
      let bestX = 0;
      let bestY = 0;
      let bestSq = Infinity;
      for (let ny = cy - ring; ny <= cy + ring; ny += 1) {
        if (ny < 0 || ny >= this.rows) {
          continue;
        }
        // Inner rows of a ring hold only its left and right cells.
        const edge = ring === 0 || ny === cy - ring || ny === cy + ring;
        const stride = edge ? 1 : ring * 2;
        for (let nx = cx - ring; nx <= cx + ring; nx += stride) {
          if (nx < 0 || nx >= this.cols) {
            continue;
          }
          const sx = (nx + 0.5) * this.cell;
          const sy = (ny + 0.5) * this.cell;
          const distSq = (sx - x) ** 2 + (sy - y) ** 2;
          if (distSq < bestSq && this.isFree(sx, sy)) {
            bestSq = distSq;
            bestX = sx;
            bestY = sy;
          }
        }
      }
      if (bestSq < Infinity) {
        this.add(bestX, bestY);
        return { x: bestX, y: bestY };
      }
    }
    return null;
  }

  private isFree(sx: number, sy: number) {
    const r = this.radius;
    if (sx < r || sy < r || sx > this.width - r || sy > this.height - r) {
      return false;
    }
    const ball = this.ball;
    if (ball && (sx - ball.x) ** 2 + (sy - ball.y) ** 2 < (ball.radius + r) ** 2) {
      return false;
    }
    const minSq = this.cell * this.cell;
    const cx = Math.floor(sx / this.cell);
    const cy = Math.floor(sy / this.cell);
    for (let ny = Math.max(cy - 1, 0); ny <= Math.min(cy + 1, this.rows - 1); ny += 1) {
      for (let nx = Math.max(cx - 1, 0); nx <= Math.min(cx + 1, this.cols - 1); nx += 1) {
        for (let other = this.heads[nx + ny * this.cols]; other >= 0; other = this.next[other]) {
          if ((this.xs[other] - sx) ** 2 + (this.ys[other] - sy) ** 2 < minSq) {
            return false;
          }
        }
      }
    }
    return true;
  }

  private add(x: number, y: number) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return;
    }
    if (this.size >= this.xs.length) {
      const xs = new Float64Array(this.xs.length * 2);
      const ys = new Float64Array(this.ys.length * 2);
      const next = new Int32Array(this.next.length * 2);
      xs.set(this.xs);
      ys.set(this.ys);
      next.set(this.next);
      this.xs = xs;
      this.ys = ys;
      this.next = next;
    }
    const id = clampIndex(Math.floor(x / this.cell), this.cols)
      + clampIndex(Math.floor(y / this.cell), this.rows) * this.cols;
    this.xs[this.size] = x;
    this.ys[this.size] = y;
    this.next[this.size] = this.heads[id];
    this.heads[id] = this.size;
    this.size += 1;
  }
}

// Pushes overlapping particles apart. With velocities given, each pushed
// pair also loses its closing speed along the push, as a contact with no
// bounce would; this never adds energy, and no sound is made. Without it, a
// crowd held by Gravity reaches Rapier still rushing inward. Buffers are
// kept between passes.
export class OverlapSeparator {
  private cellStart = new Int32Array(0);
  private cellFill = new Int32Array(0);
  private order = new Int32Array(0);
  private cellOf = new Int32Array(0);

  // One pass over every overlapping pair; returns the deep pairs found.
  pass(
    x: Float64Array,
    y: Float64Array,
    count: number,
    radius: number,
    width: number,
    height: number,
    vx?: Float64Array,
    vy?: Float64Array,
  ) {
    if (count <= 1 || !(radius > 0)) {
      return 0;
    }
    const diameter = radius * 2;
    const cell = diameter;
    const cols = Math.max(1, Math.ceil(width / cell));
    const rows = Math.max(1, Math.ceil(height / cell));
    const cellCount = cols * rows;
    if (this.cellStart.length < cellCount + 1) {
      this.cellStart = new Int32Array(cellCount + 1);
      this.cellFill = new Int32Array(cellCount);
    } else {
      this.cellStart.fill(0, 0, cellCount + 1);
    }
    if (this.order.length < count) {
      this.order = new Int32Array(count);
      this.cellOf = new Int32Array(count);
    }

    // Counting sort of the particles by cell.
    for (let index = 0; index < count; index += 1) {
      const cx = clampIndex(Math.floor(x[index] / cell), cols);
      const cy = clampIndex(Math.floor(y[index] / cell), rows);
      const id = cx + cy * cols;
      this.cellOf[index] = id;
      this.cellStart[id + 1] += 1;
    }
    for (let id = 0; id < cellCount; id += 1) {
      this.cellStart[id + 1] += this.cellStart[id];
    }
    this.cellFill.set(this.cellStart.subarray(0, cellCount));
    for (let index = 0; index < count; index += 1) {
      const id = this.cellOf[index];
      this.order[this.cellFill[id]] = index;
      this.cellFill[id] += 1;
    }

    const minSq = diameter * diameter;
    const deepSq = (diameter * DEEP_DISTANCE) ** 2;
    let deep = 0;
    for (let i = 0; i < count; i += 1) {
      const id = this.cellOf[i];
      const cx = id % cols;
      const cy = (id - cx) / cols;
      for (let ny = Math.max(cy - 1, 0); ny <= Math.min(cy + 1, rows - 1); ny += 1) {
        for (let nx = Math.max(cx - 1, 0); nx <= Math.min(cx + 1, cols - 1); nx += 1) {
          const other = nx + ny * cols;
          const end = this.cellStart[other + 1];
          for (let slot = this.cellStart[other]; slot < end; slot += 1) {
            const j = this.order[slot];
            if (j <= i) {
              continue;
            }
            let dx = x[j] - x[i];
            let dy = y[j] - y[i];
            const distSq = dx * dx + dy * dy;
            if (distSq >= minSq) {
              continue;
            }
            if (distSq < deepSq) {
              deep += 1;
            }
            const dist = Math.sqrt(distSq);
            if (dist < 1e-6) {
              const angle = (i + j * 7) * GOLDEN_ANGLE;
              dx = Math.cos(angle);
              dy = Math.sin(angle);
            } else {
              dx /= dist;
              dy /= dist;
            }
            const push = (diameter - dist) * RELAX * 0.5;
            x[i] -= dx * push;
            y[i] -= dy * push;
            x[j] += dx * push;
            y[j] += dy * push;
            if (vx && vy) {
              // Equal masses: each side takes half of the closing speed.
              const closing = (vx[j] - vx[i]) * dx + (vy[j] - vy[i]) * dy;
              if (closing < 0) {
                const half = closing * 0.5;
                vx[i] += dx * half;
                vy[i] += dy * half;
                vx[j] -= dx * half;
                vy[j] -= dy * half;
              }
            }
          }
        }
      }
    }

    for (let index = 0; index < count; index += 1) {
      x[index] = Math.min(Math.max(x[index], radius), Math.max(width - radius, radius));
      y[index] = Math.min(Math.max(y[index], radius), Math.max(height - radius, radius));
    }
    return deep;
  }
}

function clampIndex(value: number, size: number) {
  if (!(value > 0)) {
    return 0;
  }
  return value >= size ? size - 1 : value;
}
