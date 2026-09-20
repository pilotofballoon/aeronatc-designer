// 3D-сцена: оболочка, клапан, юбка, воздухозаборник, гондола. Клик красит элемент.

import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import {
  buildEnvelope, buildSeams, buildTapes, buildValve, buildScoop, unwrap,
  rigSpec, scoopSegForGore, BASKET_H, UPRIGHT_H, BURNER_H, PILOT_H,
} from './geometry.js';
import { getModel, hexOf } from './data.js';
import { state, mark, commit, selectedDecal } from './state.js';
import { drawBackdrop } from './backdrop.js';
import * as atlas from './atlas.js';

let renderer, scene, camera, controls, raycaster;
let group, envMesh, seamLines, tapeMesh, valveMesh, scoopMesh, rig;
let savedView = null;
let env = null;
let onPaint = null;
const pointer = new THREE.Vector2();
const tmpColor = new THREE.Color();

export function getEnv() { return env; }

export function init(canvas, opts = {}) {
  onPaint = opts.onPaint || null;

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(38, 1, 0.1, 2000);
  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 8;
  controls.maxPolarAngle = Math.PI * 0.92;

  raycaster = new THREE.Raycaster();

  const hemi = new THREE.HemisphereLight(0xffffff, 0x9aa7b4, 1.5);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.position.set(1, 1.35, 0.9);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xdfe9ff, 0.65);
  fill.position.set(-1.2, 0.35, -0.8);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 0.5);
  rim.position.set(-0.4, -0.9, -1);
  scene.add(rim);

  group = new THREE.Group();
  scene.add(group);

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerleave', onPointerLeave);
  return { renderer, scene, camera, controls };
}

// Небо — фон сцены под прозрачным канвасом. 3D-купол на больших радиусах
// ведёт себя по-разному на разных GPU, поэтому фон делаем средствами CSS,
// а при выгрузке PNG подкладываем ту же заливку под кадр.
let skyOn = false;

export function setBackground(kind) {
  skyOn = kind === 'sky';
  scene.background = null;
  return skyOn;
}

export const isSky = () => skyOn;

function disposeGroup() {
  group.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
      else o.material.dispose();
    }
  });
  group.clear();
}

/** Пересобрать всю модель под текущую запись каталога. */
export function rebuild() {
  const model = getModel(state.modelId);
  disposeGroup();

  env = buildEnvelope(model);
  env.unwrapped = unwrap(env);
  env.model = model;

  atlas.bindEnv(env);
  const fabric = new THREE.MeshStandardMaterial({
    map: atlas.getTexture(), roughness: 0.78, metalness: 0.0, side: THREE.DoubleSide,
  });
  envMesh = new THREE.Mesh(env.geometry, fabric);
  envMesh.userData.kind = 'envelope';
  group.add(envMesh);

  seamLines = new THREE.LineSegments(
    buildSeams(env),
    new THREE.LineBasicMaterial({ color: 0x1f2933, transparent: true, opacity: 0.18 }),
  );
  seamLines.renderOrder = 2;
  group.add(seamLines);

  tapeMesh = new THREE.Mesh(
    buildTapes(env),
    new THREE.MeshStandardMaterial({ color: 0x20242b, roughness: 0.6, side: THREE.DoubleSide }),
  );
  tapeMesh.visible = state.tapes;
  group.add(tapeMesh);

  const v = buildValve(env);
  valveMesh = new THREE.Mesh(v.geometry, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.72, side: THREE.DoubleSide,
  }));
  valveMesh.userData = { kind: 'valve', ranges: v.ranges, segs: v.segs };
  group.add(valveMesh);

  const spec = rigSpec(env);
  env.rig = spec;

  const sc = buildScoop(env, spec);
  scoopMesh = new THREE.Mesh(sc.geometry, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.82, side: THREE.DoubleSide,
  }));
  scoopMesh.userData = { kind: 'scoop', ranges: sc.ranges };
  group.add(scoopMesh);

  buildBasketRig(spec);
  applyColors();
  applyGloss();
  frameCamera();
  return env;
}

// ─── Гондола, горелка, пилот, стропы ──────────────────────────────────────────
// Габариты плетёной гондолы берутся из каталога АэроНаТЦ (110×105 … 192×136 см),
// поэтому корзина меняет размер вместе с моделью и задаёт честный масштаб.

