// Построение оболочки: профиль меридиана -> сетка полотнищ (клин x ряд) -> BufferGeometry.
// Модели АэроНаТЦ описаны объёмом и числом клиньев; диаметр, высота и число рядов
// считаются из профиля, а не задаются вручную.

import * as THREE from 'three';

// Профили меридиана: [y, r], y = 0 у горловины, y = 1 в куполе; r нормирован на 1.
const PROFILES = {
  classic: [
    [0.000, 0.175], [0.030, 0.245], [0.070, 0.345], [0.120, 0.470], [0.180, 0.600],
    [0.250, 0.720], [0.330, 0.830], [0.420, 0.920], [0.520, 0.980], [0.600, 1.000],
    [0.680, 0.985], [0.760, 0.935], [0.840, 0.840], [0.900, 0.720], [0.945, 0.585],
    [0.975, 0.420], [0.993, 0.235], [1.000, 0.000],
  ],
  // Спортивная форма снята с фотографий оболочек АэроНаТЦ: округлый купол,
  // широкая точка на ~0,66 высоты и длинный почти прямой конус к узкой горловине.
  sport: [
    [0.000, 0.105], [0.045, 0.190], [0.100, 0.295], [0.165, 0.415], [0.240, 0.545],
    [0.320, 0.665], [0.400, 0.775], [0.480, 0.875], [0.545, 0.945], [0.605, 0.990],
    [0.660, 1.000], [0.720, 0.985], [0.780, 0.945], [0.840, 0.870], [0.895, 0.755],
    [0.940, 0.610], [0.975, 0.420], [1.000, 0.000],
  ],
  oda: [
    [0.000, 0.200], [0.040, 0.300], [0.090, 0.430], [0.150, 0.560], [0.220, 0.690],
    [0.300, 0.800], [0.390, 0.890], [0.480, 0.955], [0.570, 0.990], [0.640, 1.000],
    [0.720, 0.980], [0.800, 0.920], [0.870, 0.810], [0.920, 0.690], [0.955, 0.550],
    [0.978, 0.400], [0.994, 0.220], [1.000, 0.000],
  ],
};

// Отношение высоты к диаметру для каждой формы.
const ASPECT = { classic: 1.06, sport: 1.45, oda: 1.02 };

const MERIDIAN_STEPS = 400;      // точность дискретизации профиля
const TARGET_PANEL_H = 1.45;     // целевая высота полотнища, м (ширина рулона ткани)
const SUB_U = 4;                 // подразбиение полотнища поперёк клина
const SUB_V = 2;                 // подразбиение полотнища по высоте

// Купол не сходится в точку: в нём вырезано круглое отверстие под парашютный
// клапан. Доли от радиуса оболочки.
export const CROWN_R = 0.33;     // радиус отверстия
export const VALVE_R = 0.36;     // клапан чуть больше отверстия

// Габариты подвески, м. Гондола берётся из каталога, остальное типовое.
export const BASKET_H = 1.15;
export const UPRIGHT_H = 1.05;
export const BURNER_H = 0.32;
export const PILOT_H = 1.75;

function lerp(a, b, t) { return a + (b - a) * t; }

// Срезаем верхушку профиля по отверстию купола, оставляя точную точку среза.
function truncateCrown(prof) {
  let iMax = 0;
  for (let i = 1; i < prof.length; i++) if (prof[i][1] > prof[iMax][1]) iMax = i;
  for (let i = iMax; i < prof.length; i++) {
    if (prof[i][1] <= CROWN_R) {
      const [y0, r0] = prof[i - 1];
      const [y1, r1] = prof[i];
      const t = (r0 - CROWN_R) / (r0 - r1 || 1);
      return [...prof.slice(0, i), [lerp(y0, y1, t), CROWN_R]];
    }
  }
  return prof;
}

// Линейная интерполяция профиля с равномерным шагом по y.
function sampleProfile(shape) {
  const pts = PROFILES[shape] || PROFILES.classic;
  const out = [];
  let k = 0;
  for (let i = 0; i <= MERIDIAN_STEPS; i++) {
    const y = i / MERIDIAN_STEPS;
    while (k < pts.length - 2 && pts[k + 1][0] < y) k++;
    const [y0, r0] = pts[k];
    const [y1, r1] = pts[k + 1];
    const t = y1 === y0 ? 0 : (y - y0) / (y1 - y0);
    out.push([y, Math.max(0, lerp(r0, r1, t))]);
  }
  return out;
}

