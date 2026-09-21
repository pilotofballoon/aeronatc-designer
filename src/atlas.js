// Развёртка оболочки как единый холст: цвета полотнищ, текст и изображения.
// Один и тот же холст идёт текстурой на 3D-модель и подложкой в раскладку,
// поэтому «что вижу на шаре» и «что уйдёт в раскрой» гарантированно совпадают.

import * as THREE from 'three';
import { hexOf } from './data.js';
import { VALVE_RING } from './geometry.js';
import { state } from './state.js';

export const ATLAS_W = 2048;
export const ATLAS_H = 1024;

let base = null;   // цвета полотнищ + дизайн
let out = null;    // base + подсветка при наведении
let texture = null;
let hover = null;  // Set номеров полотнищ

// Клапан живёт на своей квадратной развёртке: он круглый, и общий атлас
// оболочки для него не годится.
export const VALVE_PX = 768;
let valveCanvas = null;
let valveTexture = null;
let valveHover = null;   // номер подсвеченной зоны клапана

// Картинки декалей кешируем по id: перерисовка атласа идёт часто.
const images = new Map();

function ctxOf(canvas) { return canvas.getContext('2d'); }

function ensure() {
  if (base) return;
  base = document.createElement('canvas');
  base.width = ATLAS_W; base.height = ATLAS_H;
  out = document.createElement('canvas');
  out.width = ATLAS_W; out.height = ATLAS_H;
  texture = new THREE.CanvasTexture(out);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  // Смотрим на оболочку снаружи, а угол phi растёт справа налево. Зеркалим
  // выборку по горизонтали — тогда холст и поверхность совпадают по направлению,
  // и текст читается, а не отражается.
  texture.repeat.x = -1;
  texture.offset.x = 1;
}

export function getTexture() { ensure(); return texture; }

function ensureValve() {
  if (valveCanvas) return;
  valveCanvas = document.createElement('canvas');
  valveCanvas.width = VALVE_PX; valveCanvas.height = VALVE_PX;
  valveTexture = new THREE.CanvasTexture(valveCanvas);
  valveTexture.colorSpace = THREE.SRGBColorSpace;
  valveTexture.anisotropy = 8;
}

export function getValveTexture() { ensureValve(); return valveTexture; }

/**
 * Развёртка клапана: внешний пояс прямоугольников, длинные клинья внутри,
 * поверх — дизайн, привязанный к клапану.
 */
export function redrawValve(env) {
  ensureValve();
  const g = valveCanvas.getContext('2d');
  const C = VALVE_PX / 2;
  const R = VALVE_PX / 2;
  const segs = state.valveSegs;

  g.clearRect(0, 0, VALVE_PX, VALVE_PX);

  const sector = (r0, r1, s, code) => {
    // Развёртка отражена по вертикали при загрузке, поэтому углы берём со знаком минус.
    const a0 = -((s + 1) / segs) * Math.PI * 2;
    const a1 = -(s / segs) * Math.PI * 2;
    g.beginPath();
    g.arc(C, C, r1, a0, a1);
    if (r0 > 0) g.arc(C, C, r0, a1, a0, true);
    else g.lineTo(C, C);
    g.closePath();
    g.fillStyle = hexOf(code);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,.18)';
    g.lineWidth = 1.5;
    g.stroke();
  };

  for (let s2 = 0; s2 < segs; s2++) sector(R * VALVE_RING, R, s2, state.valve[s2]);
  for (let s2 = 0; s2 < segs; s2++) sector(0, R * VALVE_RING, s2, state.valve[segs + s2]);

  if (valveHover !== null && valveHover !== undefined) {
    const r0 = valveHover < segs ? R * VALVE_RING : 0;
    const r1 = valveHover < segs ? R : R * VALVE_RING;
    const c = new THREE.Color(hexOf(state.active));
    g.save();
    g.globalAlpha = 0.55;
    sector(r0, r1, valveHover % segs, state.active);
    g.globalAlpha = 1;
    g.restore();
    void c;
  }

  const list = state.decals.filter((d) => d.target === 'valve');
  for (let i = list.length - 1; i >= 0; i--) drawDecal(g, list[i], env, VALVE_PX, VALVE_PX, 1, true);

  valveTexture.needsUpdate = true;
}
export function getCanvas() { ensure(); return out; }

/** Пиксели холста для полотнища (клин g, ряд r). v = 0 у горловины. */
export function cellRect(g, r) {
  const cw = ATLAS_W / state.gores;
  const chh = ATLAS_H / state.rows;
  return { x: ATLAS_W - (g + 1) * cw, y: ATLAS_H - (r + 1) * chh, w: cw, h: chh };
}

export function imageFor(d) {
  if (d.type !== 'image' || !d.src) return null;
  let img = images.get(d.id);
  if (!img || img.dataset.src !== d.id) {
    img = new Image();
    img.dataset.src = d.id;
    img.onload = () => { redraw(); };
    img.src = d.src;
    images.set(d.id, img);
  }
  return img.complete && img.naturalWidth ? img : null;
}

