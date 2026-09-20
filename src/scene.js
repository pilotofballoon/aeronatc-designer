// 3D-сцена: оболочка, клапан, юбка, воздухозаборник, гондола. Клик красит элемент.

import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import {
  buildEnvelope, buildSeams, buildTapes, buildValve, buildSkirt, unwrap,
} from './geometry.js';
import { getModel, hexOf } from './data.js';
import { state, mark, commit } from './state.js';

let renderer, scene, camera, controls, raycaster;
let group, envMesh, seamLines, tapeMesh, valveMesh, skirtMesh, mouthMesh, basket;
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
  return { renderer, scene, camera, controls };
}

export function setBackground(kind) {
  if (kind === 'sky') {
    const c = document.createElement('canvas');
    c.width = 8; c.height = 256;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#2f6fb0');
    grad.addColorStop(0.55, '#8ec2e8');
    grad.addColorStop(1, '#e6f1f8');
    g.fillStyle = grad; g.fillRect(0, 0, 8, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    scene.background = tex;
  } else {
    scene.background = null;
  }
}

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

  const fabric = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.78, metalness: 0.0, side: THREE.DoubleSide,
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

  const s = buildSkirt(env);
  skirtMesh = new THREE.Mesh(s.geometry, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.8, side: THREE.DoubleSide,
  }));
  skirtMesh.userData = { kind: 'skirt', ranges: s.ranges };
  group.add(skirtMesh);

  buildLowerRig(s);
  applyColors();
  applyGloss();
  frameCamera();
  return env;
}

// Воздухозаборник, стропы, гондола и горелка.
function buildLowerRig(skirt) {
  const d = env.dims;
  const rTop = skirt.rBot;
  const yTop = -skirt.h;
  const basketW = Math.max(1.1, d.D * 0.075);
  const gap = d.H * 0.115;
  const yBasket = yTop - gap;

  const cone = new THREE.CylinderGeometry(rTop, basketW * 0.62, gap, 48, 1, true);
  cone.translate(0, yTop - gap / 2, 0);
  mouthMesh = new THREE.Mesh(cone, new THREE.MeshStandardMaterial({
    color: 0x2b2f36, roughness: 0.85, side: THREE.DoubleSide,
  }));
  mouthMesh.userData.kind = 'mouth';
  group.add(mouthMesh);

  basket = new THREE.Group();
  const bh = basketW * 0.85;
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(basketW * 0.55, basketW * 0.5, bh, 16),
    new THREE.MeshStandardMaterial({ color: 0xa9793f, roughness: 0.95 }),
  );
  body.position.y = yBasket - bh / 2;
  basket.add(body);

  const frame = new THREE.Mesh(
    new THREE.CylinderGeometry(basketW * 0.12, basketW * 0.12, bh * 0.6, 10),
    new THREE.MeshStandardMaterial({ color: 0x8d9299, roughness: 0.4, metalness: 0.6 }),
  );
  frame.position.y = yBasket + bh * 0.25;
  basket.add(frame);
  group.add(basket);
}

/** Перекрасить все вершины по карте цветов. */
export function applyColors() {
  if (!env) return;
  const attr = env.geometry.getAttribute('color');
  const arr = attr.array;
  for (let r = 0; r < state.rows; r++) {
    for (let g = 0; g < state.gores; g++) {
      const range = env.panelRange[r * state.gores + g];
      if (!range) continue;
      tmpColor.set(hexOf(state.panels[r * state.gores + g])).convertSRGBToLinear();
      const [start, count] = range;
      for (let i = start; i < start + count; i++) {
        arr[i * 3] = tmpColor.r; arr[i * 3 + 1] = tmpColor.g; arr[i * 3 + 2] = tmpColor.b;
      }
    }
  }
  attr.needsUpdate = true;

  paintRanges(valveMesh, state.valve);
  paintRanges(skirtMesh, state.skirt);

  tmpColor.set(hexOf(state.mouth)).convertSRGBToLinear();
  mouthMesh.material.color.copy(tmpColor);

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
  skirtMesh.material.roughness = r + 0.06;
}

export function setSeamsVisible(v) { if (seamLines) seamLines.visible = v; }

// ─── Покраска кликом ──────────────────────────────────────────────────────────
function onPointerDown(ev) {
  if (ev.button !== 0) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  const targets = [envMesh, valveMesh, skirtMesh, mouthMesh].filter(Boolean);
  const hits = raycaster.intersectObjects(targets, false);
  if (!hits.length) return;

  const hit = hits[0];
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

function paintHit(kind, faceIndex) {
  mark();
  const code = state.active;
  if (kind === 'envelope') {
    const panel = env.triPanel[faceIndex];
    const g = panel % state.gores;
    const r = Math.floor(panel / state.gores);
    paintPanel(g, r, code);
  } else if (kind === 'valve') {
    const seg = Math.floor(faceIndex / 6);
    if (state.paintMode === 'all') state.valve = state.valve.map(() => code);
    else state.valve[seg % state.valve.length] = code;
  } else if (kind === 'skirt') {
    const seg = Math.floor(faceIndex / 6);
    if (state.paintMode === 'all') state.skirt = state.skirt.map(() => code);
    else state.skirt[seg % state.skirt.length] = code;
  } else if (kind === 'mouth') {
    state.mouth = code;
  }
  applyColors();
  commit('paint');
  if (onPaint) onPaint();
}

/** Покрасить с учётом режима: полотнище / клин / ряд / всё. */
export function paintPanel(g, r, code) {
  const G = state.gores, R = state.rows;
  const set = (gg, rr) => { state.panels[rr * G + gg] = code; };
  switch (state.paintMode) {
    case 'gore': for (let j = 0; j < R; j++) set(g, j); break;
    case 'row':  for (let i = 0; i < G; i++) set(i, r); break;
    case 'ring': for (let i = 0; i < G; i += 2) set((g % 2 === 0 ? i : i + 1) % G, r); break;
    case 'all':  for (let j = 0; j < R; j++) for (let i = 0; i < G; i++) set(i, j); break;
    default:     set(g, r);
  }
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
  const url = el.toDataURL('image/png');
  renderer.setSize(prev.w, prev.h, false);
  camera.aspect = prev.w / prev.h; camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  return url;
}