function roundedRect(w, d, r) {
  const s = new THREE.Shape();
  const x = w / 2, z = d / 2;
  s.moveTo(-x + r, -z);
  s.lineTo(x - r, -z); s.absarc(x - r, -z + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x, z - r); s.absarc(x - r, z - r, r, 0, Math.PI / 2, false);
  s.lineTo(-x + r, z); s.absarc(-x + r, z - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-x, -z + r); s.absarc(-x + r, -z + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

function prism(w, d, h, y, material) {
  const geo = new THREE.ExtrudeGeometry(roundedRect(w, d, Math.min(w, d) * 0.22), {
    depth: h, bevelEnabled: false, curveSegments: 6,
  });
  // После поворота выдавливание ложится в диапазон y…y+h.
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, y, 0);
  return new THREE.Mesh(geo, material);
}

// Плетение ротанга генерируем на канвасе — ни одного внешнего файла.
let wickerTex = null;
function wicker() {
  if (wickerTex) return wickerTex;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#a8783f'; g.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 8) {
    for (let x = 0; x < 128; x += 16) {
      const off = (y / 8) % 2 ? 8 : 0;
      g.fillStyle = (y / 8) % 2 ? '#b9884a' : '#96682f';
      g.beginPath();
      g.ellipse(x + off + 8, y + 4, 7.2, 3.2, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.strokeStyle = 'rgba(70,45,20,.35)'; g.lineWidth = 1.4;
  for (let x = 0; x < 128; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 128); g.stroke(); }
  wickerTex = new THREE.CanvasTexture(c);
  wickerTex.colorSpace = THREE.SRGBColorSpace;
  wickerTex.wrapS = wickerTex.wrapT = THREE.RepeatWrapping;
  wickerTex.repeat.set(4, 2);
  return wickerTex;
}

// Пилот — масштабный силуэт, всегда лицом к камере.
let pilotTex = null;
function pilotSprite() {
  if (!pilotTex) {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#2f3845';
    g.beginPath(); g.arc(64, 34, 22, 0, Math.PI * 2); g.fill();          // голова
    g.beginPath();                                                        // торс
    g.moveTo(40, 62); g.lineTo(88, 62); g.lineTo(94, 150); g.lineTo(34, 150); g.closePath(); g.fill();
    g.fillRect(24, 66, 14, 78);                                           // руки
    g.fillRect(90, 66, 14, 78);
    g.fillRect(44, 150, 17, 100);                                         // ноги
    g.fillRect(67, 150, 17, 100);
    pilotTex = new THREE.CanvasTexture(c);
    pilotTex.colorSpace = THREE.SRGBColorSpace;
  }
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: pilotTex, transparent: true, opacity: 0.88, depthWrite: false,
  }));
  sp.scale.set(PILOT_H * 0.5, PILOT_H, 1);
  return sp;
}

function buildBasketRig(spec) {
  const { b, yFrame, yRim, yFloor, ux, uz, mouthR } = spec;

  rig = new THREE.Group();

  const wickerMat = new THREE.MeshStandardMaterial({ map: wicker(), roughness: 0.95 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.75 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa1a9, roughness: 0.35, metalness: 0.75 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xb98b39, roughness: 0.4, metalness: 0.8 });

  // Плетение и кожаная обвязка по верху и низу.
  rig.add(prism(b.w, b.d, BASKET_H, yFloor, wickerMat));
  rig.add(prism(b.w * 1.03, b.d * 1.03, 0.11, yRim - 0.11, leather));
  rig.add(prism(b.w * 1.02, b.d * 1.02, 0.07, yFloor, leather));

  // Стойки рамы горелки по углам и верхняя рамка.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const up = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, UPRIGHT_H, 8), steel);
      up.position.set(sx * ux, yRim + UPRIGHT_H / 2, sz * uz);
      rig.add(up);
    }
  }
  rig.add(prism(b.w * 0.72, b.d * 0.72, 0.06, yFrame, steel));

  const burner = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, BURNER_H, 14), brass);
  burner.position.y = yFrame + BURNER_H / 2;
  rig.add(burner);

  // Топливные баллоны по углам внутри корзины.
  for (const sx of [-1, 1]) {
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, BASKET_H * 0.8, 12), steel);
    cyl.position.set(sx * (b.w / 2 - 0.24), yFloor + BASKET_H * 0.42, b.d / 2 - 0.24);
    rig.add(cyl);
  }

  const pilot = pilotSprite();
  pilot.position.set(-b.w * 0.2, yFloor + PILOT_H / 2 + 0.05, b.d * 0.05);
  rig.add(pilot);

  // От каждой стойки к оболочке идут три троса.
  const pts = [];
  const SPREAD = THREE.MathUtils.degToRad(26);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const cx = sx * ux, cz = sz * uz;
      const base = Math.atan2(cz, cx);
      for (const k of [-1, 0, 1]) {
        const a = base + k * SPREAD;
        pts.push(cx, yFrame, cz, mouthR * Math.cos(a), 0, mouthR * Math.sin(a));
      }
    }
  }
  const cg = new THREE.BufferGeometry();
  cg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  rig.add(new THREE.LineSegments(cg, new THREE.LineBasicMaterial({
    color: 0x2f3946, transparent: true, opacity: 0.65,
  })));

  rig.userData = { yFloor, yRim, yFrame, basket: b, pilot };
  group.add(rig);
}

