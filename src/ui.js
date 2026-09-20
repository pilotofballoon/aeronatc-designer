// Интерфейс: правая панель, каталог моделей, памятка, боковая панель раскладки.

import {
  FABRICS, FABRIC_ORDER, codeOf, colorByCode, hexOf, MEMO, CONTACTS,
  CATEGORIES, CATEGORY_ORDER, modelsOf, getModel,
} from './data.js';
import { state, PRESETS, applyPreset, mark, commit, touch, spec } from './state.js';
import { silhouette } from './geometry.js';

const el = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const MODE_ICONS = {
  panel: '<rect x="4" y="4" width="7" height="7" rx="1.2" fill="currentColor"/><rect x="12.5" y="4" width="7" height="7" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="4" y="12.5" width="7" height="7" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="12.5" y="12.5" width="7" height="7" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.3"/>',
  gore: '<rect x="4" y="3" width="6" height="18" rx="1.4" fill="currentColor"/><rect x="12" y="3" width="6" height="18" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.3"/>',
  row: '<rect x="3" y="4" width="18" height="6" rx="1.4" fill="currentColor"/><rect x="3" y="12" width="18" height="6" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.3"/>',
  ring: '<rect x="3" y="4" width="4" height="6" rx="1" fill="currentColor"/><rect x="10" y="4" width="4" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="17" y="4" width="4" height="6" rx="1" fill="currentColor"/><rect x="3" y="13" width="4" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="10" y="13" width="4" height="6" rx="1" fill="currentColor"/><rect x="17" y="13" width="4" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/>',
  all: '<circle cx="12" cy="12" r="8.4" fill="currentColor"/>',
};
const MODES = [
  ['panel', 'Полотнище'], ['gore', 'Клин'], ['row', 'Ряд'], ['ring', 'Через один'], ['all', 'Всё'],
];

export class UI {
  constructor(app) {
    this.app = app;
    this.body = document.getElementById('panelBody');
    this.tabs = document.getElementById('panelTabs');
    this.tabs.addEventListener('click', (e) => {
      const b = e.target.closest('.ptab');
      if (!b) return;
      state.panelTab = b.dataset.tab;
      this.renderTabs();
      this.renderBody();
    });
  }

