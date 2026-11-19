/* AI Studio core: perspective geometry, floor detection, the WebGL tile renderer, and image helpers.
   Everything here runs in the visitor's browser. */

// ---------- Perspective geometry ----------

/** Solves the 3×3 homography H (h33 = 1) that maps each src point to its dst point (4 pairs). */
export function solveHomography(src, dst) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solveLinear(A, b);
  if (!h) return null;
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    if (Math.abs(M[pivot][col]) < 1e-12) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

export function invert3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-15) return null;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}

export const det3 = (m) => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);

export function applyH(m, x, y) {
  const w = m[6] * x + m[7] * y + m[8];
  return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w, w];
}

/**
 * Floor plane (metres) → image (pixels). Corners: 0 near-left, 1 near-right, 2 far-right, 3 far-left,
 * standing for a real rectangle of length × width metres on the floor.
 */
export function floorHomography(corners, length, width) {
  return solveHomography([[0, 0], [length, 0], [length, width], [0, width]], corners);
}

/** True when the four corners form a convex quadrilateral (otherwise the perspective is impossible). */
export function isConvexQuad(c) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [x1, y1] = c[i];
    const [x2, y2] = c[(i + 1) % 4];
    const [x3, y3] = c[(i + 2) % 4];
    const cross = (x2 - x1) * (y3 - y2) - (y2 - y1) * (x3 - x2);
    if (Math.abs(cross) < 1e-6) return false;
    if (!sign) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

// ---------- Floor selection (on-device AI: Segment Anything) ----------

export const MODEL_MB = 14;
// Where the floor almost always is in a photo of a courtyard: spread across the lower part of the frame.
export const DEFAULT_POINTS = [[0.5, 0.94], [0.2, 0.88], [0.8, 0.88], [0.35, 0.76], [0.65, 0.76]];

let worker = null;
let requestId = 0;
const pending = new Map();
let progressHandler = null;

function getWorker() {
  if (worker) return worker;
  worker = new Worker('/js/studio-worker.js', { type: 'module' });
  worker.onmessage = (event) => {
    const msg = event.data;
    if (msg.type === 'progress') {
      if (progressHandler) progressHandler(msg.loaded / msg.total);
      return;
    }
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    if (msg.type === 'error') entry.reject(new Error(msg.message));
    else entry.resolve(msg);
  };
  worker.onerror = (event) => {
    for (const entry of pending.values()) entry.reject(new Error(event.message || 'worker'));
    pending.clear();
    worker = null;
  };
  return worker;
}

function ask(message, transfer = []) {
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ ...message, id }, transfer);
  });
}

/** Encodes a photo once (the slow step, about a second or two). Returns the scale used (photo px → model px). */
export async function encodePhoto(key, photoCanvas, onProgress) {
  progressHandler = onProgress;
  const scale = 1024 / Math.max(photoCanvas.width, photoCanvas.height);
  const w = Math.round(photoCanvas.width * scale);
  const h = Math.round(photoCanvas.height * scale);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(photoCanvas, 0, 0, w, h);
  const pixels = ctx.getImageData(0, 0, w, h).data;
  try {
    await ask({ type: 'encode', key, pixels, width: w, height: h }, [pixels.buffer]);
  } finally {
    progressHandler = null;
  }
  return scale;
}

/** points: [[x, y, include]] in photo pixels. Fast (tens of milliseconds) once the photo is encoded. */
export function decodeSelection(key, points, scale) {
  return ask({ type: 'decode', key, points: points.map(([x, y, inc]) => [x * scale, y * scale, inc]) });
}

/** Draws the model's selection (a grid over the padded 1024 square) into the photo-sized mask canvas. */
export function maskFromSelection(result, scale, maskCanvas) {
  const { grid, width, height } = result;
  const small = document.createElement('canvas');
  small.width = width;
  small.height = height;
  const sctx = small.getContext('2d');
  const img = sctx.createImageData(width, height);
  for (let i = 0; i < grid.length; i++) {
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = grid[i];
  }
  sctx.putImageData(img, 0, 0);
  // The photo fills the top-left part of the padded square.
  const cropW = (maskCanvas.width * scale * width) / 1024;
  const cropH = (maskCanvas.height * scale * height) / 1024;
  const ctx = maskCanvas.getContext('2d');
  ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(small, 0, 0, cropW, cropH, 0, 0, maskCanvas.width, maskCanvas.height);
}

