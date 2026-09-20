// Точка входа: сборка сцены, переключение режимов, горячие клавиши, выгрузки.

import * as scene from './scene.js';
import { LayoutView } from './layout.js';
import { UI, openCatalog } from './ui.js';
import {
  state, applyModel, restoreSaved, subscribe, undo, redo, canUndo, canRedo, touch, load,
} from './state.js';
import { getModel } from './data.js';
import { backdropURL, backdropImage } from './backdrop.js';
import {
  download, exportProject, exportCSV, printSheet, fileBase,
} from './exporters.js';

class App {
  constructor() {
    this.canvas = document.getElementById('view3d');
    this.stage = document.getElementById('stage');
    this.layoutPane = document.getElementById('layoutPane');
    this.env = null;
    this.ui = new UI(this);
  }

  start() {
    const savedTheme = localStorage.getItem('aeronatc.theme');
    if (savedTheme) state.theme = savedTheme;
    document.documentElement.dataset.theme = state.theme;
    document.getElementById('year').textContent = new Date().getFullYear();

    applyModel(state.modelId, false);
    restoreSaved();

    scene.init(this.canvas, { onPaint: () => this.afterPaint() });
    this.env = scene.rebuild();

    this.layout = new LayoutView(document.getElementById('layoutCanvas'), () => this.afterPaint());

    this.bindChrome();
    this.observeSize();
    this.setView('3d');
    scene.frameCamera();
    setTimeout(() => document.getElementById('stageHint').classList.add('fade'), 7000);

    this.ui.renderTabs();
    this.ui.renderModelCard();
    this.ui.renderBody();

    subscribe(() => this.syncHistoryButtons());
    this.syncHistoryButtons();

    const tick = () => { scene.render(); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }

  // ── Перерисовка после изменения цветов ──────────────────────────────────
  afterPaint() {
    scene.applyColors();
    if (state.view === 'layout') { this.layout.draw(); this.ui.renderUsedColors(); }
    if (state.panelTab === 'export') this.ui.renderBody();
    if (state.panelTab === 'valve') this.ui.drawValveTop();
    this.syncHistoryButtons();
  }

  refreshAll() {
    scene.applyColors();
    if (this.layout) this.layout.draw();
    this.ui.renderUsedColors();
    if (state.panelTab === 'valve') this.ui.drawValveTop();
    this.syncHistoryButtons();
  }

  onGloss() { scene.applyGloss(); touch('gloss'); }

  setModel(id) {
    applyModel(id, true);
    this.env = scene.rebuild();
    this.layout.setEnv(this.env);
    this.ui.renderModelCard();
    this.ui.renderBody();
    touch('model');
  }

  // ── Режимы ──────────────────────────────────────────────────────────────
  setView(view) {
    state.view = view;
    document.querySelectorAll('.view-tab').forEach((b) =>
      b.classList.toggle('is-active', b.dataset.view === view));

    const layoutOpen = view === 'layout';
    this.layoutPane.hidden = !layoutOpen;
    if (layoutOpen) {
      this.layout.setEnv(this.env);
      this.ui.renderLayoutSide();
    }

    const preview = view === 'preview';
    document.getElementById('panel').hidden = preview;
    document.getElementById('previewBar').hidden = !preview;
    document.querySelector('.stage-tools').hidden = preview;
    document.getElementById('stageHint').hidden = preview;
    this.applySky(preview);
    scene.setSeamsVisible(!preview && this.seamsOn !== false);
    this.resize();
  }

  applySky(force) {
    const on = force || this.sky;
    scene.setBackground(on ? 'sky' : null);
    if (on && !this.backdropSet) {
      backdropImage();                                   // прогрев для экспорта
      this.stage.style.backgroundImage = `url(${backdropURL()})`;
      this.backdropSet = true;
    }
    this.stage.classList.toggle('sky', !!on);
  }

  bindChrome() {
    document.querySelectorAll('.view-tab').forEach((b) =>
      b.addEventListener('click', () => this.setView(b.dataset.view)));

    document.getElementById('btnLayoutClose').addEventListener('click', () => this.setView('3d'));
    document.getElementById('btnPreviewExit').addEventListener('click', () => this.setView('3d'));
    document.getElementById('btnLayoutFit').addEventListener('click', () => this.layout.fit());
    document.getElementById('btnLayoutPNG').addEventListener('click', () => this.exportLayout());

    document.getElementById('btnCatalog').addEventListener('click', () =>
      openCatalog((id) => this.setModel(id)));

    document.getElementById('btnUndo').addEventListener('click', () => { undo(); this.refreshAll(); });
    document.getElementById('btnRedo').addEventListener('click', () => { redo(); this.refreshAll(); });

    document.getElementById('btnTheme').addEventListener('click', () => {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = state.theme;
      localStorage.setItem('aeronatc.theme', state.theme);
      if (this.layout) this.layout.draw();
    });

    document.getElementById('btnSave').addEventListener('click', () => this.exportPDF());
    document.getElementById('btnResetView').addEventListener('click', () => scene.frameCamera());
    document.getElementById('btnShot').addEventListener('click', () => this.exportShot());

    const basketBtn = document.getElementById('btnBasket');
    this.inBasket = false;
    basketBtn.addEventListener('click', () => {
      this.inBasket = !this.inBasket;
      basketBtn.classList.toggle('is-on', this.inBasket);
      scene.basketView(this.inBasket);
    });

    const skyBtn = document.getElementById('btnSky');
    this.sky = false;
    skyBtn.addEventListener('click', () => {
      this.sky = !this.sky;
      skyBtn.classList.toggle('is-on', this.sky);
      this.applySky();
    });

    const seams = document.getElementById('btnSeams');
    this.seamsOn = true;
    seams.classList.add('is-on');
    seams.addEventListener('click', () => {
      this.seamsOn = !this.seamsOn;
      seams.classList.toggle('is-on', this.seamsOn);
      scene.setSeamsVisible(this.seamsOn);
    });

    document.getElementById('brandHome').addEventListener('click', (e) => {
      e.preventDefault(); this.setView('3d');
    });

    window.addEventListener('keydown', (e) => {
      const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
      if (typing) return;
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        this.refreshAll();
      } else if (meta && e.key.toLowerCase() === 'y') {
        e.preventDefault(); redo(); this.refreshAll();
      } else if (e.key === 'Escape' && state.view !== '3d') {
        this.setView('3d');
      } else if (e.key === 'l' || e.key === 'д') {
        this.setView(state.view === 'layout' ? '3d' : 'layout');
      } else if (e.key === 'p' || e.key === 'з') {
        this.setView(state.view === 'preview' ? '3d' : 'preview');
      }
    });
  }

