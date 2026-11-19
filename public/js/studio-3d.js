/* AI Studio 3D views (loaded only when the customer opens 3D).
   1. Floor model: an exact 3D floor of the size the customer entered, covered with the real tile pattern.
   2. Photo in 3D: an estimated reconstruction from one photo. The camera is recovered from the floor
      rectangle the customer aligned; the floor becomes a plane and everything above it is raised as
      vertical surfaces standing on the floor's edge. It is an approximation, and is labelled as one. */
import * as THREE from '/vendor/three/three.module.min.js';
import { OrbitControls } from '/vendor/three/OrbitControls.js';

export function create3D(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x141414);
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 500);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  let high = false;
  let mode = null;
  let content = new THREE.Group();
  scene.add(content);
  let presets = {};
  let animating = false;

  function size() {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setPixelRatio(high ? Math.min(2, window.devicePixelRatio || 1) : 1);
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(size);
  ro.observe(container);

  function loop() {
    if (!animating) return;
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }
  function start() {
    if (animating) return;
    animating = true;
    requestAnimationFrame(loop);
  }

  function clear() {
    scene.remove(content);
    content.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        for (const m of [].concat(o.material)) {
          for (const key of ['map', 'bumpMap']) if (m[key]) m[key].dispose();
          m.dispose();
        }
      }
    });
    content = new THREE.Group();
    scene.add(content);
    for (const l of scene.children.filter((c) => c.isLight)) scene.remove(l);
  }

  function moveCamera(pos, target, up = new THREE.Vector3(0, 1, 0)) {
    camera.up.copy(up);
    camera.position.copy(pos);
    controls.target.copy(target);
    camera.lookAt(target);
    controls.update();
  }

  // ---------- 1. Floor model ----------
  function showFloor({ patternCanvas, periodW, periodH, angle, offsetX, offsetY, length, width }) {
    clear();
    mode = 'floor';
    camera.fov = 45;
    camera.near = 0.01;
    controls.minDistance = 0.3;
    controls.maxDistance = Math.max(length, width) * 5;
    controls.maxPolarAngle = Math.PI / 2 - 0.03;
    const texture = new THREE.CanvasTexture(patternCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const bump = new THREE.CanvasTexture(patternCanvas);
    bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
    // Plane in metres: u along the length (x), v along the width (away from the viewer, -z).
    const geo = new THREE.BufferGeometry();
    const corners = [[0, 0], [length, 0], [length, width], [0, width]];
    const pos = [];
    const uv = [];
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    for (const [u, v] of corners) {
      pos.push(u - length / 2, 0, -(v - width / 2));
      const ru = c * u - s * v + offsetX;
      const rv = s * u + c * v + offsetY;
      uv.push(ru / periodW, 1 - rv / periodH);
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.computeVertexNormals();
    const floor = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: texture, bumpMap: bump, bumpScale: 1.5, roughness: 0.88, metalness: 0 }));
    floor.receiveShadow = true;
    content.add(floor);
    // A low kerb around the edge and a dark surround give a sense of size; they are not from the photo.
    const kerbMat = new THREE.MeshStandardMaterial({ color: 0x5a5753, roughness: 0.95 });
    const k = 0.12;
    const kh = 0.08;
    const addKerb = (w, d, x, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, kh, d), kerbMat);
      m.position.set(x, kh / 2, z);
      m.castShadow = true;
      m.receiveShadow = true;
      content.add(m);
    };
    addKerb(length + 2 * k, k, 0, width / 2 + k / 2);
    addKerb(length + 2 * k, k, 0, -width / 2 - k / 2);
    addKerb(k, width, length / 2 + k / 2, 0);
    addKerb(k, width, -length / 2 - k / 2, 0);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x1f1e1c, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.005;
    ground.receiveShadow = true;
    content.add(ground);
    scene.add(new THREE.HemisphereLight(0xfff7ea, 0x3a3836, 1.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    const span = Math.max(length, width);
    sun.position.set(span * 0.8, span * 1.6, span * 0.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 0.1, far: span * 5 });
    scene.add(sun);
    const d = span * 1.35;
    const h = span * 0.75;
    const target = new THREE.Vector3(0, 0, 0);
    presets = {
      corner: [new THREE.Vector3(d * 0.75, h, d * 0.75), target],
      top: [new THREE.Vector3(0, span * 1.9, 0.001), target],
      front: [new THREE.Vector3(0, h * 0.8, d), target],
      left: [new THREE.Vector3(-d, h * 0.8, 0), target],
      right: [new THREE.Vector3(d, h * 0.8, 0), target],
    };
    presets.reset = presets.corner;
    preset('corner');
    size();
    start();
  }

  // ---------- 2. Photo in 3D (estimated) ----------
  function showPhoto({ designCanvas, originalCanvas, H, maskCanvas, imgW, imgH, useOriginal }) {
    const geometry = reconstruct({ H, maskCanvas, imgW, imgH });
    if (!geometry) {
      clear();
      return false;
    }
    clear();
    mode = 'photo';
    const { geo, fovDeg, up, target } = geometry;
    const texture = new THREE.CanvasTexture(useOriginal ? originalCanvas : designCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }));
    content.add(mesh);
    camera.fov = fovDeg;
    camera.near = 0.01;
    camera.updateProjectionMatrix();
    controls.minDistance = 0.2;
    controls.maxDistance = target.length() * 4;
    controls.maxPolarAngle = Math.PI;
    const dist = target.length();
    const around = (deg, lift) => {
      const offset = new THREE.Vector3().subVectors(new THREE.Vector3(0, 0, 0), target);
      offset.applyAxisAngle(up, THREE.MathUtils.degToRad(deg));
      offset.addScaledVector(up, lift * dist);
      return [target.clone().add(offset), target];
    };
    presets = {
      front: [new THREE.Vector3(0, 0, 0), target],
      top: [target.clone().addScaledVector(up, dist * 1.3).add(new THREE.Vector3(0, 0, 0.0001)), target],
      left: around(-50, 0.15),
      right: around(50, 0.15),
      corner: around(30, 0.45),
    };
    presets.reset = presets.front;
    camera.up.copy(up);
    preset('front');
    size();
    start();
    return true;
  }

  function setPhotoSource(canvas) {
    if (mode !== 'photo') return;
    content.traverse((o) => {
      if (o.isMesh && o.material.map) {
        o.material.map.dispose();
        const t = new THREE.CanvasTexture(canvas);
        t.colorSpace = THREE.SRGBColorSpace;
        o.material.map = t;
        o.material.needsUpdate = true;
      }
    });
  }

  function preset(name) {
    const p = presets[name];
    if (!p) return;
    moveCamera(p[0].clone(), p[1].clone(), mode === 'photo' ? camera.up.clone() : new THREE.Vector3(0, 1, 0));
  }

  function fullscreen() {
    const el = container.closest('.st-3d') || container;
    if (document.fullscreenElement) document.exitFullscreen();
    else if (el.requestFullscreen) el.requestFullscreen();
  }

  function setQuality(value) {
    high = value;
    size();
  }

  function dispose() {
    animating = false;
    ro.disconnect();
    clear();
    controls.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }

  return { showFloor, showPhoto, setPhotoSource, preset, fullscreen, setQuality, dispose, canvas: renderer.domElement };
}