/** Share of the photo that is selected (0–1). */
export function selectedShare(maskCanvas) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(maskCanvas, 0, 0, 64, 64);
  const a = ctx.getImageData(0, 0, 64, 64).data;
  let n = 0;
  for (let i = 3; i < a.length; i += 4) if (a[i] > 127) n++;
  return n / 4096;
}

/** Finds a starting perspective trapezoid inside the selected area (the customer then aligns it). */
export function fitCorners(maskCanvas) {
  const w = maskCanvas.width;
  const h = maskCanvas.height;
  const step = Math.max(1, Math.round(Math.max(w, h) / 256));
  const alpha = maskCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const rows = [];
  for (let y = 0; y < h; y += step) {
    let left = -1;
    let right = -1;
    let count = 0;
    for (let x = 0; x < w; x += step) {
      if (alpha[(y * w + x) * 4 + 3] > 127) {
        if (left < 0) left = x;
        right = x;
        count++;
      }
    }
    if (count * step > w * 0.08) rows.push({ y, left, right });
  }
  if (rows.length < 4) {
    return [[w * 0.2, h * 0.92], [w * 0.8, h * 0.92], [w * 0.68, h * 0.6], [w * 0.32, h * 0.6]];
  }
  const near = rows[Math.floor(rows.length * 0.92)];
  const far = rows[Math.floor(rows.length * 0.3)];
  const inset = (r, f) => [r.left + (r.right - r.left) * f, r.right - (r.right - r.left) * f];
  const [nl, nr] = inset(near, 0.12);
  const [fl, fr] = inset(far, 0.12);
  return [[nl, near.y], [nr, near.y], [fr, far.y], [fl, far.y]];
}

/** Area of the selected floor, in m², from the perspective mapping (pixels near the horizon are left out). */
export function photoArea(maskCanvas, Hinv, maxPixelArea) {
  const w = maskCanvas.width;
  const h = maskCanvas.height;
  const step = 4;
  const alpha = maskCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const d = Math.abs(det3(Hinv));
  let area = 0;
  let excluded = 0;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const a = alpha[(y * w + x) * 4 + 3] / 255;
      if (a < 0.5) continue;
      const q = Hinv[6] * x + Hinv[7] * y + Hinv[8];
      if (q <= 0) { excluded++; continue; }
      const px = (d / (q * q * q)) * step * step;
      if (px > maxPixelArea) { excluded++; continue; }
      area += px;
    }
  }
  return { area, excluded: excluded > 0 };
}

// ---------- Images ----------

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image'));
    img.src = src;
  });
}

/** Draws an image into a canvas no larger than maxSide (keeps the aspect ratio). */
export function toWorkingCanvas(source, maxSide = 1280) {
  const sw = source.videoWidth || source.naturalWidth || source.width;
  const sh = source.videoHeight || source.naturalHeight || source.height;
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * scale));
  c.height = Math.max(1, Math.round(sh * scale));
  c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
  return c;
}

export const canvasBlob = (canvas, type = 'image/jpeg', quality = 0.86) =>
  new Promise((resolve) => canvas.toBlob(resolve, type, quality));