/** Перекрасить все вершины по карте цветов. */
export function applyColors() {
  if (!env) return;
  // Нижний ряд полотнищ идёт той же тканью, что и воздухозаборник.
  if (state.linkBottom) {
    for (let g = 0; g < state.gores; g++) {
      state.panels[g] = state.scoop[scoopSegForGore(g, state.gores)];
    }
  }
  atlas.redrawBase(env);

  paintRanges(valveMesh, state.valve);
  paintRanges(scoopMesh, state.scoop);

  tapeMesh.visible = state.tapes;
  tmpColor.set(hexOf(state.tapeColor)).convertSRGBToLinear();
  tapeMesh.material.color.copy(tmpColor);
}

function paintRanges(mesh, codes) {
  if (!mesh) return;
  const attr = mesh.geometry.getAttribute('color');
  const arr = attr.array;
  mesh.userData.ranges.forEach(([start, count], i) => {
    tmpColor.set(hexOf(codes[i] || codes[0])).convertSRGBToLinear();
    for (let k = start; k < start + count; k++) {
      arr[k * 3] = tmpColor.r; arr[k * 3 + 1] = tmpColor.g; arr[k * 3 + 2] = tmpColor.b;
    }
  });
  attr.needsUpdate = true;
}

export function applyGloss() {
  if (!envMesh) return;
  const r = 0.95 - state.gloss * 0.72;
  envMesh.material.roughness = r;
  valveMesh.material.roughness = r + 0.04;
  scoopMesh.material.roughness = r + 0.08;
}

export function setSeamsVisible(v) { if (seamLines) seamLines.visible = v; }

// ─── Указатель: подсветка, покраска, перетаскивание дизайна ──────────────────
let designMode = false;

/** В режиме дизайна клик не красит, а ставит и двигает выбранный элемент. */
export function setDesignMode(on) {
  designMode = on;
  if (on) atlas.setHover(null);
  renderer.domElement.style.cursor = on ? 'move' : 'default';
}

function hitEnvelope(ev) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const targets = [envMesh, valveMesh, scoopMesh].filter(Boolean);
  const hits = raycaster.intersectObjects(targets, false);
  return hits.length ? hits[0] : null;
}

function onPointerMove(ev) {
  if (!env) return;
  if (designMode) return;
  const hit = hitEnvelope(ev);
  if (!hit || hit.object.userData.kind !== 'envelope') { atlas.setHover(null); return; }
  const panel = env.triPanel[hit.faceIndex];
  const g = panel % state.gores;
  const r = Math.floor(panel / state.gores);
  if (state.linkBottom && r === 0) { atlas.setHover(new Set([panel])); return; }
  atlas.setHover(affectedPanels(g, r));
}

function onPointerLeave() { atlas.setHover(null); }

function onPointerDown(ev) {
  if (ev.button !== 0) return;
  const hit = hitEnvelope(ev);
  if (!hit) return;

  if (designMode) {
    const d = selectedDecal();
    if (!d || hit.object.userData.kind !== 'envelope' || !hit.uv) return;
    // Тянем элемент прямо по оболочке: uv точки попадания — его новое место.
    ev.preventDefault();
    controls.enabled = false;
    mark();
    const move = (e) => {
      const h = hitEnvelope(e);
      if (!h || h.object.userData.kind !== 'envelope' || !h.uv) return;
      d.u = h.uv.x; d.v = h.uv.y;
      atlas.redrawBase(env);
      if (onPaint) onPaint();
    };
    const up = () => {
      renderer.domElement.removeEventListener('pointermove', move);
      renderer.domElement.removeEventListener('pointerup', up);
      controls.enabled = true;
      commit('decal-move');
      if (onPaint) onPaint();
    };
    move(ev);
    renderer.domElement.addEventListener('pointermove', move);
    renderer.domElement.addEventListener('pointerup', up);
    return;
  }

  const kind = hit.object.userData.kind;
  const down = { x: ev.clientX, y: ev.clientY };
  // Красим только если это клик, а не вращение камеры.
  const up = (e) => {
    renderer.domElement.removeEventListener('pointerup', up);
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
    paintHit(kind, hit.faceIndex);
  };
  renderer.domElement.addEventListener('pointerup', up);
}