  renderTabs() {
    this.tabs.querySelectorAll('.ptab').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.tab === state.panelTab);
    });
  }

  renderModelCard() {
    const m = getModel(state.modelId);
    const d = this.app.env ? this.app.env.dims : null;
    document.getElementById('modelCode').textContent = m.code;
    const meta = document.getElementById('modelMeta');
    meta.innerHTML = [
      `<span><b>${m.volume}</b> м³</span>`,
      d ? `<span><b>${d.H.toFixed(1)}</b> м высота</span>` : '',
      d ? `<span><b>${d.D.toFixed(1)}</b> м диаметр</span>` : '',
      `<span><b>${state.gores}</b> клиньев</span>`,
      `<span><b>${state.rows}</b> рядов</span>`,
      `<span>${esc(m.crew)}</span>`,
    ].join('');
    document.getElementById('layoutModel').textContent = `${m.code} · ${state.gores}×${state.rows}`;
  }

  // ── Палитра ──────────────────────────────────────────────────────────────
  activeColorCard() {
    const c = colorByCode(state.active);
    return `<div class="active-color">
      <span class="dot" style="background:${c.hex}"></span>
      <span class="meta"><b>${esc(c.ru)}</b><span>${esc(c.en)} · ${esc(c.fabricLabel)}</span></span>
      <span class="code">${c.code}</span>
    </div>`;
  }

  swatchesHTML() {
    return FABRIC_ORDER.map((fid) => {
      const f = FABRICS[fid];
      const sw = f.colors.map((c) => {
        const code = codeOf(fid, c.n);
        return `<button class="sw${code === state.active ? ' is-active' : ''}"
          style="background:${c.hex}" data-code="${code}"
          title="${code} · ${esc(c.ru)} / ${esc(c.en)}"></button>`;
      }).join('');
      return `<div class="section">
        <div class="fabric-head"><h4 style="margin:0">${esc(f.label)}</h4><span>${f.colors.length} цветов</span></div>
        <div class="swatches">${sw}</div>
      </div>`;
    }).join('');
  }

  bindSwatches(root, onPick) {
    root.querySelectorAll('.sw').forEach((b) => {
      b.addEventListener('click', () => {
        onPick(b.dataset.code);
        root.querySelectorAll('.sw').forEach((x) => x.classList.toggle('is-active', x === b));
      });
    });
  }

  // ── Вкладки панели ───────────────────────────────────────────────────────
  renderBody() {
    const tab = state.panelTab;
    if (tab === 'color') this.renderColor();
    else if (tab === 'valve') this.renderValve();
    else if (tab === 'fabric') this.renderFabric();
    else if (tab === 'memo') this.renderMemo();
    else this.renderExport();
  }

  renderColor() {
    const modes = MODES.map(([id, label]) => `
      <button class="mode${state.paintMode === id ? ' is-active' : ''}" data-mode="${id}">
        <svg viewBox="0 0 24 24" aria-hidden="true">${MODE_ICONS[id]}</svg>${label}
      </button>`).join('');

    const presets = PRESETS.map((p) =>
      `<button class="preset" data-preset="${p.id}">${p.label}</button>`).join('');

    this.body.innerHTML = `
      <div class="section">
        <h4>Что красим кликом</h4>
        <div class="modes" id="modes">${modes}</div>
        <p class="hint">Клик по 3D-модели красит выбранную область активным цветом.
          Режим «Через один» — чередование полотнищ в ряду.</p>
      </div>

      ${this.activeColorCard()}
      <div id="palette">${this.swatchesHTML()}</div>

      <div class="section">
        <h4>Раскраски</h4>
        <div class="presets" id="presets">${presets}</div>
        <p class="hint">Раскраска строится из активного и дополнительного цвета.
          Дополнительный — <b id="secName">${esc(colorByCode(state.secondary).ru)}</b>,
          <button class="link" id="swapSecondary" style="margin:0">поменять местами</button>.</p>
      </div>

      <div class="section">
        <h4>Юбка</h4>
        <div class="rows">
          <button class="btn block" id="fillSkirt">Залить юбку активным цветом</button>
          <button class="btn block" id="altSkirt">Залить юбку через один</button>
        </div>
        <p class="hint">Или кликайте по сегментам юбки прямо на 3D-модели.</p>
      </div>

      <div class="section">
        <h4>Воздухозаборник</h4>
        <button class="btn block" id="fillMouth">Залить воздухозаборник</button>
        <p class="hint">Меш между гондолой и горловиной оболочки.</p>
      </div>

      <div class="section">
        <h4>Глянец ткани</h4>
        <div class="slider-row">
          <input type="range" id="gloss" min="0" max="100" value="${Math.round(state.gloss * 100)}">
          <output id="glossOut">${Math.round(state.gloss * 100)}%</output>
        </div>
        <div class="scale-ends"><span>матовая</span><span>глянцевая</span></div>
        <p class="hint">Таффета с силиконовым покрытием бликует заметнее, чем PU.</p>
      </div>

      <div class="section">
        <h4>Силовые ленты</h4>
        <label class="switch"><input type="checkbox" id="tapes" ${state.tapes ? 'checked' : ''}>
          Показать ленты по швам клиньев</label>
        <p class="hint">Вертикальные силовые ленты идут по швам между клиньями и несут нагрузку оболочки.</p>
      </div>

      <div class="section rows">
        <button class="btn block danger" id="resetColors">Сбросить все цвета</button>
      </div>`;

    const app = this.app;

    this.body.querySelector('#modes').addEventListener('click', (e) => {
      const b = e.target.closest('.mode');
      if (!b) return;
      state.paintMode = b.dataset.mode;
      this.renderBody();
    });

    this.bindSwatches(this.body.querySelector('#palette'), (code) => {
      state.active = code;
      this.body.querySelector('.active-color').outerHTML = this.activeColorCard();
    });

    this.body.querySelector('#presets').addEventListener('click', (e) => {
      const b = e.target.closest('.preset');
      if (!b) return;
      applyPreset(b.dataset.preset, [state.active, state.secondary, hexPairThird()]);
      app.refreshAll();
    });

    this.body.querySelector('#swapSecondary').addEventListener('click', () => {
      const a = state.active; state.active = state.secondary; state.secondary = a;
      this.renderBody();
    });

    this.body.querySelector('#fillSkirt').addEventListener('click', () => {
      mark(); state.skirt = state.skirt.map(() => state.active); commit('skirt'); app.refreshAll();
    });
    this.body.querySelector('#altSkirt').addEventListener('click', () => {
      mark();
      state.skirt = state.skirt.map((c, i) => (i % 2 ? state.secondary : state.active));
      commit('skirt'); app.refreshAll();
    });
    this.body.querySelector('#fillMouth').addEventListener('click', () => {
      mark(); state.mouth = state.active; commit('mouth'); app.refreshAll();
    });

    const gloss = this.body.querySelector('#gloss');
    gloss.addEventListener('input', () => {
      state.gloss = gloss.value / 100;
      this.body.querySelector('#glossOut').textContent = `${gloss.value}%`;
      app.onGloss();
    });

    this.body.querySelector('#tapes').addEventListener('change', (e) => {
      state.tapes = e.target.checked; touch('tapes'); app.refreshAll();
    });

    this.body.querySelector('#resetColors').addEventListener('click', () => {
      mark();
      state.panels = state.panels.map(() => 'S05');
      state.valve = state.valve.map(() => 'S05');
      state.skirt = state.skirt.map(() => 'S03');
      state.mouth = 'P17';
      commit('reset'); app.refreshAll();
    });
  }

  renderValve() {
    this.body.innerHTML = `
      <div class="section">
        <h4>Парашютный клапан</h4>
        <p class="hint" style="margin-top:0">Клапан собран из ${state.valveSegs} секторов.
          Выберите цвет и кликайте по секторам на 3D-модели — или залейте целиком.</p>
      </div>
      ${this.activeColorCard()}
      <div id="palette">${this.swatchesHTML()}</div>
      <div class="section rows">
        <button class="btn block" id="fillValve">Залить весь клапан</button>
        <button class="btn block" id="altValve">Залить через сектор</button>
      </div>
      <div class="section">
        <h4>Вид сверху</h4>
        <div id="valveTop" style="display:grid;place-items:center;padding:8px 0"></div>
        <p class="hint">Схема раскладки клапана сверху — так его увидит зритель снизу при открытии.</p>
      </div>`;

    this.bindSwatches(this.body.querySelector('#palette'), (code) => {
      state.active = code;
      this.body.querySelector('.active-color').outerHTML = this.activeColorCard();
    });
    this.body.querySelector('#fillValve').addEventListener('click', () => {
      mark(); state.valve = state.valve.map(() => state.active); commit('valve');
      this.app.refreshAll();
    });
    this.body.querySelector('#altValve').addEventListener('click', () => {
      mark();
      state.valve = state.valve.map((c, i) => (i % 2 ? state.secondary : state.active));
      commit('valve'); this.app.refreshAll();
    });
    this.drawValveTop();
  }

  drawValveTop() {
    const host = this.body.querySelector('#valveTop');
    if (!host) return;
    const n = state.valveSegs, R = 62, C = 70;
    const segs = state.valve.map((code, i) => {
      const a0 = (i / n) * Math.PI * 2 - Math.PI / 2;
      const a1 = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2;
      const p = (a, r) => `${(C + r * Math.cos(a)).toFixed(1)},${(C + r * Math.sin(a)).toFixed(1)}`;
      return `<path d="M${C},${C}L${p(a0, R)}A${R},${R} 0 0 1 ${p(a1, R)}Z"
        fill="${hexOf(code)}" stroke="rgba(0,0,0,.28)" stroke-width="0.7"/>`;
    }).join('');
    host.innerHTML = `<svg viewBox="0 0 140 140" width="150" height="150">${segs}
      <circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="1.2"/>
      <circle cx="${C}" cy="${C}" r="8" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="1.2"/></svg>`;
  }

  renderFabric() {
    const blocks = FABRIC_ORDER.map((fid) => {
      const f = FABRICS[fid];
      const rows = f.colors.map((c) => `<tr>
        <td><span class="chipc" style="background:${c.hex}"></span>${codeOf(fid, c.n)}</td>
        <td>${esc(c.ru)}</td><td style="color:var(--ink-3)">${esc(c.en)}</td>
        <td class="num" style="font-family:ui-monospace,Menlo,monospace">${c.hex}</td>
      </tr>`).join('');
      return `<div class="section">
        <h4>${esc(f.label)}</h4>
        <p class="hint" style="margin:0 0 6px">${esc(f.note)}</p>
        <table class="spec"><thead><tr><th>Код</th><th>Цвет</th><th>Название</th><th class="num">HEX</th></tr></thead>
        <tbody>${rows}</tbody></table>
      </div>`;
    }).join('');

    this.body.innerHTML = `
      <p class="hint" style="margin-top:0">Карта тканей АэроНаТЦ. Оттенки на экране справочные —
        окончательное согласование по образцу выкраски.</p>
      ${blocks}`;
  }

  renderMemo() {
    const sections = MEMO.sections.map((s) => `
      <h5>${esc(s.h)}</h5>
      <ul>${s.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`).join('');
    this.body.innerHTML = `<div class="memo">
      <h4 style="font-size:13px;text-transform:none;letter-spacing:0;color:var(--ink)">${esc(MEMO.title)}</h4>
      <p class="hint" style="margin-top:2px">${esc(MEMO.subtitle)}</p>
      ${sections}
      <p class="hint" style="margin-top:16px">${esc(CONTACTS.full)} · ${CONTACTS.phone} · ${CONTACTS.site}</p>
    </div>`;
  }

  renderExport() {
    const items = spec(this.app.env);
    const rows = items.map((i) => {
      const c = colorByCode(i.code);
      if (!c) return '';
      return `<tr>
        <td><span class="chipc" style="background:${c.hex}"></span>${c.code}</td>
        <td>${esc(c.ru)}</td>
        <td style="color:var(--ink-3);font-size:10.5px">${[...i.parts].join(', ')}</td>
        <td class="num">${i.panels}</td>
        <td class="num">${i.area ? i.area.toFixed(1) : '—'}</td>
      </tr>`;
    }).join('');

    this.body.innerHTML = `
      <div class="section">
        <h4>Проект</h4>
        <label class="field"><span>Название</span>
          <input id="projName" value="${esc(state.project)}" placeholder="Например: АХ-8 для клуба"></label>
        <label class="field"><span>Заказчик</span>
          <input id="projCustomer" value="${esc(state.customer)}" placeholder="Организация или ФИО"></label>
      </div>

      <div class="section rows">
        <h4>Выгрузки</h4>
        <button class="btn block primary" id="expPDF">Комплект на согласование (PDF)</button>
        <button class="btn block" id="expPNG3D">3D-вид · PNG</button>
        <button class="btn block" id="expPNGLayout">Раскладка · PNG</button>
        <button class="btn block" id="expCSV">Карта цветов · CSV</button>
        <button class="btn block" id="expJSON">Проект · JSON</button>
        <button class="btn block" id="impJSON">Загрузить проект</button>
        <input type="file" id="fileJSON" accept="application/json" hidden>
      </div>

      <div class="section">
        <h4>Спецификация ткани</h4>
        <table class="spec">
          <thead><tr><th>Код</th><th>Цвет</th><th>Узел</th><th class="num">Полотн.</th><th class="num">м²</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p class="hint">Площадь по развёртке, без припусков на швы и усиления.</p>
      </div>`;

    const app = this.app;
    const name = this.body.querySelector('#projName');
    name.addEventListener('change', () => { state.project = name.value.trim() || 'Без названия'; touch(); });
    const cust = this.body.querySelector('#projCustomer');
    cust.addEventListener('change', () => { state.customer = cust.value.trim(); touch(); });

    this.body.querySelector('#expPDF').addEventListener('click', () => app.exportPDF());
    this.body.querySelector('#expPNG3D').addEventListener('click', () => app.exportShot());
    this.body.querySelector('#expPNGLayout').addEventListener('click', () => app.exportLayout());
    this.body.querySelector('#expCSV').addEventListener('click', () => app.exportCSV());
    this.body.querySelector('#expJSON').addEventListener('click', () => app.exportJSON());
    const file = this.body.querySelector('#fileJSON');
    this.body.querySelector('#impJSON').addEventListener('click', () => file.click());
    file.addEventListener('change', () => {
      const f = file.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => app.importJSON(rd.result);
      rd.readAsText(f);
    });
  }

  // ── Боковая панель раскладки ─────────────────────────────────────────────
  renderLayoutSide() {
    const side = document.getElementById('layoutSide');
    const modes = MODES.map(([id, label]) => `
      <button class="mode${state.paintMode === id ? ' is-active' : ''}" data-mode="${id}">
        <svg viewBox="0 0 24 24" aria-hidden="true">${MODE_ICONS[id]}</svg>${label}
      </button>`).join('');

    side.innerHTML = `
      <div class="section"><h4>Что красим</h4><div class="modes" id="lmodes">${modes}</div></div>
      ${this.activeColorCard()}
      <div id="lpalette">${this.swatchesHTML()}</div>
      <div class="section">
        <h4>Использованные цвета</h4>
        <div id="usedColors"></div>
      </div>
      <p class="hint">Колёсико мыши — масштаб, перетаскивание — сдвиг.
        Номера сверху — клинья, слева — ряды снизу вверх.</p>`;

    side.querySelector('#lmodes').addEventListener('click', (e) => {
      const b = e.target.closest('.mode');
      if (!b) return;
      state.paintMode = b.dataset.mode;
      this.renderLayoutSide();
    });
    this.bindSwatches(side.querySelector('#lpalette'), (code) => {
      state.active = code;
      side.querySelector('.active-color').outerHTML = this.activeColorCard();
    });
    this.renderUsedColors();
  }

  renderUsedColors() {
    const host = document.getElementById('usedColors');
    if (!host) return;
    const items = spec(this.app.env).filter((i) => i.env > 0);
    host.innerHTML = items.length
      ? `<table class="spec"><tbody>${items.map((i) => {
          const c = colorByCode(i.code);
          return c ? `<tr><td><span class="chipc" style="background:${c.hex}"></span>${c.code}</td>
            <td>${esc(c.ru)}</td><td class="num">${i.env}</td></tr>` : '';
        }).join('')}</tbody></table>`
      : '<p class="hint">— нет данных —</p>';
  }
}

