// Выгрузки: PNG, JSON-проект, карта цветов, спецификация и печатная форма PDF.

import { state, serialize, spec } from './state.js';
import { colorByCode, getModel, CONTACTS } from './data.js';

export function download(name, href) {
  const a = document.createElement('a');
  a.href = href; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
}

export function downloadText(name, text, mime = 'application/json') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  download(name, url);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const slug = (s) => (s || 'proekt').replace(/[^\wа-яА-ЯёЁ-]+/g, '_').slice(0, 40);

export function fileBase() {
  const m = getModel(state.modelId);
  return `aeronatc_${slug(m.name)}_${slug(state.project)}`;
}

export function exportProject() {
  downloadText(`${fileBase()}.json`, JSON.stringify(serialize(), null, 2));
}

/** Карта цветов в CSV — для раскройного цеха. */
export function exportCSV(env) {
  const rows = [['клин', 'ряд', 'код', 'ткань', 'цвет', 'hex']];
  for (let r = 0; r < state.rows; r++) {
    for (let g = 0; g < state.gores; g++) {
      const c = colorByCode(state.panels[r * state.gores + g]);
      if (!c) continue;
      // Номер клина — как в раскладке: слева направо при взгляде снаружи.
      rows.push([state.gores - g, r + 1, c.code, c.fabricLabel, `${c.ru} / ${c.en}`, c.hex]);
    }
  }
  state.valve.forEach((code, i) => {
    const c = colorByCode(code);
    if (c) rows.push([`клапан-${i + 1}`, '', c.code, c.fabricLabel, `${c.ru} / ${c.en}`, c.hex]);
  });
  state.scoop.forEach((code, i) => {
    const c = colorByCode(code);
    if (c) rows.push([`воздухозаборник-${i + 1}`, '', c.code, c.fabricLabel, `${c.ru} / ${c.en}`, c.hex]);
  });
  const csv = '﻿' + rows.map((r) => r.join(';')).join('\r\n');
  downloadText(`${fileBase()}_karta-cvetov.csv`, csv, 'text/csv');
}

/**
 * Печатная форма: титул, 3D-вид, раскладка, спецификация ткани и памятка.
 * Открывается окно печати — сохранение в PDF делает сам браузер.
 */
export function printSheet(env, shots, shotLayout) {
  const m = getModel(state.modelId);
  const d = env.dims;
  const items = spec(env);
  const totalArea = items.reduce((s, i) => s + i.area, 0);
  const totalPieces = items.reduce((s, i) => s + i.panels, 0);

  const specRows = items.map((i) => {
    const c = colorByCode(i.code);
    if (!c) return '';
    return `<tr>
      <td><span class="sw" style="background:${c.hex}"></span>${c.code}</td>
      <td>${c.ru}<span class="en"> · ${c.en}</span></td>
      <td>${c.fabricLabel}</td>
      <td>${[...i.parts].join(', ')}</td>
      <td class="num">${i.panels}</td>
      <td class="num">${i.area ? i.area.toFixed(1) : '—'}</td>
    </tr>`;
  }).join('');

  const views = shots.filter(Boolean).map((v) => `
    <figure><img src="${v.url}" alt="${v.label}"><figcaption>${v.label}</figcaption></figure>
  `).join('');

  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8">
  <title>${CONTACTS.brand} — дизайн оболочки ${m.code}</title>
  <style>
    @page { size: A4; margin: 12mm; }
    body { font: 12px/1.45 Inter, system-ui, sans-serif; color: #15191f; }
    h1 { font-size: 20px; margin: 0 0 2px; }
    h2 { font-size: 13px; margin: 16px 0 8px; border-bottom: 1px solid #d7dce3; padding-bottom: 4px; }
    .head { display: flex; justify-content: space-between; align-items: flex-start;
            border-bottom: 2px solid #15191f; padding-bottom: 8px; }
    .muted { color: #667; font-size: 11px; }
    .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 10px 0 4px; }
    .grid div { background: #f3f5f8; border-radius: 6px; padding: 7px 9px; }
    .grid b { display: block; font-size: 15px; }
    .views { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .views figure { margin: 0; }
    .views img { width: 100%; display: block; border: 1px solid #d7dce3; border-radius: 6px; }
    .views figcaption { font-size: 10px; color: #667; padding-top: 3px; text-align: center; }
    img.layout { max-width: 100%; border: 1px solid #d7dce3; border-radius: 6px; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #e3e7ec; }
    th { background: #f3f5f8; }
    .num { text-align: right; }
    .sw { display: inline-block; width: 11px; height: 11px; border-radius: 3px;
          border: 1px solid rgba(0,0,0,.25); margin-right: 6px; vertical-align: -1px; }
    .en { color: #889; }
    .page { page-break-before: always; }
    .sign { margin-top: 22px; font-size: 11px; color: #445; }
  </style></head><body>
    <div class="head">
      <div>
        <h1>${CONTACTS.brand} · дизайн оболочки</h1>
        <div class="muted">${CONTACTS.full} · ${CONTACTS.phone} · ${CONTACTS.site}</div>
      </div>
      <div class="muted" style="text-align:right">
        Проект: <b>${state.project}</b><br>${state.customer ? `Заказчик: ${state.customer}<br>` : ''}
        ${new Date().toLocaleDateString('ru-RU')}
      </div>
    </div>

    <div class="grid">
      <div><span class="muted">Модель</span><b>${m.name}</b>${m.code}</div>
      <div><span class="muted">Объём</span><b>${m.volume} м³</b>класс ${m.ax}</div>
      <div><span class="muted">Габариты</span><b>${d.H.toFixed(1)} × ${d.D.toFixed(1)} м</b>высота × диаметр</div>
      <div><span class="muted">Раскрой</span><b>${state.gores} × ${state.rows}</b>клиньев × рядов</div>
    </div>

    <div class="views">${views}</div>

    <div class="page"></div>
    <h2>Плоская раскладка</h2>
    <img class="layout" src="${shotLayout}" alt="Раскладка">

    <div class="page"></div>
    <h2>Спецификация ткани</h2>
    <table>
      <thead><tr><th>Код</th><th>Цвет</th><th>Ткань</th><th>Узел</th>
        <th class="num">Полотнищ</th><th class="num">Площадь, м²</th></tr></thead>
      <tbody>${specRows}</tbody>
      <tfoot><tr><th colspan="4">Итого раскройных деталей</th>
        <th class="num">${totalPieces}</th>
        <th class="num">${totalArea.toFixed(1)}</th></tr></tfoot>
    </table>

    <p class="sign">
      Согласовано: ___________________ / ___________________ &nbsp;&nbsp;
      «___» ____________ 20___ г.
    </p>
    <script>window.addEventListener('load', () => setTimeout(() => window.print(), 350));<\/script>
  </body></html>`;

  const w = window.open('', '_blank');
  if (!w) { alert('Разрешите всплывающие окна, чтобы сохранить PDF.'); return; }
  w.document.write(html);
  w.document.close();
}
