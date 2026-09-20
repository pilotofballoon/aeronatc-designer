// Фон сцены: небо с кучевыми облаками и земля с полями.
// Рисуется один раз на канвасе и отдаётся как картинка — и в CSS-фон сцены,
// и под кадр при выгрузке PNG, чтобы экран и файл совпадали.

const W = 1800;
const H = 1150;
const HORIZON = 0.72;      // доля высоты, на которой проходит линия горизонта

let cached = null;

function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

// Мягкое пятно с плавным краем — кирпичик и облаков, и дымки.
function blob(g, x, y, r, color, alpha) {
  const rg = g.createRadialGradient(x, y, r * 0.15, x, y, r);
  rg.addColorStop(0, `rgba(${color},${alpha})`);
  rg.addColorStop(0.6, `rgba(${color},${alpha * 0.55})`);
  rg.addColorStop(1, `rgba(${color},0)`);
  g.fillStyle = rg;
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
}

/**
 * Кучевое облако: плоское снизу, рыхлое сверху. Сначала кладём серое
 * основание со сдвигом вниз, потом белые купола — так появляется объём.
 */
function cumulus(g, cx, cy, scale, rnd, fade) {
  const lobes = 7 + Math.floor(rnd() * 6);
  const pts = [];
  for (let i = 0; i < lobes; i++) {
    const t = i / (lobes - 1) - 0.5;
    const r = scale * (0.42 + rnd() * 0.5) * (1 - Math.abs(t) * 0.55);
    pts.push({
      x: cx + t * scale * 2.5 + (rnd() - 0.5) * scale * 0.3,
      y: cy - Math.pow(1 - Math.abs(t * 2), 1.6) * scale * 0.55 + (rnd() - 0.5) * scale * 0.18,
      r,
    });
  }
  // тень снизу
  for (const p of pts) blob(g, p.x, p.y + p.r * 0.34, p.r * 0.95, '150,166,184', 0.30 * fade);
  // плоское основание
  g.save();
  g.beginPath();
  g.ellipse(cx, cy + scale * 0.22, scale * 1.55, scale * 0.3, 0, 0, Math.PI * 2);
  g.fillStyle = `rgba(168,183,199,${0.34 * fade})`;
  g.fill();
  g.restore();
  // освещённые купола
  for (const p of pts) blob(g, p.x, p.y, p.r, '255,255,255', 0.5 * fade);
  for (const p of pts) blob(g, p.x, p.y - p.r * 0.22, p.r * 0.62, '255,255,255', 0.55 * fade);
}

function drawSky(g, rnd) {
  const yH = H * HORIZON;
  const grad = g.createLinearGradient(0, 0, 0, yH);
  grad.addColorStop(0.00, '#12467f');
  grad.addColorStop(0.35, '#3279bd');
  grad.addColorStop(0.68, '#7fb6de');
  grad.addColorStop(0.90, '#bfdcef');
  grad.addColorStop(1.00, '#e2eef6');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, yH);

  // Перистые полосы повыше.
  for (let i = 0; i < 26; i++) {
    const x = rnd() * W;
    const y = yH * (0.06 + rnd() * 0.3);
    const rx = 140 + rnd() * 380;
    g.save();
    g.translate(x, y);
    g.scale(1, (10 + rnd() * 16) / rx);
    blob(g, 0, 0, rx, '255,255,255', 0.07 + rnd() * 0.07);
    g.restore();
  }

  // Три плана кучевых облаков: чем ниже, тем мельче и бледнее.
  const layers = [
    { n: 5, y: [0.30, 0.48], s: [58, 105], fade: 1.0 },
    { n: 7, y: [0.52, 0.72], s: [34, 62], fade: 0.82 },
    { n: 11, y: [0.74, 0.94], s: [16, 34], fade: 0.6 },
  ];
  for (const L of layers) {
    for (let i = 0; i < L.n; i++) {
      const cx = rnd() * W * 1.1 - W * 0.05;
      const cy = yH * (L.y[0] + rnd() * (L.y[1] - L.y[0]));
      cumulus(g, cx, cy, L.s[0] + rnd() * (L.s[1] - L.s[0]), rnd, L.fade);
    }
  }
}

