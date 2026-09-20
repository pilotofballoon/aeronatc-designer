// Состояние проекта: модель, карта цветов, история, сохранение.

import { DEFAULT_COLOR, getModel, MODELS } from './data.js';
import { dims, valveSpec, SCOOP_SEGS } from './geometry.js';

const STORAGE_KEY = 'aeronatc.designer.v1';
const HISTORY_LIMIT = 80;

const listeners = new Set();
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = (reason) => listeners.forEach((fn) => fn(state, reason));

let history = [];
let future = [];

export const state = {
  modelId: 'kl-2550',
  gores: 24,
  rows: 18,
  valveSegs: 12,
  panels: [],
  valve: [],
  skirt: [],
  scoop: [],
  mouth: 'P17',          // устарело: осталось для чтения старых проектов
  active: 'S06',
  secondary: 'S05',
  paintMode: 'panel',      // panel | gore | row | ring | diag | all
  gloss: 0.32,
  tapes: false,
  tapeColor: 'P15',
  theme: 'light',
  view: '3d',              // 3d | layout | preview
  panelTab: 'color',       // color | design | valve | memo | export
  project: 'Без названия',
  customer: '',
};

function fill(n, c) { return new Array(n).fill(c); }

/** Пересобрать размерности под выбранную модель, сохранив цвета по возможности. */
export function applyModel(modelId, keepColors = true) {
  const model = getModel(modelId) || MODELS[0];
  const d = dims(model);
  const env = { dims: d, gores: model.gores };
  const vs = valveSpec(env);

  const oldPanels = state.panels;
  const oldG = state.gores, oldR = state.rows;

  state.modelId = model.id;
  state.gores = model.gores;
  state.rows = d.rows;
  state.valveSegs = vs.segs;

  const next = fill(state.gores * state.rows, DEFAULT_COLOR);
  if (keepColors && oldPanels.length === oldG * oldR && oldPanels.length) {
    for (let j = 0; j < state.rows; j++) {
      for (let g = 0; g < state.gores; g++) {
        const sj = Math.min(oldR - 1, Math.floor((j * oldR) / state.rows));
        const sg = Math.min(oldG - 1, Math.floor((g * oldG) / state.gores));
        next[j * state.gores + g] = oldPanels[sj * oldG + sg];
      }
    }
  }
  state.panels = next;

  const oldValve = state.valve;
  state.valve = fill(state.valveSegs, oldValve[0] || DEFAULT_COLOR);
  const oldSkirt = state.skirt;
  state.skirt = fill(state.gores, oldSkirt[0] || 'S03');
  const oldScoop = state.scoop;
  state.scoop = fill(SCOOP_SEGS, oldScoop[0] || state.mouth || 'P17');
}

export const panelAt = (g, r) => state.panels[r * state.gores + g];
export const setPanelRaw = (g, r, code) => { state.panels[r * state.gores + g] = code; };

// ─── История ──────────────────────────────────────────────────────────────────
function snapshot() {
  return JSON.stringify({
    modelId: state.modelId, panels: state.panels, valve: state.valve,
    skirt: state.skirt, scoop: state.scoop, tapes: state.tapes, tapeColor: state.tapeColor,
  });
}

export function commit(reason = 'change') {
  history.push(snapshot());
  if (history.length > HISTORY_LIMIT) history.shift();
  future = [];
  emit(reason);
  save();
}

/** Зафиксировать текущее состояние в истории перед изменением. */
export function mark() {
  history.push(snapshot());
  if (history.length > HISTORY_LIMIT) history.shift();
  future = [];
}

function restore(raw) {
  const s = JSON.parse(raw);
  if (s.modelId !== state.modelId) applyModel(s.modelId, false);
  state.panels = s.panels;
  state.valve = s.valve;
  state.skirt = s.skirt;
  state.scoop = s.scoop;
  state.tapes = s.tapes;
  state.tapeColor = s.tapeColor;
}

export function undo() {
  if (!history.length) return false;
  future.push(snapshot());
  restore(history.pop());
  emit('undo'); save();
  return true;
}

export function redo() {
  if (!future.length) return false;
  history.push(snapshot());
  restore(future.pop());
  emit('redo'); save();
  return true;
}

export const canUndo = () => history.length > 0;
export const canRedo = () => future.length > 0;

export function touch(reason = 'ui') { emit(reason); save(); }

// ─── Сохранение ───────────────────────────────────────────────────────────────
export function serialize() {
  return {
    app: 'aeronatc-designer', version: 1, saved: new Date().toISOString(),
    project: state.project, customer: state.customer,
    modelId: state.modelId, gores: state.gores, rows: state.rows,
    panels: state.panels, valve: state.valve, skirt: state.skirt, scoop: state.scoop,
    tapes: state.tapes, tapeColor: state.tapeColor, gloss: state.gloss,
  };
}