function hexPairThird() {
  // Третий цвет для трёхцветных раскрасок — белый, если активные не белые.
  return state.active === 'S05' || state.secondary === 'S05' ? 'S11' : 'S05';
}

// ── Каталог моделей ────────────────────────────────────────────────────────
export function openCatalog(onPick) {
  let cat = getModel(state.modelId).category;

  const overlay = el(`<div class="overlay"><div class="modal">
    <div class="modal-head">
      <div>
        <h2>Каталог оболочек АэроНаТЦ</h2>
        <p id="catCount"></p>
      </div>
      <button class="icon-btn" data-close aria-label="Закрыть">
        <svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>
    </div>
    <div class="modal-body">
      <div class="cats" id="cats"></div>
      <p class="cat-note" id="catNote"></p>
      <div class="cards" id="cards"></div>
    </div>
  </div></div>`);

  const total = CATEGORY_ORDER.reduce((s, c) => s + modelsOf(c).length, 0);
  overlay.querySelector('#catCount').textContent =
    `${total} оболочек в ${CATEGORY_ORDER.length} категориях · объём, число клиньев и вес — по данным завода`;

  const cats = overlay.querySelector('#cats');
  cats.innerHTML = CATEGORY_ORDER.map((id) =>
    `<button class="cat" data-cat="${id}"><b>${CATEGORIES[id].label}</b>
      <span class="n">${modelsOf(id).length}</span></button>`).join('');

  const cards = overlay.querySelector('#cards');
  const note = overlay.querySelector('#catNote');

  const paint = () => {
    cats.querySelectorAll('.cat').forEach((b) => b.classList.toggle('is-active', b.dataset.cat === cat));
    note.textContent = CATEGORIES[cat].description;
    cards.innerHTML = modelsOf(cat).map((m) => {
      const s = silhouette(m);
      const tags = [
        `${m.volume} м³`, `${m.gores} клиньев`,
        `${s.dims.H.toFixed(1)}×${s.dims.D.toFixed(1)} м`,
        m.mass ? `${m.mass} кг` : 'вес по расчёту',
      ];
      return `<button class="card${m.id === state.modelId ? ' is-active' : ''}" data-id="${m.id}">
        ${m.id === state.modelId ? '<span class="badge">активна</span>' : ''}
        <figure><svg viewBox="0 0 ${s.W} ${s.H}" aria-hidden="true">
          <path d="${s.outline}" fill="none" stroke="currentColor" stroke-width="1.4"/>
          <path d="${s.meridians}" fill="none" stroke="currentColor" stroke-width="0.6" opacity=".55"/>
          <path d="${s.rings}" fill="none" stroke="currentColor" stroke-width="0.4" opacity=".35"/>
          <path d="${s.basket}" fill="none" stroke="currentColor" stroke-width="1.2"/>
        </svg></figure>
        <div class="body">
          <b>${esc(m.name)}</b><code>${esc(m.code)} · ${esc(m.crew)}</code>
          <div class="tags">${tags.map((t) => `<span class="tag">${t}</span>`).join('')}</div>
        </div>
      </button>`;
    }).join('');
  };

  cats.addEventListener('click', (e) => {
    const b = e.target.closest('.cat');
    if (!b) return;
    cat = b.dataset.cat; paint();
  });

  cards.addEventListener('click', (e) => {
    const b = e.target.closest('.card');
    if (!b) return;
    close();
    onPick(b.dataset.id);
  });

  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('[data-close]')) close();
  });
  document.addEventListener('keydown', onKey);

  paint();
  document.getElementById('modalRoot').appendChild(overlay);
}