/** Average colour of an image area (optionally weighted by a mask), in sRGB 0..1 and CIE Lab. */
export function averageColour(source, maskCanvas, invert = false, region = null) {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, size, size);
  const px = ctx.getImageData(0, 0, size, size).data;
  let m = null;
  if (maskCanvas) {
    const mc = document.createElement('canvas');
    mc.width = size;
    mc.height = size;
    const mctx = mc.getContext('2d', { willReadFrequently: true });
    mctx.drawImage(maskCanvas, 0, 0, size, size);
    m = mctx.getImageData(0, 0, size, size).data;
  }
  let r = 0, g = 0, b = 0, n = 0, lum2 = 0;
  for (let y = 0; y < size; y++) {
    if (region && (y < region[0] * size || y > region[1] * size)) continue;
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      let wgt = 1;
      if (m) wgt = invert ? 1 - m[i + 3] / 255 : m[i + 3] / 255;
      if (wgt < 0.5) continue;
      r += px[i]; g += px[i + 1]; b += px[i + 2]; n++;
      const l = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
      lum2 += l * l;
    }
  }
  if (!n) return null;
  const rgb = [r / n / 255, g / n / 255, b / n / 255];
  const luminance = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  return { rgb, lab: rgbToLab(rgb), luminance, contrast: Math.sqrt(Math.max(0, lum2 / n - luminance * luminance)) };
}