export function load(data) {
  if (!data || data.app !== 'aeronatc-designer') return false;
  applyModel(data.modelId, false);
  if (Array.isArray(data.panels) && data.panels.length === state.gores * state.rows) {
    state.panels = data.panels;
  }
  if (Array.isArray(data.valve) && data.valve.length === state.valveSegs) state.valve = data.valve;
  if (Array.isArray(data.skirt) && data.skirt.length === state.gores) state.skirt = data.skirt;
  if (Array.isArray(data.scoop) && data.scoop.length === SCOOP_SEGS) state.scoop = data.scoop;
  else if (data.mouth) state.scoop = fill(SCOOP_SEGS, data.mouth); // проект версии 1
  state.tapes = !!data.tapes;
  if (data.tapeColor) state.tapeColor = data.tapeColor;
  if (typeof data.gloss === 'number') state.gloss = data.gloss;
  if (data.project) state.project = data.project;
  if (data.customer) state.customer = data.customer;
  history = []; future = [];
  emit('load');
  return true;
}

export function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(serialize())); } catch (e) { /* приватный режим */ }
}

export function restoreSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    return load(JSON.parse(raw));
  } catch (e) { return false; }
}

// ─── Раскраски ────────────────────────────────────────────────────────────────
export const PRESETS = [
  { id: 'chess',  label: 'Шахматы',      need: 2 },
  { id: 'snailL', label: 'Улитка влево',  need: 3 },
  { id: 'snailR', label: 'Улитка вправо', need: 3 },
  { id: 'gores',  label: 'Клинья',        need: 2 },
  { id: 'rings',  label: 'Пояса',         need: 2 },
  { id: 'chevron',label: 'Шеврон',        need: 3 },
  { id: 'rainbow',label: 'Радуга',        need: 0 },
  { id: 'random', label: 'Тетрис',        need: 3 },
];

const RAINBOW = ['S06', 'S04', 'S03', 'S09', 'S01', 'S08', 'P01'];

export function applyPreset(id, colors) {
  const G = state.gores, R = state.rows;
  const meta = PRESETS.find((p) => p.id === id);
  const src = colors && colors.length ? colors : [state.active, state.secondary];
  // Каждая раскраска берёт ровно столько цветов, сколько ей нужно.
  const cs = meta && meta.need ? src.slice(0, meta.need) : src;
  const pick = (i) => cs[((i % cs.length) + cs.length) % cs.length];
  const out = new Array(G * R);

  for (let r = 0; r < R; r++) {
    for (let g = 0; g < G; g++) {
      let c;
      switch (id) {
        case 'chess':   c = pick(g + r); break;
        case 'snailL':  c = pick(Math.floor((g + r) / 2)); break;
        case 'snailR':  c = pick(Math.floor((G - g + r) / 2)); break;
        case 'gores':   c = pick(g); break;
        case 'rings':   c = pick(r); break;
        case 'chevron': {
          const half = G / 2;
          const d = Math.abs((g % G) - half);
          c = pick(Math.round(d / 2) + r);
          break;
        }
        case 'rainbow': c = RAINBOW[(R - 1 - r) % RAINBOW.length]; break;
        case 'random': {
          const bg = Math.floor(g / 2), br = Math.floor(r / 2);
          const h = Math.sin(bg * 12.9898 + br * 78.233) * 43758.5453;
          c = pick(Math.floor(Math.abs(h - Math.floor(h)) * cs.length * 3));
          break;
        }
        default: c = pick(0);
      }
      out[r * G + g] = c;
    }
  }
  mark();
  state.panels = out;
  commit('preset');
}

/** Спецификация: сколько полотнищ каждого цвета уходит в оболочку. */
export function spec(env) {
  const counts = new Map();
  const add = (code, part, area) => {
    if (!counts.has(code)) {
      counts.set(code, { code, panels: 0, env: 0, area: 0, parts: new Set() });
    }
    const e = counts.get(code);
    e.panels += 1;
    if (part === 'оболочка') e.env += 1;
    e.area += area;
    e.parts.add(part);
  };
  const u = env ? env.unwrapped : null;
  for (let r = 0; r < state.rows; r++) {
    const cell = u ? u.cells[r] : null;
    const area = cell ? ((cell.wBot + cell.wTop) / 2) * cell.h : 0;
    for (let g = 0; g < state.gores; g++) add(state.panels[r * state.gores + g], 'оболочка', area);
  }
  state.valve.forEach((c) => add(c, 'клапан', 0));
  state.skirt.forEach((c) => add(c, 'юбка', 0));
  state.scoop.forEach((c) => add(c, 'воздухозаборник', 0));
  return [...counts.values()].sort((a, b) => b.panels - a.panels);
}