/** Какие полотнища затронет клик по (g, r) в текущем режиме. */
export function affectedPanels(g, r, mode = state.paintMode) {
  const G = state.gores, R = state.rows;
  const out = new Set();
  const add = (gg, rr) => out.add(rr * G + gg);
  switch (mode) {
    case 'gore': for (let j = 0; j < R; j++) add(g, j); break;
    case 'row':  for (let i = 0; i < G; i++) add(i, r); break;
    case 'ring': for (let i = 0; i < G; i += 2) add((g % 2 === 0 ? i : i + 1) % G, r); break;
    case 'diag': {
      // Диагональная полоса через всю оболочку: шаг один клин на ряд.
      const k = g - r;
      for (let j = 0; j < R; j++) add(((k + j) % G + G) % G, j);
      break;
    }
    case 'all':  for (let j = 0; j < R; j++) for (let i = 0; i < G; i++) add(i, j); break;
    default:     add(g, r);
  }
  return out;
}

/** Покрасить с учётом режима: полотнище / клин / ряд / всё. */
export function paintPanel(g, r, code) {
  for (const p of affectedPanels(g, r)) state.panels[p] = code;
}

// ─── Камера и цикл отрисовки ──────────────────────────────────────────────────
export function frameCamera() {
  const { H, D } = env.dims;
  const contentH = H * 1.46;                 // оболочка вместе с гондолой
  const fov = (camera.fov * Math.PI) / 180;
  const aspect = Math.max(0.55, camera.aspect || 1.6);
  const distH = contentH / 2 / Math.tan(fov / 2);
  const distW = D / 2 / Math.tan(fov / 2) / aspect;
  const dist = Math.max(distH, distW) * 1.14;

  const dir = new THREE.Vector3(0.44, 0.22, 0.87).normalize();
  const cy = H * 0.38;
  camera.position.copy(dir.multiplyScalar(dist)).add(new THREE.Vector3(0, cy, 0));
  controls.target.set(0, cy, 0);
  controls.minDistance = D * 0.55;
  controls.maxDistance = dist * 3.2;
  controls.update();
}

/**
 * Вид из корзины: камера встаёт на пол гондолы и смотрит вверх в оболочку —
 * так виден рисунок изнутри и клапан. Повторный вызов возвращает прежний вид.
 */
export function basketView(on) {
  if (!env || !rig) return;
  if (on) {
    if (!savedView) {
      savedView = { pos: camera.position.clone(), target: controls.target.clone(),
        min: controls.minDistance, max: controls.maxDistance, fov: camera.fov };
    }
    const { yFloor, basket: b, pilot } = rig.userData;
    const eye = yFloor + 1.55;
    // Пилот стоит там же, где встаёт камера, а фартук перекрывает половину
    // купола — в этом режиме оба мешают рассматривать рисунок.
    if (pilot) pilot.visible = false;
    scoopMesh.visible = false;
    controls.minDistance = 0.05;
    controls.maxDistance = env.dims.H * 0.9;
    camera.fov = 62; camera.updateProjectionMatrix();
    camera.position.set(-b.w * 0.22, eye, -b.d * 0.16);
    controls.target.set(0, eye + env.dims.H * 0.35, 0);
    controls.update();
  } else if (savedView) {
    if (rig.userData.pilot) rig.userData.pilot.visible = true;
    scoopMesh.visible = true;
    camera.position.copy(savedView.pos);
    controls.target.copy(savedView.target);
    controls.minDistance = savedView.min;
    controls.maxDistance = savedView.max;
    camera.fov = savedView.fov; camera.updateProjectionMatrix();
    controls.update();
    savedView = null;
  }
}

export function resize(w, h) {
  if (!renderer) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
}

export function render() {
  controls.update();
  renderer.render(scene, camera);
}

export function snapshotPNG(width = 1600) {
  const el = renderer.domElement;
  const ratio = el.height / el.width;
  const w = width, h = Math.round(width * ratio);
  const prev = { w: el.width, h: el.height };
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  let url;
  if (skyOn) {
    // Канвас прозрачный, поэтому кадр кладём поверх картинки фона.
    const out = document.createElement('canvas');
    out.width = el.width; out.height = el.height;
    const g = out.getContext('2d');
    if (!drawBackdrop(g, out.width, out.height)) {
      g.fillStyle = '#bfdcef'; g.fillRect(0, 0, out.width, out.height);
    }
    g.drawImage(el, 0, 0);
    url = out.toDataURL('image/png');
  } else {
    url = el.toDataURL('image/png');
  }
  renderer.setSize(prev.w, prev.h, false);
  camera.aspect = prev.w / prev.h; camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  return url;
}