function rgbToLab([r, g, b]) {
  const lin = (c) => (c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92);
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

export const deltaE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// ---------- Tile pattern and lighting ----------

/**
 * One repeat of the floor pattern as a 1024×1024 texture: the real tile surface photo, grout joints
 * of the chosen width and colour, and an optional half-tile offset (brick bond).
 * Returns the canvas and the period in metres it represents.
 */
export function buildPattern(textureImage, { tileW, tileH, groutMm, groutColor, brick, rotate90 }) {
  const S = 1024;
  const tw = (rotate90 ? tileH : tileW) / 100;
  const th = (rotate90 ? tileW : tileH) / 100;
  const g = Math.max(0, groutMm) / 1000;
  const cellW = tw + g;
  const cellH = th + g;
  const periodW = cellW;
  const periodH = brick ? cellH * 2 : cellH;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d');
  ctx.fillStyle = groutColor;
  ctx.fillRect(0, 0, S, S);
  const sx = S / periodW;
  const sy = S / periodH;
  const drawTile = (x, y) => {
    const px = (x + g / 2) * sx;
    const py = (y + g / 2) * sy;
    const w = tw * sx;
    const h = th * sy;
    ctx.save();
    ctx.beginPath();
    ctx.rect(px, py, w, h);
    ctx.clip();
    if (rotate90) {
      ctx.translate(px + w / 2, py + h / 2);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(textureImage, -h / 2, -w / 2, h, w);
    } else {
      ctx.drawImage(textureImage, px, py, w, h);
    }
    ctx.restore();
    // A thin bevel so joints read as real edges, not painted lines.
    const e = Math.max(1, Math.round(S / 512));
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(px, py + h - e, w, e);
    ctx.fillRect(px + w - e, py, e, h);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(px, py, w, e);
    ctx.fillRect(px, py, e, h);
  };
  drawTile(0, 0);
  if (brick) {
    drawTile(-cellW / 2, cellH);
    drawTile(cellW / 2, cellH);
  }
  return { canvas: c, periodW, periodH };
}

/**
 * Light and shadow of the original floor: a blurred brightness map divided by the floor's average,
 * so the new tiles keep the photo's shading without keeping the old floor's pattern.
 * Stored as value/2 so a range of 0–2× fits in one byte.
 */
export function buildIllumination(photoCanvas, maskCanvas) {
  const w = 192;
  const h = Math.max(1, Math.round((photoCanvas.height / photoCanvas.width) * w));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.filter = 'blur(3px)';
  ctx.drawImage(photoCanvas, 0, 0, w, h);
  ctx.filter = 'none';
  const px = ctx.getImageData(0, 0, w, h);
  const m = document.createElement('canvas');
  m.width = w;
  m.height = h;
  const mctx = m.getContext('2d', { willReadFrequently: true });
  mctx.drawImage(maskCanvas, 0, 0, w, h);
  const mask = mctx.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  let sum = 0;
  let n = 0;
  for (let i = 0; i < w * h; i++) {
    const l = (0.2126 * px.data[i * 4] + 0.7152 * px.data[i * 4 + 1] + 0.0722 * px.data[i * 4 + 2]) / 255;
    lum[i] = l;
    if (mask[i * 4 + 3] > 127) { sum += l; n++; }
  }
  const mean = n ? sum / n : 0.5;
  // Overall exposure: a dark photo makes the new floor darker too, a bright one keeps it as it is.
  const exposure = Math.min(1.1, Math.max(0.55, mean / 0.5));
  for (let i = 0; i < w * h; i++) {
    const ratio = Math.min(1.7, Math.max(0.3, lum[i] / Math.max(0.02, mean))) * exposure;
    const v = Math.max(0, Math.min(255, Math.round((ratio / 2) * 255)));
    px.data[i * 4] = px.data[i * 4 + 1] = px.data[i * 4 + 2] = v;
    px.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(px, 0, 0);
  return { canvas: c, floorLuminance: mean };
}

// ---------- WebGL renderer ----------

const VERT = `attribute vec2 aPos; varying vec2 vUv;
void main(){ vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5); gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `precision highp float;
varying vec2 vUv;
uniform sampler2D uPhoto, uMask, uIllum, uPattern;
uniform mat3 uHinv;
uniform vec2 uSize, uPeriod, uOffset;
uniform float uAngle, uShadows;
void main(){
  vec4 photo = texture2D(uPhoto, vUv);
  vec3 q = uHinv * vec3(vUv * uSize, 1.0);
  float a = texture2D(uMask, vUv).a;
  if (q.z <= 0.0) { gl_FragColor = vec4(photo.rgb, 1.0); return; }
  vec2 m = q.xy / q.z;
  float c = cos(uAngle), s = sin(uAngle);
  vec2 r = vec2(c * m.x - s * m.y, s * m.x + c * m.y) + uOffset;
  vec3 tile = texture2D(uPattern, r / uPeriod).rgb;
  float light = mix(1.0, texture2D(uIllum, vUv).r * 2.0, uShadows);
  gl_FragColor = vec4(mix(photo.rgb, clamp(tile * light, 0.0, 1.0), a), 1.0);
}`;

export class TileRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, premultipliedAlpha: false, antialias: false });
    if (!gl) throw new Error('webgl');
    this.gl = gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    this.prog = prog;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.aniso = gl.getExtension('EXT_texture_filter_anisotropic') || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
    this.tex = {};
    ['uPhoto', 'uMask', 'uIllum', 'uPattern'].forEach((name, unit) => {
      this.tex[name] = { unit, texture: gl.createTexture() };
      gl.uniform1i(gl.getUniformLocation(prog, name), unit);
    });
    this.u = {};
    ['uHinv', 'uSize', 'uPeriod', 'uOffset', 'uAngle', 'uShadows'].forEach((n) => { this.u[n] = gl.getUniformLocation(prog, n); });
  }

  upload(name, source, { repeat = false } = {}) {
    const gl = this.gl;
    const t = this.tex[name];
    gl.activeTexture(gl.TEXTURE0 + t.unit);
    gl.bindTexture(gl.TEXTURE_2D, t.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    if (repeat) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      if (this.aniso) gl.texParameterf(gl.TEXTURE_2D, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(16, gl.getParameter(this.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  /** Draws the design: photo, with the tile pattern placed in perspective inside the mask. */
  render({ width, height, Hinv, periodW, periodH, angle, offsetX, offsetY, shadows }) {
    const gl = this.gl;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    // GLSL mat3 is column-major.
    gl.uniformMatrix3fv(this.u.uHinv, false, [Hinv[0], Hinv[3], Hinv[6], Hinv[1], Hinv[4], Hinv[7], Hinv[2], Hinv[5], Hinv[8]]);
    gl.uniform2f(this.u.uSize, width, height);
    gl.uniform2f(this.u.uPeriod, periodW, periodH);
    gl.uniform2f(this.u.uOffset, offsetX, offsetY);
    gl.uniform1f(this.u.uAngle, angle);
    gl.uniform1f(this.u.uShadows, shadows ? 1 : 0);
    for (const t of Object.values(this.tex)) {
      gl.activeTexture(gl.TEXTURE0 + t.unit);
      gl.bindTexture(gl.TEXTURE_2D, t.texture);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && c.getContext('webgl'));
  } catch {
    return false;
  }
}
