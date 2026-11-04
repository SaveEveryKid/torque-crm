/**
 * THE PAYMENT WATERMARK ("$100 PER MONTH (WAC) / INBOX BYRON GREEN FOR
 * DETAILS"): the call to action is a Messenger inbox, never a phone call,
 * drawn here for each listing because the amount changes per unit. Same look
 * as the other Marketplace watermarks: slanted white Anton lettering with a
 * black outline, a black mountain range with snowcaps and pines, a blue
 * swoosh under the first line, and a white sticker edge with a thin black
 * rim. Colors are the store logo's: blue #5290C8, black, white.
 */
const BLUE = '#5290c8';
const BLACK = '#000000';
const WHITE = '#fdfdfe';
const SLANT = 0.2;
const SIZE = 260;
const GAP = 70;
const FONT = 'TorqueAnton';

let fontReady: Promise<void> | null = null;
function loadFont(): Promise<void> {
  fontReady =
    fontReady ??
    new FontFace(FONT, 'url(/fonts/anton.woff2)')
      .load()
      .then((f) => void document.fonts.add(f))
      .catch((e) => {
        fontReady = null;
        throw e;
      });
  return fontReady;
}

/** "$100", "$99.50", "$1,250": what you typed, as money. */
export function paymentText(payment: number): string {
  const whole = Math.abs(payment - Math.round(payment)) < 0.005;
  return `$${whole ? Math.round(payment).toLocaleString('en-US') : payment.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const paymentLines = (payment: number, name = 'Byron Green'): [string, string] => [
  `${paymentText(payment)} PER MONTH (WAC)`,
  `INBOX ${name.trim().toUpperCase() || 'ME'} FOR DETAILS`,
];

const canvas = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
};
const ctx2d = (c: HTMLCanvasElement) => c.getContext('2d')!;

/** White letters with a black outline, centred, then slanted like the logo's lettering. */
function textLayer(lines: [string, number][]) {
  const pad = Math.floor(SIZE * 0.35);
  const m = ctx2d(canvas(1, 1));
  const boxes = lines.map(([t, s]) => {
    const px = Math.floor(SIZE * s);
    m.font = `${px}px ${FONT}`;
    const r = m.measureText(t);
    return { t, px, left: r.actualBoundingBoxLeft, w: r.actualBoundingBoxLeft + r.actualBoundingBoxRight, asc: r.actualBoundingBoxAscent, h: r.actualBoundingBoxAscent + r.actualBoundingBoxDescent };
  });
  const w = Math.max(...boxes.map((b) => b.w)) + pad * 2;
  const h = boxes.reduce((a, b) => a + b.h, 0) + GAP * (lines.length - 1) + pad * 2;
  const flat = canvas(w + h * SLANT + pad, h);
  const c = ctx2d(flat);
  c.lineJoin = 'round';
  let y = pad;
  const rows: { top: number; bottom: number }[] = [];
  for (const b of boxes) {
    const x = (w - b.w) / 2 + b.left;
    c.font = `${b.px}px ${FONT}`;
    c.lineWidth = 2 * Math.max(4, Math.floor(b.px * 0.07));
    c.strokeStyle = BLACK;
    c.strokeText(b.t, x, y + b.asc);
    c.fillStyle = WHITE;
    c.fillText(b.t, x, y + b.asc);
    rows.push({ top: y, bottom: y + b.h });
    y += b.h + GAP;
  }
  const out = canvas(flat.width, flat.height);
  const o = ctx2d(out);
  o.setTransform(1, 0, -SLANT, 1, h * SLANT * 0.6, 0);
  o.drawImage(flat, 0, 0);
  return { image: out, rows };
}

/** Black range with white snowcaps and pine trees. */
function mountains(w: number, h: number) {
  const im = canvas(w, h);
  const d = ctx2d(im);
  const base = h;
  const peaks: [number, number][] = [
    [0.18, 0.55],
    [0.32, 0.25],
    [0.46, 0.5],
    [0.58, 0.05],
    [0.72, 0.42],
    [0.84, 0.22],
    [0.96, 0.6],
  ];
  const poly = (pts: [number, number][], fill: string, outline?: string) => {
    d.beginPath();
    pts.forEach(([x, y], i) => (i ? d.lineTo(x, y) : d.moveTo(x, y)));
    d.closePath();
    d.fillStyle = fill;
    d.fill();
    if (outline) {
      d.strokeStyle = outline;
      d.lineWidth = 1;
      d.stroke();
    }
  };
  poly([[w * 0.04, base], ...peaks.map(([x, y]): [number, number] => [w * x, h * y]), [w * 0.99, base]], BLACK, WHITE);
  for (const [x, y] of peaks) {
    if (y > 0.45) continue;
    const px = w * x;
    const py = h * y;
    const cap = h * 0.22;
    poly(
      [
        [px, py],
        [px - cap * 0.75, py + cap],
        [px - cap * 0.25, py + cap * 0.7],
        [px, py + cap * 0.95],
        [px + cap * 0.3, py + cap * 0.65],
        [px + cap * 0.7, py + cap],
      ],
      WHITE,
    );
  }
  for (const [tx, th] of [
    [0.1, 0.62],
    [0.16, 0.8],
    [0.88, 0.75],
    [0.94, 0.58],
  ]) {
    const cx = w * tx;
    const top = h * (1 - th);
    const tw = h * th * 0.42;
    for (let k = 0; k < 4; k++) {
      const y0 = top + (base - top) * k * 0.2;
      const y1 = top + (base - top) * (0.35 + k * 0.2);
      const hw = tw * (0.4 + k * 0.2);
      poly(
        [
          [cx, y0],
          [cx - hw, y1],
          [cx + hw, y1],
        ],
        BLACK,
      );
    }
  }
  return im;
}

function swoosh(w: number, h: number) {
  const im = canvas(w, h);
  const d = ctx2d(im);
  d.beginPath();
  d.moveTo(w * 0.04, h);
  d.lineTo(w * 0.06, h * 0.2);
  d.lineTo(w, 0);
  d.lineTo(w * 0.95, h * 0.75);
  d.closePath();
  d.fillStyle = BLUE;
  d.fill();
  d.strokeStyle = BLACK;
  d.lineWidth = Math.max(2, Math.floor(h / 6));
  d.lineJoin = 'miter';
  d.stroke();
  return im;
}

/** The shape grown by r pixels, in one color (the sticker edge). */
function grown(src: HTMLCanvasElement, r: number, color: string) {
  const solid = canvas(src.width, src.height);
  const s = ctx2d(solid);
  s.drawImage(src, 0, 0);
  // Pixels that count as "the mark" (like the >30 alpha cut), in the edge color.
  const data = s.getImageData(0, 0, solid.width, solid.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const on = px[i + 3] > 30;
    px[i + 3] = on ? 255 : 0;
  }
  s.putImageData(data, 0, 0);
  s.globalCompositeOperation = 'source-in';
  s.fillStyle = color;
  s.fillRect(0, 0, solid.width, solid.height);
  const out = canvas(src.width, src.height);
  const o = ctx2d(out);
  for (const rad of [r, r * 0.66, r * 0.33]) {
    const n = Math.max(16, Math.ceil(rad * 2));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      o.drawImage(solid, Math.round(Math.cos(a) * rad), Math.round(Math.sin(a) * rad));
    }
  }
  o.drawImage(solid, 0, 0);
  return out;
}

function cropToContent(c: HTMLCanvasElement) {
  const { data, width, height } = ctx2d(c).getImageData(0, 0, c.width, c.height);
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4 + 3]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return c;
  const out = canvas(x1 - x0 + 1, y1 - y0 + 1);
  ctx2d(out).drawImage(c, -x0, -y0);
  return out;
}

/** The payment watermark as a PNG data URL (transparent background). */
export async function paymentMark(payment: number, name?: string): Promise<string> {
  await loadFont();
  const [first, second] = paymentLines(payment, name);
  const { image: txt, rows } = textLayer([
    [first, 1.0],
    [second, 0.7],
  ]);
  const W = txt.width;
  const mh = Math.floor(SIZE * 0.85);
  const edge = Math.max(6, Math.floor(SIZE / 18));
  const margin = edge + 6;
  const art = canvas(W + 60 + margin * 2, txt.height + mh + margin * 2);
  const a = ctx2d(art);
  a.translate(margin, margin);
  a.drawImage(mountains(Math.floor(W * 0.92), mh + Math.floor(SIZE * 0.35)), Math.floor(W * 0.06), 0);
  const textY = mh - Math.floor(SIZE * 0.2);
  a.drawImage(txt, 30, textY);
  a.drawImage(swoosh(Math.floor(W * 0.86), Math.floor(SIZE * 0.22)), Math.floor(W * 0.1), textY + rows[0].bottom + Math.floor(GAP * 0.15));
  a.drawImage(txt, 30, textY); // letters stay on top
  a.setTransform(1, 0, 0, 1, 0, 0);
  // White sticker edge around everything, then a thin black rim.
  const out = canvas(art.width, art.height);
  const o = ctx2d(out);
  o.drawImage(grown(art, edge + 2, BLACK), 0, 0);
  o.drawImage(grown(art, edge, WHITE), 0, 0);
  o.drawImage(art, 0, 0);
  // About 1400 px wide is plenty (it's drawn at a third of a 2048 px photo).
  const full = cropToContent(out);
  const scale = Math.min(1, 1400 / full.width);
  const small = canvas(full.width * scale, full.height * scale);
  const sc = ctx2d(small);
  sc.imageSmoothingQuality = 'high';
  sc.drawImage(full, 0, 0, small.width, small.height);
  return small.toDataURL('image/png');
}