function drawGround(g, rnd) {
  const yH = H * HORIZON;
  const grad = g.createLinearGradient(0, yH, 0, H);
  grad.addColorStop(0.00, '#9fb08c');
  grad.addColorStop(0.18, '#8aa177');
  grad.addColorStop(0.55, '#6d8a5c');
  grad.addColorStop(1.00, '#55703f');
  g.fillStyle = grad;
  g.fillRect(0, yH, W, H - yH);

  // Поля: к горизонту полосы сжимаются, поэтому шаг растёт по квадрату.
  const bands = 16;
  const tones = ['#7d9668', '#8da473', '#6c8a55', '#9aa87d', '#778f5e', '#a3ad82', '#657f4e'];
  for (let i = 0; i < bands; i++) {
    const t0 = Math.pow(i / bands, 2.1);
    const t1 = Math.pow((i + 1) / bands, 2.1);
    const y0 = yH + (H - yH) * t0;
    const y1 = yH + (H - yH) * t1;
    const cells = Math.max(2, Math.round(14 - i * 0.7));
    let x = -W * 0.1;
    while (x < W * 1.1) {
      const w = (W * 1.2 / cells) * (0.5 + rnd());
      const skew = (x - W / 2) * (t1 - t0) * 0.55;
      g.beginPath();
      g.moveTo(x, y0);
      g.lineTo(x + w, y0);
      g.lineTo(x + w + skew * 1.6, y1);
      g.lineTo(x + skew * 1.6, y1);
      g.closePath();
      g.fillStyle = tones[Math.floor(rnd() * tones.length)];
      g.globalAlpha = 0.5 + rnd() * 0.3;
      g.fill();
      x += w;
    }
  }
  g.globalAlpha = 1;

  // Лесополосы тёмными штрихами вдоль границ полей.
  for (let i = 0; i < 26; i++) {
    const t = Math.pow(rnd(), 1.7);
    const y = yH + (H - yH) * t;
    const len = 60 + rnd() * 320 * (0.3 + t);
    const x = rnd() * W;
    g.strokeStyle = `rgba(48,68,40,${0.16 + t * 0.3})`;
    g.lineWidth = 1.5 + t * 6;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + len * (rnd() - 0.5) * 2, y + (rnd() - 0.5) * 8 * (0.4 + t));
    g.stroke();
  }

  // Дымка у горизонта: земля вдали светлеет и уходит в цвет неба.
  const haze = g.createLinearGradient(0, yH - H * 0.02, 0, yH + H * 0.12);
  haze.addColorStop(0, 'rgba(226,238,246,0.95)');
  haze.addColorStop(0.35, 'rgba(216,230,238,0.55)');
  haze.addColorStop(1, 'rgba(210,226,235,0)');
  g.fillStyle = haze;
  g.fillRect(0, yH - H * 0.02, W, H * 0.14);
}

/** Готовая картинка фона (data URL). Считается один раз. */
export function backdropURL() {
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const rnd = rng(20260920);
  drawSky(g, rnd);
  drawGround(g, rnd);
  cached = c.toDataURL('image/jpeg', 0.86);
  return cached;
}

/** Фон под кадр при выгрузке PNG — тем же кадрированием, что и в CSS (cover). */
export function drawBackdrop(ctx, w, h) {
  const img = backdropImage();
  if (!img || !img.complete || !img.naturalWidth) return false;
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  return true;
}

let imgEl = null;
export function backdropImage() {
  if (!imgEl) {
    imgEl = new Image();
    imgEl.src = backdropURL();
  }
  return imgEl;
}