export function dropImage(id) { images.delete(id); }

/**
 * Поправка пропорций: атлас прямоугольный, а поверхность — окружность на длину
 * меридиана. Коэффициент держит круг круглым, а не эллипсом.
 */
function aspectK(env) {
  if (!env) return 1;
  const circ = 2 * Math.PI * env.dims.R;
  const arc = env.unwrapped ? env.unwrapped.goreLen : env.dims.arc;
  return (circ * ATLAS_H) / (arc * ATLAS_W);
}

function drawDecal(g, d, env, W = ATLAS_W, H = ATLAS_H, kOverride = null, onValve = false) {
  const k = kOverride === null ? aspectK(env) : kOverride;
  // Развёртка оболочки зеркалится при выборке, развёртка клапана — нет,
  // поэтому и место элемента считается по-разному.
  // Развёртка клапана ориентирована противоположно развёртке оболочки:
  // по горизонтали не зеркалится, по вертикали — наоборот.
  const x = onValve ? d.u * W : (1 - d.u) * W;
  const y = onValve ? d.v * H : (1 - d.v) * H;

  const paint = (ox) => {
    g.save();
    g.translate(x + ox, y);
    g.rotate(((onValve ? -d.rot : d.rot) * Math.PI) / 180);
    // Клапан читают сверху, снаружи оболочки — отражаем по вертикали.
    if (onValve) g.scale(1, -1);
    g.globalAlpha = d.opacity;

    if (d.type === 'text') {
      const px = d.size * H;
      g.font = `${d.bold ? '700 ' : ''}${px}px ${d.font}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.scale(1, k);
      if (d.outline) {
        g.lineWidth = px * 0.14;
        g.strokeStyle = hexOf(d.outlineColor);
        g.lineJoin = 'round';
        g.strokeText(d.text, 0, 0);
      }
      g.fillStyle = hexOf(d.color);
      g.fillText(d.text, 0, 0);
    } else {
      const img = imageFor(d);
      if (img) {
        const w = d.size * W;
        const h = w * (img.naturalHeight / img.naturalWidth) * k;
        g.drawImage(img, -w / 2, -h / 2, w, h);
      }
    }
    g.restore();
  };

  // Развёртка замкнута по кругу — рисуем ещё два раза со сдвигом, чтобы
  // элемент на стыке не обрезался.
  paint(0);
  if (W === ATLAS_W) {
    if (x < W * 0.25) paint(W);
    if (x > W * 0.75) paint(-W);
  }
}

/** Перерисовать базовый холст: полотнища, затем дизайн снизу вверх по списку. */
export function redrawBase(env) {
  ensure();
  const g = ctxOf(base);
  g.clearRect(0, 0, ATLAS_W, ATLAS_H);

  for (let r = 0; r < state.rows; r++) {
    for (let gi = 0; gi < state.gores; gi++) {
      const { x, y, w, h } = cellRect(gi, r);
      g.fillStyle = hexOf(state.panels[r * state.gores + gi]);
      g.fillRect(Math.floor(x), Math.floor(y), Math.ceil(w) + 1, Math.ceil(h) + 1);
    }
  }

  // Последний в списке — самый верхний слой, поэтому идём с конца.
  const list = state.decals.filter((d) => d.target !== 'valve');
  for (let i = list.length - 1; i >= 0; i--) drawDecal(g, list[i], env);

  redrawValve(env);
  redrawOut();
}

/** Наложить подсветку наведения поверх базового холста. */
export function redrawOut() {
  ensure();
  const g = ctxOf(out);
  g.clearRect(0, 0, ATLAS_W, ATLAS_H);
  g.drawImage(base, 0, 0);

  if (hover && hover.size) {
    const c = new THREE.Color(hexOf(state.active));
    g.save();
    g.fillStyle = `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},0.55)`;
    for (const panel of hover) {
      const gi = panel % state.gores;
      const r = Math.floor(panel / state.gores);
      const { x, y, w, h } = cellRect(gi, r);
      g.fillRect(x, y, w, h);
    }
    g.strokeStyle = 'rgba(255,255,255,.85)';
    g.lineWidth = 3;
    for (const panel of hover) {
      const gi = panel % state.gores;
      const r = Math.floor(panel / state.gores);
      const { x, y, w, h } = cellRect(gi, r);
      g.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
    }
    g.restore();
  }

  if (texture) texture.needsUpdate = true;
}

export function setValveHover(zone) {
  const z = zone === undefined ? null : zone;
  if (z === valveHover) return false;
  valveHover = z;
  redrawValve(null);
  return true;
}

export function setHover(set) {
  const same = (!set && !hover)
    || (set && hover && set.size === hover.size && [...set].every((v) => hover.has(v)));
  if (same) return false;
  hover = set;
  redrawOut();
  return true;
}

let redrawEnv = null;
export function bindEnv(env) { redrawEnv = env; }
export function redraw() { redrawBase(redrawEnv); }