// Габариты оболочки из объёма: V = pi * R^2 * H * integral(r^2 dy)
export function dims(model) {
  const shape = model.shape || 'classic';
  const aspect = ASPECT[shape] || 1.06;
  const full = sampleProfile(shape);
  // Объём считаем по полному профилю: отверстие закрыто клапаном.
  const prof = truncateCrown(full);

  let I = 0;
  for (let i = 0; i < full.length - 1; i++) {
    const rm = (full[i][1] + full[i + 1][1]) / 2;
    I += rm * rm * (full[i + 1][0] - full[i][0]);
  }

  const D = Math.cbrt((4 * model.volume) / (Math.PI * aspect * I));
  const H = aspect * D;
  const R = D / 2;

  // Длина меридиана (развёрнутого клина).
  let arc = 0;
  const cum = [0];
  for (let i = 0; i < prof.length - 1; i++) {
    const dr = (prof[i + 1][1] - prof[i][1]) * R;
    const dy = (prof[i + 1][0] - prof[i][0]) * H;
    arc += Math.hypot(dr, dy);
    cum.push(arc);
  }

  // Полотнище не может быть выше рабочей ширины рулона, поэтому округляем вверх:
  // число рядов растёт вместе с длиной клина, а не пляшет от округления.
  const rows = Math.min(30, Math.max(8, Math.ceil(arc / TARGET_PANEL_H)));
  return { shape, aspect, prof, full, R, D, H, arc, cum, rows, gores: model.gores };
}

// Границы рядов: равные отрезки по длине меридиана, снизу вверх.
function rowBoundaries(d) {
  const { prof, cum, arc, rows, R, H } = d;
  const res = [];
  for (let j = 0; j <= rows; j++) {
    const target = (arc * j) / rows;
    let i = 0;
    while (i < cum.length - 2 && cum[i + 1] < target) i++;
    const seg = cum[i + 1] - cum[i] || 1;
    const t = (target - cum[i]) / seg;
    const y = lerp(prof[i][0], prof[i + 1][0], t);
    const r = lerp(prof[i][1], prof[i + 1][1], t);
    res.push({ s: target, y: y * H, r: r * R, rn: r });
  }
  return res;
}

// Радиальный «пузырь» доли между швами: у 12-дольных он заметно сильнее.
function bulgeOf(gores) { return 6.5 / (gores * gores); }

function surfacePoint(d, bulge, phi, gorePhi, r, y) {
  // gorePhi — положение внутри клина от -0.5 до 0.5
  const m = 1 + bulge * (1 - 4 * gorePhi * gorePhi);
  const rr = r * m;
  return new THREE.Vector3(rr * Math.cos(phi), y, rr * Math.sin(phi));
}

/**
 * Геометрия оболочки с индивидуально окрашиваемыми полотнищами.
 * Возвращает geometry (vertexColors), карту panel -> диапазон вершин и
 * карту треугольник -> панель для пикинга.
 */