/**
 * Single-photo reconstruction. H maps floor-plane metres to image pixels. Assumes the principal point is
 * the image centre and estimates the focal length from the right angle of the marked rectangle.
 */
let lastReconstruction = null;
/** Last single-photo reconstruction values (focal length, up direction, camera height), for checking. */
export const reconstructionInfo = () => lastReconstruction;

function reconstruct({ H, maskCanvas, imgW, imgH }) {
  const cx = imgW / 2;
  const cy = imgH / 2;
  const maxDim = Math.max(imgW, imgH);
  const col = (j) => [H[j] - cx * H[6 + j], H[3 + j] - cy * H[6 + j], H[6 + j]];
  const h1 = col(0);
  const h2 = col(1);
  const h3 = col(2);
  let f = 0.9 * maxDim;
  const f2 = -(h1[0] * h2[0] + h1[1] * h2[1]) / (h1[2] * h2[2]);
  if (Number.isFinite(f2) && f2 > (0.45 * maxDim) ** 2 && f2 < (4 * maxDim) ** 2) f = Math.sqrt(f2);
  const k = (v) => [v[0] / f, v[1] / f, v[2]];
  const a1 = k(h1);
  const a2 = k(h2);
  const a3 = k(h3);
  const len = (v) => Math.hypot(v[0], v[1], v[2]);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const scale = (v, s) => [v[0] * s, v[1] * s, v[2] * s];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const lambda = 2 / (len(a1) + len(a2));
  let r1 = scale(a1, 1 / len(a1));
  let r2 = sub(a2, scale(r1, dot(r1, a2)));
  r2 = scale(r2, 1 / len(r2));
  let t = scale(a3, lambda);
  if (t[2] < 0) {
    r1 = scale(r1, -1);
    r2 = scale(r2, -1);
    t = scale(t, -1);
  }
  const n = cross(r1, r2);
  const nt = dot(n, t);
  if (!Number.isFinite(nt) || Math.abs(nt) < 1e-6) return null;
  // "Up" points from the floor towards the camera.
  const upCam = scale(n, nt > 0 ? -1 : 1);
  // A believable phone photo is taken from 0.3–12 m above the floor and not straight down. Anything else
  // means the four corners do not yet sit on a real rectangle, so no 3D view is invented from them.
  const lookingDown = Math.abs(upCam[2]);
  if (Math.abs(nt) < 0.3 || Math.abs(nt) > 12 || lookingDown > 0.9) {
    lastReconstruction = { f, rejected: true, cameraHeight: Math.abs(nt), lookingDown };
    return null;
  }

  // Where the floor meets whatever stands on it, per image column.
  const gw = 128;
  const gh = Math.max(16, Math.round((imgH / imgW) * gw));
  const mc = document.createElement('canvas');
  mc.width = gw;
  mc.height = gh;
  const mctx = mc.getContext('2d', { willReadFrequently: true });
  mctx.drawImage(maskCanvas, 0, 0, gw, gh);
  const alpha = mctx.getImageData(0, 0, gw, gh).data;
  const contact = new Array(gw + 1).fill(-1);
  for (let x = 0; x < gw; x++) {
    for (let y = 0; y < gh; y++) {
      if (alpha[(y * gw + x) * 4 + 3] > 127) { contact[x] = y; break; }
    }
  }
  if (contact.every((v) => v < 0)) return null;
  for (let x = 0; x < gw; x++) {
    if (contact[x] >= 0) continue;
    let l = x;
    let r = x;
    while (l >= 0 && contact[l] < 0) l--;
    while (r < gw && contact[r] < 0) r++;
    contact[x] = l >= 0 && r < gw ? (contact[l] + contact[r]) / 2 : l >= 0 ? contact[l] : contact[r];
  }
  contact[gw] = contact[gw - 1];

  const ray = (px, py) => [(px - cx) / f, (py - cy) / f, 1];
  const floorHit = (d) => {
    const den = dot(n, d);
    const s = nt / den;
    return s > 0 ? scale(d, s) : null;
  };
  // Typical size of the scene: distance to the middle of the marked floor.
  const mid = floorHit(ray(imgW / 2, Math.min(imgH - 1, ((contact[gw >> 1] + gh) / 2 / gh) * imgH)));
  const sceneDepth = mid ? len(mid) : 5;
  const maxDist = sceneDepth * 4;

  const vx = gw + 1;
  const vy = gh + 1;
  const positions = new Float32Array(vx * vy * 3);
  const uvs = new Float32Array(vx * vy * 2);
  const depth = new Float32Array(vx * vy);
  for (let j = 0; j < vy; j++) {
    for (let i = 0; i < vx; i++) {
      const px = (i / gw) * imgW;
      const py = (j / gh) * imgH;
      const d = ray(px, py);
      let P = null;
      const contactY = contact[Math.min(gw, i)];
      if (j >= contactY) {
        P = floorHit(d);
      } else {
        const G = floorHit(ray(px, ((contactY + 0.5) / gh) * imgH));
        if (G) {
          const gH = sub(G, scale(upCam, dot(G, upCam)));
          const gl = len(gH);
          if (gl > 1e-6) {
            const nw = scale(gH, 1 / gl);
            const den = dot(nw, d);
            if (Math.abs(den) > 1e-6) {
              const s = dot(nw, G) / den;
              if (s > 0) P = scale(d, s);
            }
          }
        }
      }
      if (!P || len(P) > maxDist) P = scale(d, maxDist / len(d));
      const k3 = (j * vx + i) * 3;
      // Camera coordinates (x right, y down, z forward) to three.js (x right, y up, z backward).
      positions[k3] = P[0];
      positions[k3 + 1] = -P[1];
      positions[k3 + 2] = -P[2];
      depth[j * vx + i] = len(P);
      uvs[(j * vx + i) * 2] = i / gw;
      uvs[(j * vx + i) * 2 + 1] = 1 - j / gh;
    }
  }
  // Triangles that stretch across a depth jump (an object's edge against the background) are left out.
  const index = [];
  const ok = (a, b, c) => {
    const lo = Math.min(depth[a], depth[b], depth[c]);
    const hi = Math.max(depth[a], depth[b], depth[c]);
    return hi / lo < 1.6;
  };
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const a = j * vx + i;
      const b = a + 1;
      const c = a + vx;
      const d2 = c + 1;
      if (ok(a, c, b)) index.push(a, c, b);
      if (ok(b, c, d2)) index.push(b, c, d2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(index);
  const up = new THREE.Vector3(upCam[0], -upCam[1], -upCam[2]).normalize();
  // Orbit around a point straight ahead, at the distance of the marked floor.
  const target = new THREE.Vector3(0, 0, -sceneDepth);
  lastReconstruction = { f, up: up.toArray(), target: target.toArray(), cameraHeight: Math.abs(nt) };
  return { geo, fovDeg: THREE.MathUtils.radToDeg(2 * Math.atan(imgH / (2 * f))), up, target };
}