  syncHistoryButtons() {
    document.getElementById('btnUndo').disabled = !canUndo();
    document.getElementById('btnRedo').disabled = !canRedo();
  }

  observeSize() {
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(this.stage);
    ro.observe(document.getElementById('layoutCanvas'));
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const r = this.stage.getBoundingClientRect();
    scene.resize(Math.max(1, r.width), Math.max(1, r.height));
    if (this.layout && state.view === 'layout') this.layout.fit();
  }

  // ── Выгрузки ────────────────────────────────────────────────────────────
  exportShot() { download(`${fileBase()}_3d.png`, scene.snapshotPNG(1800)); }
  exportLayout() {
    if (!this.layout.env) this.layout.setEnv(this.env);
    download(`${fileBase()}_raskladka.png`, this.layout.exportPNG(2));
  }
  exportCSV() { exportCSV(this.env); }
  exportJSON() { exportProject(); }

  importJSON(text) {
    try {
      const data = JSON.parse(text);
      if (!load(data)) { alert('Это не файл проекта АэроНаТЦ.'); return; }
      this.env = scene.rebuild();
      this.layout.setEnv(this.env);
      this.ui.renderModelCard();
      this.ui.renderBody();
      this.refreshAll();
    } catch (e) {
      alert('Не удалось прочитать файл проекта.');
    }
  }

  exportPDF() {
    if (!this.layout.env) this.layout.setEnv(this.env);
    const shot3d = scene.snapshotPNG(1400);
    const shotLayout = this.layout.exportPNG(1.6);
    printSheet(this.env, shot3d, shotLayout);
  }
}

const app = new App();
app.start();
window.aeronatc = { app, state, getModel };
