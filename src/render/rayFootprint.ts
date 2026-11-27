// The Rays X (fxTextures.ts) and the outline that covers it, for drawing it
// with a mesh instead of a square sprite (rayMesh.ts).
//
// Lengths are in flare radii: 1 is the distance from the centre to a spike
// tip, which is half the side of the square sprite (RAY_TEXTURE_RADIUS
// texels). Texture coordinates follow positions: u = (x + 1) / 2,
// v = (y + 1) / 2, so a pixel the outline covers samples the texture
// exactly where the square sprite would.

// Radius of the soft core under the spikes.
export const RAY_CORE_RADIUS = 0.42;
// Half-length of a spike (its tip) and half its width at the middle. The
// spikes run along the diagonals of the square, at 45 + 90k degrees.
export const RAY_SPIKE_HALF_LENGTH = 1;
export const RAY_SPIKE_HALF_WIDTH = 0.1;
// The outline may grow by up to this much before a tip's corner reaches the
// square's edge ((tip + h) / sqrt(2) = 1 with both grown by m); it is never
// larger than the square sprite.
export const RAY_FOOTPRINT_MAX_MARGIN = (Math.SQRT2 - RAY_SPIKE_HALF_LENGTH - RAY_SPIKE_HALF_WIDTH) / 2;

export const RAY_FOOTPRINT_VERTICES = 16;

// Outline: per spike tip k (at angle 45 + 90k degrees), four corners in the
// tip's own frame (x along the spike): (inner, -h), (tip, -h), (tip, h),
// (inner, h). `h` is the spike's half-width and `inner` is where the
// spike's edge meets an octagon around the core; the octagon's edge
// between two spikes runs at the core's radius from the centre, so the
// core fits inside. Every corner moves linearly with the margin m, so each
// is a base point (m = 0) plus m times a grow vector.
export function rayFootprintTemplate() {
  const base = new Float32Array(RAY_FOOTPRINT_VERTICES * 2);
  const grow = new Float32Array(RAY_FOOTPRINT_VERTICES * 2);
  // h = h0 + m; tip = t0 + m; inner = sqrt(2) * (core + m) - h.
  const h0 = RAY_SPIKE_HALF_WIDTH;
  const t0 = RAY_SPIKE_HALF_LENGTH;
  const inner0 = Math.SQRT2 * RAY_CORE_RADIUS - h0;
  const innerGrow = Math.SQRT2 - 1;
  const corners: [number, number, number, number][] = [
    // x, y at m = 0, then dx, dy per unit of m.
    [inner0, -h0, innerGrow, -1],
    [t0, -h0, 1, -1],
    [t0, h0, 1, 1],
    [inner0, h0, innerGrow, 1],
  ];
  for (let tip = 0; tip < 4; tip += 1) {
    const angle = Math.PI / 4 + (tip * Math.PI) / 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    corners.forEach(([x, y, dx, dy], corner) => {
      const offset = (tip * 4 + corner) * 2;
      base[offset] = x * cos - y * sin;
      base[offset + 1] = x * sin + y * cos;
      grow[offset] = dx * cos - dy * sin;
      grow[offset + 1] = dx * sin + dy * cos;
    });
  }
  return { base, grow, indices: rayFootprintIndices() };
}

// Two triangles per spike, and a fan over the octagon (corners 0 and 3 of
// each spike). No triangle overlaps another, so with additive blending no
// pixel is drawn twice.
export function rayFootprintIndices() {
  const indices: number[] = [];
  for (let tip = 0; tip < 4; tip += 1) {
    const a = tip * 4;
    indices.push(a, a + 1, a + 2, a, a + 2, a + 3);
  }
  const octagon = [0, 3, 4, 7, 8, 11, 12, 15];
  for (let index = 1; index < octagon.length - 1; index += 1) {
    indices.push(octagon[0], octagon[index], octagon[index + 1]);
  }
  return new Uint16Array(indices);
}

// The outline at margin m, as [x, y] corners in drawing order.
export function rayFootprintOutline(margin: number) {
  const { base, grow } = rayFootprintTemplate();
  const m = clampMargin(margin);
  const points: [number, number][] = [];
  for (let index = 0; index < RAY_FOOTPRINT_VERTICES; index += 1) {
    points.push([base[index * 2] + grow[index * 2] * m, base[index * 2 + 1] + grow[index * 2 + 1] * m]);
  }
  return points;
}

// Share of the square sprite's area that the outline covers at margin m.
export function rayFootprintShare(margin: number) {
  const points = rayFootprintOutline(margin);
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x0, y0] = points[index];
    const [x1, y1] = points[(index + 1) % points.length];
    twiceArea += x0 * y1 - x1 * y0;
  }
  return Math.abs(twiceArea) / 2 / 4;
}

// Margin in flare radii for a margin of `marginPx` device pixels on a ray
// whose flare radius is `radiusPx` device pixels.
export function rayFootprintMargin(marginPx: number, radiusPx: number) {
  return radiusPx > 0 ? clampMargin(marginPx / radiusPx) : RAY_FOOTPRINT_MAX_MARGIN;
}

function clampMargin(margin: number) {
  return Number.isFinite(margin) ? Math.min(Math.max(margin, 0), RAY_FOOTPRINT_MAX_MARGIN) : 0;
}