export function buildEnvelope(model) {
  const d = dims(model);
  const bounds = rowBoundaries(d);
  const N = d.gores;
  const rows = d.rows;
  const bulge = bulgeOf(N);
  const step = (Math.PI * 2) / N;

  const quadCount = N * rows * SUB_U * SUB_V;
  const pos = new Float32Array(quadCount * 4 * 3);
  const nor = new Float32Array(quadCount * 4 * 3);
  const col = new Float32Array(quadCount * 4 * 3);
  const uvs = new Float32Array(quadCount * 4 * 2);
  const idx = new Uint32Array(quadCount * 6);
  const triPanel = new Int32Array(quadCount * 2);
  const panelRange = new Array(N * rows);

  let v = 0; // счётчик вершин
  let f = 0; // счётчик индексов
  let t = 0; // счётчик треугольников

  const put = (i, p, n) => {
    pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
    nor[i * 3] = n.x; nor[i * 3 + 1] = n.y; nor[i * 3 + 2] = n.z;
  };

  const normalAt = (phi, gp, rj, yj, r1, y1, dphi) => {
    const p0 = surfacePoint(d, bulge, phi, gp, rj, yj);
    const pu = surfacePoint(d, bulge, phi + dphi, Math.min(0.5, gp + dphi / step), rj, yj);
    const pv = surfacePoint(d, bulge, phi, gp, r1, y1);
    const a = pu.clone().sub(p0);
    const b = pv.clone().sub(p0);
    const n = new THREE.Vector3().crossVectors(b, a).normalize();
    if (n.lengthSq() < 0.5) n.set(Math.cos(phi), 0, Math.sin(phi));
    // нормаль всегда наружу
    if (n.x * p0.x + n.z * p0.z < 0 && Math.abs(p0.y) > 1e-6) n.negate();
    return n;
  };

  for (let g = 0; g < N; g++) {
    const phi0 = g * step;
    for (let j = 0; j < rows; j++) {
      const b0 = bounds[j];
      const b1 = bounds[j + 1];
      const start = v;
      for (let su = 0; su < SUB_U; su++) {
        for (let sv = 0; sv < SUB_V; sv++) {
          const ua = su / SUB_U, ub = (su + 1) / SUB_U;
          const va = sv / SUB_V, vb = (sv + 1) / SUB_V;
          const corners = [[ua, va], [ub, va], [ub, vb], [ua, vb]];
          const base = v;
          for (const [cu, cv] of corners) {
            const phi = phi0 + cu * step;
            const gp = cu - 0.5;
            const r = lerp(b0.r, b1.r, cv);
            const y = lerp(b0.y, b1.y, cv);
            const rN = lerp(b0.r, b1.r, Math.min(1, cv + 0.02));
            const yN = lerp(b0.y, b1.y, Math.min(1, cv + 0.02));
            put(v, surfacePoint(d, bulge, phi, gp, r, y),
                normalAt(phi, gp, r, y, rN, yN, step * 0.02));
            // Развёртка: u — по окружности, v — по длине меридиана снизу вверх.
            uvs[v * 2] = (g + cu) / N;
            uvs[v * 2 + 1] = (j + cv) / rows;
            v++;
          }
          idx[f++] = base; idx[f++] = base + 1; idx[f++] = base + 2;
          idx[f++] = base; idx[f++] = base + 2; idx[f++] = base + 3;
          triPanel[t++] = j * N + g;
          triPanel[t++] = j * N + g;
        }
      }
      panelRange[j * N + g] = [start, v - start];
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(idx, 1));
  geometry.computeBoundingSphere();

  return { geometry, panelRange, triPanel, dims: d, bounds, rows, gores: N, bulge };
}

// Линии швов: вертикальные по клиньям и горизонтальные по рядам.
export function buildSeams(env) {
  const { dims: d, bounds, gores: N, bulge } = env;
  const step = (Math.PI * 2) / N;
  const pts = [];

  for (let g = 0; g < N; g++) {
    const phi = g * step;
    for (let j = 0; j < bounds.length - 1; j++) {
      const a = surfacePoint(d, bulge, phi, -0.5, bounds[j].r, bounds[j].y);
      const b = surfacePoint(d, bulge, phi, -0.5, bounds[j + 1].r, bounds[j + 1].y);
      pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }
  for (let j = 1; j < bounds.length - 1; j++) {
    const { r, y } = bounds[j];
    const seg = N * 8;
    for (let i = 0; i < seg; i++) {
      const p1 = i / seg * Math.PI * 2, p2 = (i + 1) / seg * Math.PI * 2;
      const gp1 = ((p1 / step) % 1) - 0.5, gp2 = ((p2 / step) % 1) - 0.5;
      const a = surfacePoint(d, bulge, p1, gp1, r, y);
      const b = surfacePoint(d, bulge, p2, gp2, r, y);
      pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return g;
}

// Силовые ленты — объёмные полосы поверх вертикальных швов.
export function buildTapes(env) {
  const { dims: d, bounds, gores: N, bulge } = env;
  const step = (Math.PI * 2) / N;
  const width = d.R * 0.0042;
  const pos = [];
  const nor = [];
  const idx = [];
  let v = 0;

  for (let g = 0; g < N; g++) {
    const phi = g * step;
    for (let j = 0; j < bounds.length - 1; j++) {
      const rows2 = [bounds[j], bounds[j + 1]];
      const base = v;
      for (const b of rows2) {
        for (const side of [-1, 1]) {
          const dphi = (side * width) / Math.max(b.r, 1e-3);
          const p = surfacePoint(d, bulge, phi + dphi, -0.5, b.r * 1.004, b.y);
          pos.push(p.x, p.y, p.z);
          const n = new THREE.Vector3(p.x, 0, p.z).normalize();
          nor.push(n.x, 0.15, n.z);
          v++;
        }
      }
      idx.push(base, base + 1, base + 3, base, base + 3, base + 2);
    }
  }

  const g2 = new THREE.BufferGeometry();
  g2.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g2.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g2.setIndex(idx);
  return g2;
}

/**
 * Парашютный клапан — круглый диск чуть шире отверстия в куполе,
 * лежащий ВНУТРИ оболочки. Сегменты только задают раскраску, контур круглый.
 */
export function valveSpec(env) {
  const d = env.dims;
  const segs = Math.max(6, Math.round(env.gores / 2));
  const top = d.prof[d.prof.length - 1];      // точка среза купола
  return {
    segs,
    radius: VALVE_R * d.R,
    hole: CROWN_R * d.R,
    y: top[0] * d.H - d.H * 0.018,            // чуть ниже кромки — внутри
  };
}

export const VALVE_RING = 0.72;   // доля радиуса, где кончаются клинья

export function buildValve(env) {
  const { segs, radius, y } = valveSpec(env);
  const ANG = 5;                   // дробление по дуге для гладкого круга
  const RAD = 3;                   // дробление клина по радиусу
  const sag = radius * 0.13;       // провис ткани внутрь
  const pos = [], nor = [], uvs = [], idx = [];
  const ranges = [];
  const triZone = [];
  let v = 0;

  // Точка полотна клапана + её место на квадратной развёртке клапана.
  const put = (a2, t) => {
    const r = radius * t;
    const x = r * Math.cos(a2), z = r * Math.sin(a2);
    pos.push(x, y - sag * (1 - t * t), z);
    const n = new THREE.Vector3(-x * 0.35, radius, -z * 0.35).normalize();
    nor.push(n.x, n.y, n.z);
    uvs.push(0.5 + x / (2 * radius), 0.5 + z / (2 * radius));
    v++;
  };

  const band = (t0, t1) => {
    for (let s2 = 0; s2 < segs; s2++) {
      const start = v;
      for (let i = 0; i < ANG; i++) {
        const a0 = ((s2 + i / ANG) / segs) * Math.PI * 2;
        const a1 = ((s2 + (i + 1) / ANG) / segs) * Math.PI * 2;
        const steps = t0 === 0 ? RAD : 1;
        for (let k = 0; k < steps; k++) {
          const u0 = t0 + ((t1 - t0) * k) / steps;
          const u1 = t0 + ((t1 - t0) * (k + 1)) / steps;
          const base = v;
          put(a0, u0); put(a1, u0); put(a1, u1); put(a0, u1);
          idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
          triZone.push(ranges.length, ranges.length);
        }
      }
      ranges.push([start, v - start]);
    }
  };

  // Сначала внешний пояс: по сути прямоугольники по краю клапана.
  band(VALVE_RING, 1);
  // Затем длинные клинья от пояса к центру.
  band(0, VALVE_RING);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  return { geometry: g, ranges, triZone, segs, zones: ranges.length };
}

/** Габариты подвески: гондола из каталога, рама и стойки типовые. */
export function rigSpec(env) {
  const d = env.dims;
  const b = (env.model && env.model.basket) || { w: 1.6, d: 1.05, label: '160×105 см' };
  const yFrame = -d.H * 0.125;                 // верх рамы горелки
  const yBurnerTop = yFrame + BURNER_H;
  const yRim = yFrame - UPRIGHT_H;
  const yFloor = yRim - BASKET_H;
  return {
    b, yFrame, yBurnerTop, yRim, yFloor,
    ux: b.w / 2 - 0.1,
    uz: b.d / 2 - 0.1,
    mouthR: d.prof[0][1] * d.R,
  };
}

/**
 * Воздухозаборник (он же юбка) — фартук от горловины оболочки вниз к точкам
 * крепления у стоек рамы. Занимает полокружности со стороны широкой грани
 * гондолы, собран из клиньев и красится посегментно.
 */
export const SCOOP_SEGS = 5;

export function buildScoop(env, rig) {
  const { ux, uz, yFrame, mouthR } = rig;
  const rows = 4;
  const zAttach = -uz - 0.08;
  const pos = [], nor = [], col = [], idx = [];
  const ranges = [];
  let v = 0;

  // u = 0..1 вдоль дуги от -X через -Z к +X — это и есть широкая сторона гондолы.
  const point = (u, t) => {
    const a = Math.PI + u * Math.PI;
    const tx = mouthR * Math.cos(a), tz = mouthR * Math.sin(a);
    const bx = lerp(-ux, ux, u), bz = zAttach;
    const bulge = 1 + 0.1 * Math.sin(Math.PI * t) * (1 - Math.abs(2 * u - 1));
    return new THREE.Vector3(
      lerp(tx, bx, t) * bulge,
      lerp(0, yFrame, t),
      lerp(tz, bz, t) * bulge,
    );
  };

  for (let sgm = 0; sgm < SCOOP_SEGS; sgm++) {
    const u0 = sgm / SCOOP_SEGS, u1 = (sgm + 1) / SCOOP_SEGS;
    const start = v;
    for (let k = 0; k < rows; k++) {
      const t0 = k / rows, t1 = (k + 1) / rows;
      const base = v;
      const quad = [[u0, t0], [u1, t0], [u1, t1], [u0, t1]];
      const ps = quad.map(([u, t]) => point(u, t));
      const n = new THREE.Vector3()
        .crossVectors(ps[1].clone().sub(ps[0]), ps[3].clone().sub(ps[0])).normalize();
      for (const p of ps) {
        pos.push(p.x, p.y, p.z);
        nor.push(n.x, n.y, n.z);
        col.push(1, 1, 1);
        v++;
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    ranges.push([start, v - start]);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return { geometry: g, ranges, segs: SCOOP_SEGS };
}

/**
 * Какой клин фартука приходится на этот клин оболочки. Нужно, чтобы нижний
 * ряд полотнищ шёл той же тканью, что и воздухозаборник.
 */
export function scoopSegForGore(g, gores) {
  const a = ((g + 0.5) / gores) * Math.PI * 2;
  let da = a - Math.PI;                        // 0..PI внутри дуги фартука
  if (da < 0) da += Math.PI * 2;
  if (da > Math.PI) return da > Math.PI * 1.5 ? 0 : SCOOP_SEGS - 1;
  return Math.min(SCOOP_SEGS - 1, Math.floor((da / Math.PI) * SCOOP_SEGS));
}

/** Контур модели для карточки каталога: силуэт + сетка клиньев и рядов. */
export function silhouette(model, W = 120, H = 156) {
  const d = dims(model);
  const bounds = rowBoundaries(d);
  const pad = 6;
  const hBody = H - pad * 2 - 16;
  const s = Math.min((W / 2 - pad) / d.R, hBody / d.H);
  const cx = W / 2;
  const yb = H - pad - 16;
  const X = (r) => cx + r * s;
  const Y = (y) => yb - y * s;

  const right = d.prof.map(([y, r]) => `${X(r * d.R).toFixed(1)},${Y(y * d.H).toFixed(1)}`);
  const left = [...d.prof].reverse().map(([y, r]) => `${X(-r * d.R).toFixed(1)},${Y(y * d.H).toFixed(1)}`);
  const outline = `M${right.join('L')}L${left.join('L')}Z`;

  const mer = [];
  const half = Math.max(2, Math.round(d.gores / 4));
  for (let k = 1; k <= half; k++) {
    const fr = k / (half + 0.25);
    mer.push(`M${d.prof.map(([y, r]) => `${X(r * d.R * fr).toFixed(1)},${Y(y * d.H).toFixed(1)}`).join('L')}`);
    mer.push(`M${d.prof.map(([y, r]) => `${X(-r * d.R * fr).toFixed(1)},${Y(y * d.H).toFixed(1)}`).join('L')}`);
  }

  const rings = bounds.slice(1, -1).map((b) =>
    `M${X(-b.r).toFixed(1)},${Y(b.y).toFixed(1)}L${X(b.r).toFixed(1)},${Y(b.y).toFixed(1)}`);

  const bw = Math.max(5, (model.basket ? model.basket.w : 1.6) * s);
  const basket =
    `M${(cx - bw / 2).toFixed(1)},${(yb + 6).toFixed(1)}` +
    `h${bw.toFixed(1)}v9h${(-bw).toFixed(1)}z`;

  return { W, H, outline, meridians: mer.join(''), rings: rings.join(''), basket, dims: d };
}

/** Развёртка клина: трапеции полотнищ в натуральном масштабе (метры). */
export function unwrap(env) {
  const { bounds, gores: N, rows } = env;
  const cells = [];
  for (let j = 0; j < rows; j++) {
    const b0 = bounds[j], b1 = bounds[j + 1];
    const wBot = (2 * Math.PI * b0.r) / N;
    const wTop = (2 * Math.PI * b1.r) / N;
    const h = b1.s - b0.s;
    cells.push({ row: j, wBot, wTop, h, yBot: b0.s, yTop: b1.s });
  }
  const goreLen = bounds[rows].s;
  const maxW = Math.max(...cells.map((c) => Math.max(c.wBot, c.wTop)));
  return { cells, goreLen, maxW, gores: N, rows };
}
