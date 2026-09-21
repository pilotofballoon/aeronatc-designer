// Плоская раскладка: клинья в натуральных пропорциях, покраска полотнищ,
// нумерация клиньев и рядов, выгрузка PNG/PDF.

import { state, mark, commit } from './state.js';
import { hexOf, getModel, CONTACTS } from './data.js';
import { paintPanel, affectedPanels } from './scene.js';
import { getCanvas, cellRect } from './atlas.js';

const GAP = 0.18;          // зазор между клиньями, м

// Развёртку кладём так же, как оболочка читается снаружи: клин 1 слева.
// Индекс клина в геометрии растёт против часовой, поэтому колонка — зеркальна.
const colOf = (g, N) => N - 1 - g;
const MARGIN = { l: 46, t: 34, r: 18, b: 26 };

export class LayoutView {
  constructor(canvas, onChange) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onChange = onChange || (() => {});
    this.env = null;
    this.zoom = 1;
    this.off = { x: 0, y: 0 };
    this.hover = null;       // Set номеров полотнищ, как и на 3D
    this.mode = 'true';      // true — по размерам ткани, grid — равные квадраты
    this.bind();
  }

  setEnv(env) { this.env = env; this.fit(); }

  bind() {
    const c = this.canvas;
    let dragging = false, moved = false, last = null;

    c.addEventListener('pointerdown', (e) => {
      dragging = true; moved = false; last = { x: e.clientX, y: e.clientY };
      // Захват указателя — не критичен: на части устройств и при синтетических
      // событиях его нет, и падать из-за этого нельзя.
      try { c.setPointerCapture(e.pointerId); } catch (err) { /* нет активного указателя */ }
    });
    c.addEventListener('pointermove', (e) => {
      const rect = c.getBoundingClientRect();
      if (dragging && (e.buttons & 1)) {
        const dx = e.clientX - last.x, dy = e.clientY - last.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
        if (moved) { this.off.x += dx; this.off.y += dy; last = { x: e.clientX, y: e.clientY }; this.draw(); }
        return;
      }
      const h = this.hitTest(e.clientX - rect.left, e.clientY - rect.top);
      const key = h ? `${h.g}:${h.r}:${state.paintMode}` : null;
      if (key !== this.hoverKey) {
        this.hoverKey = key;
        this.hover = h ? affectedPanels(h.g, h.r) : null;
        this.draw();
      }
    });
    c.addEventListener('pointerup', (e) => {
      dragging = false;
      if (moved) return;
      const rect = c.getBoundingClientRect();
      const h = this.hitTest(e.clientX - rect.left, e.clientY - rect.top);
      if (!h) return;
      mark();
      paintPanel(h.g, h.r, state.active);
      commit('layout-paint');
      // Сначала пересобираем развёртку, потом рисуем: иначе на холст ляжет
      // предыдущая версия текстуры и клетка останется незакрашенной.
      this.onChange();
      this.draw();
    });
    c.addEventListener('pointerleave', () => { this.hover = null; this.hoverKey = null; this.draw(); });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const k = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      this.zoom = Math.min(8, Math.max(0.2, this.zoom * k));
      this.draw();
    }, { passive: false });
  }

  setMode(mode) { this.mode = mode; this.fit(); }

  get metrics() {
    const u = this.env.unwrapped;
    if (this.mode === 'grid') {
      // Таблица: равные квадраты без зазоров, клинья по горизонтали.
      const cell = u.maxW;
      return { u, pitch: cell, cell, totalW: cell * u.gores, totalH: cell * u.rows };
    }
    const pitch = u.maxW + GAP;
    return { u, pitch, totalW: pitch * u.gores - GAP, totalH: u.goreLen };
  }

  fit() {
    if (!this.env) return;
    const { totalW, totalH } = this.metrics;
    const w = this.canvas.clientWidth - MARGIN.l - MARGIN.r;
    const h = this.canvas.clientHeight - MARGIN.t - MARGIN.b;
    this.base = Math.min(w / totalW, h / totalH);
    this.zoom = 1;
    this.off = { x: 0, y: 0 };
    this.draw();
  }

  get scale() { return (this.base || 10) * this.zoom; }

  // Координаты раскладки (метры) -> пиксели канваса.
  toPx(xm, ym) {
    const s = this.scale;
    const { totalW, totalH } = this.metrics;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const x0 = MARGIN.l + (w - MARGIN.l - MARGIN.r - totalW * s) / 2 + this.off.x;
    const y0 = MARGIN.t + (h - MARGIN.t - MARGIN.b - totalH * s) / 2 + this.off.y;
    return [x0 + xm * s, y0 + (totalH - ym) * s];
  }

  cellPoly(g, r) {
    const m = this.metrics;
    const col = colOf(g, m.u.gores);
    if (this.mode === 'grid') {
      const x0 = col * m.cell;
      const y0 = r * m.cell;
      return [
        this.toPx(x0, y0), this.toPx(x0 + m.cell, y0),
        this.toPx(x0 + m.cell, y0 + m.cell), this.toPx(x0, y0 + m.cell),
      ];
    }
    const cell = m.u.cells[r];
    const cx = col * m.pitch + m.u.maxW / 2;
    return [
      this.toPx(cx - cell.wBot / 2, cell.yBot),
      this.toPx(cx + cell.wBot / 2, cell.yBot),
      this.toPx(cx + cell.wTop / 2, cell.yTop),
      this.toPx(cx - cell.wTop / 2, cell.yTop),
    ];
  }

  hitTest(px, py) {
    if (!this.env) return null;
    const { u } = this.metrics;
    for (let g = 0; g < u.gores; g++) {
      for (let r = 0; r < u.rows; r++) {
        const p = this.cellPoly(g, r);
        if (pointInPoly(px, py, p)) return { g, r };
      }
    }
    return null;
  }

  draw(target) {
    if (!this.env) return;
    const c = target || this.canvas;
    const ctx = c.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (!target) {
      const w = c.clientWidth, h = c.clientHeight;
      if (c.width !== w * dpr || c.height !== h * dpr) { c.width = w * dpr; c.height = h * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
    }

    const { u } = this.metrics;
    const dark = document.documentElement.dataset.theme === 'dark';
    const ink = dark ? '#e7ecf3' : '#1f2933';
    const line = dark ? 'rgba(231,236,243,.35)' : 'rgba(31,41,51,.35)';

    ctx.lineJoin = 'round';
    for (let g = 0; g < u.gores; g++) {
      for (let r = 0; r < u.rows; r++) {
        const p = this.cellPoly(g, r);
        ctx.beginPath();
        ctx.moveTo(p[0][0], p[0][1]);
        for (let i = 1; i < 4; i++) ctx.lineTo(p[i][0], p[i][1]);
        ctx.closePath();
        ctx.fillStyle = hexOf(state.panels[r * state.gores + g]);
        ctx.fill();
        // Поверх заливки кладём кусок развёртки — так в раскладку попадают
        // текст и изображения ровно там же, где они легли на оболочку.
        ctx.save();
        ctx.clip();
        const src = cellRect(g, r);
        const x0 = Math.min(p[0][0], p[3][0]);
        const x1 = Math.max(p[1][0], p[2][0]);
        const y0 = Math.min(p[2][1], p[3][1]);
        const y1 = Math.max(p[0][1], p[1][1]);
        ctx.drawImage(getCanvas(), src.x, src.y, src.w, src.h, x0, y0, x1 - x0, y1 - y0);
        ctx.restore();
        const hot = this.hover && this.hover.has(r * state.gores + g);
        if (hot) {
          ctx.fillStyle = hexOf(state.active);
          ctx.globalAlpha = 0.55;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.strokeStyle = hot ? '#e8541f' : line;
        ctx.lineWidth = hot ? 2.2 : 0.6;
        ctx.stroke();
      }
    }

    // Нумерация клиньев и рядов.
    ctx.fillStyle = ink;
    ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'center';
    const { pitch } = this.metrics;
    for (let c = 0; c < u.gores; c++) {
      const [x] = this.toPx(c * pitch + u.maxW / 2, 0);
      const [, y] = this.toPx(0, u.goreLen);
      ctx.fillText(String(c + 1), x, y - 8);
    }
    ctx.textAlign = 'right';
    for (let r = 0; r < u.rows; r++) {
      const [x] = this.toPx(0, 0);
      const my = this.mode === 'grid'
        ? (r + 0.5) * this.metrics.cell
        : (u.cells[r].yBot + u.cells[r].yTop) / 2;
      const [, y] = this.toPx(0, my);
      ctx.fillText(String(r + 1), x - 8, y + 3);
    }
  }

  /** Раскладка в отдельный PNG с рамкой и подписями — для согласования. */
  exportPNG(scale = 2) {
    const u = this.env.unwrapped;
    const model = getModel(state.modelId);
    const pad = Math.round(34 * scale);
    const headH = Math.round(34 * scale);
    const footH = Math.round(24 * scale);

    // Масштаб подбираем от целевой ширины листа, а не от числа клиньев.
    const grid = this.mode === 'grid';
    const pitch = grid ? u.maxW : u.maxW + GAP;
    const totalW = grid ? pitch * u.gores : pitch * u.gores - GAP;
    const totalH = grid ? u.maxW * u.rows : u.goreLen;
    const s = Math.min(1700 * scale / totalW, 900 * scale / totalH);

    const c = document.createElement('canvas');
    c.width = Math.min(8000, Math.round(totalW * s) + pad * 2);
    c.height = Math.min(8000, Math.round(totalH * s) + pad * 2 + headH + footH);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);

    const x0 = pad;
    const y0 = pad + headH;
    const px = (xm, ym) => [x0 + xm * s, y0 + (totalH - ym) * s];

    for (let g = 0; g < u.gores; g++) {
      for (let r = 0; r < u.rows; r++) {
        const cell = u.cells[r];
        const col = colOf(g, u.gores);
        const p = grid
          ? [px(col * pitch, r * u.maxW), px((col + 1) * pitch, r * u.maxW),
             px((col + 1) * pitch, (r + 1) * u.maxW), px(col * pitch, (r + 1) * u.maxW)]
          : (() => {
            const cx = col * pitch + u.maxW / 2;
            return [
              px(cx - cell.wBot / 2, cell.yBot), px(cx + cell.wBot / 2, cell.yBot),
              px(cx + cell.wTop / 2, cell.yTop), px(cx - cell.wTop / 2, cell.yTop),
            ];
          })();
        ctx.beginPath(); ctx.moveTo(p[0][0], p[0][1]);
        for (let i = 1; i < 4; i++) ctx.lineTo(p[i][0], p[i][1]);
        ctx.closePath();
        ctx.fillStyle = hexOf(state.panels[r * state.gores + g]); ctx.fill();
        ctx.save(); ctx.clip();
        const srcR = cellRect(g, r);
        const bx0 = Math.min(p[0][0], p[3][0]);
        const bx1 = Math.max(p[1][0], p[2][0]);
        const by0 = Math.min(p[2][1], p[3][1]);
        const by1 = Math.max(p[0][1], p[1][1]);
        ctx.drawImage(getCanvas(), srcR.x, srcR.y, srcR.w, srcR.h, bx0, by0, bx1 - bx0, by1 - by0);
        ctx.restore();
        ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 0.8 * scale; ctx.stroke();
      }
    }

    // Нумерация клиньев сверху и рядов слева.
    ctx.fillStyle = '#333';
    ctx.font = `600 ${Math.round(9 * scale)}px ui-monospace, Menlo, monospace`;
    ctx.textAlign = 'center';
    for (let c = 0; c < u.gores; c++) {
      const [x] = px(c * pitch + (grid ? pitch : u.maxW) / 2, 0);
      ctx.fillText(String(c + 1), x, y0 - 5 * scale);
    }
    ctx.textAlign = 'right';
    for (let r = 0; r < u.rows; r++) {
      const my = grid ? (r + 0.5) * u.maxW : (u.cells[r].yBot + u.cells[r].yTop) / 2;
      const [, y] = px(0, my);
      ctx.fillText(String(r + 1), x0 - 4 * scale, y + 3 * scale);
    }

    ctx.fillStyle = '#111'; ctx.textAlign = 'left';
    ctx.font = `600 ${Math.round(15 * scale)}px Inter, system-ui, sans-serif`;
    ctx.fillText(`${CONTACTS.brand} · раскладка оболочки ${model.code}`, pad, Math.round(20 * scale));
    ctx.font = `${Math.round(10 * scale)}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = '#555';
    ctx.fillText(
      `${model.name} · ${model.volume} м³ · ${state.gores} клиньев × ${state.rows} рядов · ` +
      `длина клина ${u.goreLen.toFixed(2)} м · макс. ширина ${u.maxW.toFixed(2)} м · ` +
      `проект «${state.project}»`, pad, c.height - Math.round(10 * scale),
    );
    return c.toDataURL('image/png');
  }
}

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
