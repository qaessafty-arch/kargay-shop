/* Kargay Shre AI Studio: the customer's workspace.
   Flow: photo → floor detection (on device) → correction → product → tile layout → measurements → 3D → save → WhatsApp. */
import {
  DEFAULT_POINTS,
  MODEL_MB,
  TileRenderer,
  applyH,
  averageColour,
  buildIllumination,
  buildPattern,
  canvasBlob,
  decodeSelection,
  deltaE,
  encodePhoto,
  fitCorners,
  floorHomography,
  invert3,
  isConvexQuad,
  loadImage,
  maskFromSelection,
  photoArea,
  selectedShare,
  toWorkingCanvas,
  webglAvailable,
} from './studio-core.js';

const root = document.getElementById('studio-root');
const DATA = JSON.parse(document.getElementById('studio-data').textContent);
const L = DATA.strings;
const rtl = DATA.dir === 'rtl';
const MAX_PHOTOS = 4;
const STORE_KEY = 'ks-studio-projects';

function T(key, vars) {
  let text = L[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) text = text.split(`{${k}}`).join(String(v));
  return text;
}

// ---------- DOM helper (text is always set with textContent) ----------
function el(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = String(value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key === 'value') node.value = value;
    else if (key === 'checked') node.checked = !!value;
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}
const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); };
const icon = (name) => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'ic');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.appendChild(use);
  return svg;
};
const fmt = (n, digits = 1) => Number(n).toLocaleString(DATA.lang === 'en' ? 'en-US' : 'en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
const money = (v) => `${Number(v).toLocaleString('en-US')} ${DATA.currency}`;
const beacon = (kind, productId) => {
  try {
    fetch('/api/studio/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, productId: productId ?? null }), keepalive: true });
  } catch { /* counting is optional */ }
};

// ---------- State ----------
const state = {
  photos: [],
  active: -1,
  product: null,
  textures: new Map(),
  layout: { brick: false, rotate90: false, angle: 0, scale: 1, offsetX: 0, offsetY: 0, groutMm: 3, groutColor: '#8c877f', shadows: true },
  measure: { floorArea: '', sections: [], waste: DATA.waste },
  designs: [],
  compareBase: null,
  view: 'original',
  tool: null,
  brush: 36,
  productTab: 'suggested',
  productFilter: '',
  project: null,
  consent: false,
  description: '',
  three: null,
  threeMode: 'floor',
  threeOriginal: false,
};
const hasWebgl = webglAvailable();
let renderer = null;
const photo = () => state.photos[state.active] || null;

// ---------- Layout ----------
const ui = {};

function section(id, title, tab, ...content) {
  return el('section', { class: 'st-sec', id, 'data-tab': tab }, el('h2', { class: 'st-sec-title', text: title }), ...content);
}

function build() {
  clear(root);
  root.classList.add('is-ready');
  // Upload
  ui.fileInput = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', multiple: true, hidden: true, onchange: (e) => addFiles(e.target.files) });
  ui.cameraInput = el('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, onchange: (e) => addFiles(e.target.files) });
  ui.videoInput = el('input', { type: 'file', accept: 'video/*', hidden: true, onchange: (e) => e.target.files[0] && pickVideoFrame(e.target.files[0]) });
  ui.photos = el('div', { class: 'st-photos' });
  ui.drop = el('div', { class: 'st-drop', tabindex: '0', role: 'button', 'aria-label': T('st.up.choose') },
    icon('upload'), el('strong', { text: T('st.up.choose') }), el('span', { text: T('st.up.drop') }));
  ui.drop.addEventListener('click', () => ui.fileInput.click());
  ui.drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ui.fileInput.click(); } });
  ['dragenter', 'dragover'].forEach((t) => ui.drop.addEventListener(t, (e) => { e.preventDefault(); ui.drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((t) => ui.drop.addEventListener(t, (e) => { e.preventDefault(); ui.drop.classList.remove('is-over'); }));
  ui.drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));
  ui.description = el('textarea', { class: 'st-input', rows: 2, maxlength: 1000, 'aria-label': T('st.up.description'), oninput: (e) => { state.description = e.target.value; } });
  const sec_upload = section('st-upload', T('st.up.title'), 'upload',
    ui.drop,
    el('div', { class: 'st-row' },
      el('button', { type: 'button', class: 'st-btn', onclick: () => ui.cameraInput.click() }, icon('camera'), T('st.up.camera')),
      el('button', { type: 'button', class: 'st-btn', onclick: () => ui.videoInput.click() }, icon('video'), T('st.up.video'))),
    el('p', { class: 'st-note', text: T('st.up.formats') }),
    ui.fileInput, ui.cameraInput, ui.videoInput, ui.photos,
    el('details', { class: 'st-tips' }, el('summary', { text: T('st.up.tips') }),
      el('ul', null, ...[1, 2, 3, 4, 5, 6].map((n) => el('li', { text: T(`st.up.tip${n}`) })))),
    el('label', { class: 'st-label' }, T('st.up.description'), ui.description));

  // Floor detection and editing
  ui.detectBtn = el('button', { type: 'button', class: 'st-btn st-btn-primary', onclick: runDetection }, icon('spark'), T('st.det.run'));
  ui.detectStatus = el('p', { class: 'st-status', role: 'status', 'aria-live': 'polite' });
  ui.progress = el('div', { class: 'st-progress', hidden: true }, el('span'));
  ui.groups = el('div', { class: 'st-groups' });
  const smartBtn = (tool, label) => el('button', { type: 'button', class: 'st-tool', 'data-tool': tool, 'aria-pressed': 'false', onclick: () => setTool(state.tool === tool ? null : tool) }, label);
  const toolBtn = (tool, label, ic) => el('button', { type: 'button', class: 'st-tool', 'data-tool': tool, 'aria-pressed': 'false', onclick: () => setTool(state.tool === tool ? null : tool) }, ic ? icon(ic) : null, label);
  ui.brush = el('input', { type: 'range', min: 6, max: 140, value: state.brush, 'aria-label': T('st.tool.size'), oninput: (e) => { state.brush = Number(e.target.value); } });
  ui.undo = el('button', { type: 'button', class: 'st-tool', onclick: undo, text: T('st.tool.undo') });
  ui.redo = el('button', { type: 'button', class: 'st-tool', onclick: redo, text: T('st.tool.redo') });
  const sec_floor = section('st-floor', T('st.det.title'), 'floor',
    ui.detectBtn, el('p', { class: 'st-note', text: T('st.det.size', { mb: MODEL_MB }) }), ui.progress, ui.detectStatus, ui.groups,
    el('p', { class: 'st-sub', text: T('st.det.smart') }),
    el('div', { class: 'st-tools' }, smartBtn('tapAdd', T('st.tool.tapAdd')), smartBtn('tapRemove', T('st.tool.tapRemove'))),
    el('p', { class: 'st-note', text: T('st.det.smartHint') }),
    el('p', { class: 'st-sub', text: T('st.det.brush') }),
    el('div', { class: 'st-tools' }, toolBtn('add', T('st.tool.add')), toolBtn('erase', T('st.tool.erase')), ui.undo, ui.redo,
      el('button', { type: 'button', class: 'st-tool', onclick: resetToAi, text: T('st.tool.reset') }),
      el('button', { type: 'button', class: 'st-tool', onclick: clearMask, text: T('st.tool.clear') })),
    el('label', { class: 'st-label' }, T('st.tool.size'), ui.brush),
    el('p', { class: 'st-note', text: T('st.det.hint') }),
    el('div', { class: 'st-tools' }, toolBtn('corners', T('st.tool.corners')),
      el('button', { type: 'button', class: 'st-tool', onclick: () => { const p = photo(); if (p) { p.corners = fitCorners(p.mask); afterGeometry(); } }, text: T('st.persp.fit') })),
    el('p', { class: 'st-note', text: T('st.persp.hint') }));

  // Products
  ui.prodTabs = el('div', { class: 'st-seg', role: 'tablist' },
    ...['suggested', 'popular', 'all'].map((tab) => el('button', { type: 'button', role: 'tab', 'data-ptab': tab, onclick: () => { state.productTab = tab; paintProducts(); }, text: T(`st.prod.${tab}`) })));
  ui.prodSearch = el('input', { type: 'search', class: 'st-input', placeholder: '#', 'aria-label': T('st.prod.all'), oninput: (e) => { state.productFilter = e.target.value; paintProducts(); } });
  ui.prodNote = el('p', { class: 'st-note' });
  ui.prodList = el('div', { class: 'st-prods' });
  const sec_products = section('st-products', T('st.prod.title'), 'tiles', ui.prodTabs, ui.prodSearch, ui.prodNote, ui.prodList);

  // Stage
  ui.viewBar = el('div', { class: 'st-views', role: 'toolbar' },
    ...[['original', 'st.view.original'], ['design', 'st.view.design'], ['compare', 'st.view.compare'], ['side', 'st.view.side'], ['mask', 'st.view.mask'], ['3d', 'st.view.3d']]
      .map(([v, key]) => el('button', { type: 'button', 'data-view': v, 'aria-pressed': 'false', onclick: () => setView(v), text: T(key) })));
  ui.original = el('canvas', { class: 'st-layer st-original' });
  ui.base = el('img', { class: 'st-layer st-basedesign', alt: '', hidden: true });
  ui.gl = el('canvas', { class: 'st-layer st-gl' });
  ui.overlay = el('canvas', { class: 'st-layer st-overlay' });
  ui.handle = el('div', { class: 'st-split', hidden: true, role: 'slider', tabindex: '0', 'aria-label': T('st.view.compareHint'), 'aria-valuemin': '0', 'aria-valuemax': '100' }, el('span'));
  ui.canvasBox = el('div', { class: 'st-canvas' }, ui.original, ui.base, ui.gl, ui.overlay, ui.handle);
  ui.empty = el('div', { class: 'st-empty' }, icon('image'), el('p', { text: T('st.up.empty') }),
    el('button', { type: 'button', class: 'st-btn st-btn-primary', onclick: () => ui.fileInput.click() }, icon('upload'), T('st.up.choose')));
  ui.stageMsg = el('p', { class: 'st-stage-msg', role: 'status', 'aria-live': 'polite' });
  ui.threeBox = el('div', { class: 'st-3d-canvas' });
  ui.threeNote = el('p', { class: 'st-note' });
  ui.threeBar = el('div', { class: 'st-3d-bar' });
  ui.three = el('div', { class: 'st-3d', hidden: true }, ui.threeBar, ui.threeBox, ui.threeNote);
  ui.stage = el('div', { class: 'st-stage' }, ui.viewBar, el('div', { class: 'st-viewport' }, ui.empty, ui.canvasBox, ui.three), ui.stageMsg);

  // Right panel: selected product, layout, measurements, designs, save
  ui.selected = el('div', { class: 'st-selected' });
  const range = (key, min, max, step, label, fmtFn) => {
    const out = el('output', { class: 'st-out' });
    const input = el('input', { type: 'range', min, max, step, value: state.layout[key], 'aria-label': label, oninput: (e) => { state.layout[key] = Number(e.target.value); out.textContent = fmtFn(state.layout[key]); schedule(true); } });
    out.textContent = fmtFn(state.layout[key]);
    ui[`r_${key}`] = { input, out, fmtFn };
    return el('label', { class: 'st-label' }, el('span', { class: 'st-label-row' }, label, out), input);
  };
  ui.pattern = el('div', { class: 'st-seg' },
    el('button', { type: 'button', 'data-pattern': 'straight', onclick: () => { state.layout.brick = false; paintLayout(); schedule(true); }, text: T('st.adj.straight') }),
    el('button', { type: 'button', 'data-pattern': 'brick', onclick: () => { state.layout.brick = true; paintLayout(); schedule(true); }, text: T('st.adj.brick') }));
  ui.rotate = el('input', { type: 'checkbox', onchange: (e) => { state.layout.rotate90 = e.target.checked; schedule(true); updateMeasure(); } });
  ui.shadows = el('input', { type: 'checkbox', checked: true, onchange: (e) => { state.layout.shadows = e.target.checked; schedule(); } });
  ui.groutColor = el('input', { type: 'color', value: state.layout.groutColor, 'aria-label': T('st.adj.groutColor'), oninput: (e) => { state.layout.groutColor = e.target.value; schedule(true); } });
  ui.realSize = el('p', { class: 'st-note' });
  const sec_adjust = section('st-adjust', T('st.adj.title'), 'adjust',
    ui.realSize,
    el('div', { class: 'st-label' }, T('st.adj.pattern'), ui.pattern),
    el('label', { class: 'st-check' }, ui.rotate, T('st.adj.rotate')),
    range('angle', -90, 90, 1, T('st.adj.angle'), (v) => `${v}°`),
    range('scale', 0.5, 1.5, 0.01, T('st.adj.scale'), (v) => `${Math.round(v * 100)}%`),
    range('offsetX', -0.5, 0.5, 0.01, T('st.adj.offsetX'), (v) => `${Math.round(v * 100)} cm`),
    range('offsetY', -0.5, 0.5, 0.01, T('st.adj.offsetY'), (v) => `${Math.round(v * 100)} cm`),
    range('groutMm', 0, 20, 1, T('st.adj.grout'), (v) => `${v} mm`),
    el('label', { class: 'st-label st-inline' }, T('st.adj.groutColor'), ui.groutColor),
    el('label', { class: 'st-check' }, ui.shadows, T('st.adj.shadows')));

  ui.mLength = el('input', { type: 'number', class: 'st-input', min: 0.2, max: 200, step: 0.1, inputmode: 'decimal', oninput: (e) => { const p = photo(); if (p) { p.rect.length = Number(e.target.value) || 0; afterGeometry(); } } });
  ui.mWidth = el('input', { type: 'number', class: 'st-input', min: 0.2, max: 200, step: 0.1, inputmode: 'decimal', oninput: (e) => { const p = photo(); if (p) { p.rect.width = Number(e.target.value) || 0; afterGeometry(); } } });
  ui.mFloor = el('input', { type: 'number', class: 'st-input', min: 0, max: 100000, step: 0.1, inputmode: 'decimal', oninput: (e) => { state.measure.floorArea = e.target.value; updateMeasure(); } });
  ui.mWaste = el('input', { type: 'number', class: 'st-input', min: 0, max: 30, step: 1, value: state.measure.waste, inputmode: 'numeric', oninput: (e) => { state.measure.waste = Math.min(30, Math.max(0, Number(e.target.value) || 0)); updateMeasure(); } });
  ui.sections = el('div', { class: 'st-sections' });
  ui.results = el('dl', { class: 'st-results' });
  const sec_measure = section('st-measure', T('st.m.title'), 'measure',
    el('div', { class: 'st-grid2' },
      el('label', { class: 'st-label' }, T('st.m.length'), ui.mLength, el('small', { text: T('st.m.lengthHelp') })),
      el('label', { class: 'st-label' }, T('st.m.width'), ui.mWidth)),
    el('label', { class: 'st-label' }, T('st.m.floor'), ui.mFloor, el('small', { text: T('st.m.floorHelp') })),
    el('div', { class: 'st-label' }, T('st.m.extra'), ui.sections,
      el('button', { type: 'button', class: 'st-tool', onclick: () => { state.measure.sections.push({ l: '', w: '' }); paintSections(); }, text: `+ ${T('st.m.add')}` })),
    el('label', { class: 'st-label' }, T('st.m.waste'), ui.mWaste),
    ui.results,
    el('p', { class: 'st-note', text: T('st.m.note') }));

  ui.designs = el('div', { class: 'st-designs' });
  const sec_designs = section('st-designs', T('st.d.title'), 'save',
    el('button', { type: 'button', class: 'st-btn', onclick: keepDesign, text: T('st.d.keep') }), ui.designs);

  ui.consent = el('input', { type: 'checkbox', onchange: (e) => { state.consent = e.target.checked; } });
  ui.saveBtn = el('button', { type: 'button', class: 'st-btn st-btn-primary', onclick: save, text: T('st.s.save') });
  ui.saveStatus = el('p', { class: 'st-status', role: 'status', 'aria-live': 'polite' });
  ui.projectBox = el('div', { class: 'st-project' });
  ui.mine = el('div', { class: 'st-mine' });
  const sec_save = section('st-save', T('st.s.title'), 'save',
    el('label', { class: 'st-check st-consent' }, ui.consent, T('st.s.consent', { days: DATA.retentionDays })),
    ui.saveBtn, ui.saveStatus,
    el('button', { type: 'button', class: 'st-btn st-btn-wa', onclick: sendToFactory }, icon('wa'), T('st.s.send', { name: DATA.shopName })),
    el('p', { class: 'st-note', text: T('st.s.sendHelp') }),
    el('div', { class: 'st-row' },
      el('button', { type: 'button', class: 'st-btn', onclick: downloadImage, text: T('st.s.download') }),
      el('button', { type: 'button', class: 'st-btn', onclick: copyShare, text: T('st.s.share') })),
    ui.projectBox, ui.mine);

  ui.left = el('aside', { class: 'st-panel st-left' }, sec_upload, sec_floor, sec_products);
  ui.right = el('aside', { class: 'st-panel st-right' }, ui.selected, sec_adjust, sec_measure, sec_designs, sec_save);
  ui.tabs = el('nav', { class: 'st-tabs', 'aria-label': T('st.short') },
    ...[['upload', 'upload'], ['floor', 'spark'], ['tiles', 'grid'], ['adjust', 'ruler'], ['measure', 'layers'], ['save', 'check']]
      .map(([tab, ic]) => el('button', { type: 'button', 'data-tabbtn': tab, onclick: () => setTab(tab) }, icon(ic), el('span', { text: T(`st.tab.${tab}`) }))));
  root.append(el('div', { class: 'st-app' }, ui.left, ui.stage, ui.right), ui.tabs);

  setupOverlay();
  setupSplit();
  if (hasWebgl) {
    try {
      renderer = new TileRenderer(ui.gl);
    } catch {
      renderer = null;
    }
  }
  if (!renderer) message(T('st.err.webgl'));
  setTab('upload');
  setView('original');
  paintLayout();
  paintSections();
  paintProducts();
  paintSelected();
  paintMine();
  updateMeasure();
  if (DATA.preselect) {
    const p = DATA.products.find((x) => x.code === DATA.preselect);
    if (p) selectProduct(p, false);
  }
  const hash = location.hash.match(/^#p=(\d+)\.([A-Za-z0-9_-]{20,64})$/);
  if (hash) openProject(Number(hash[1]), hash[2]);
}

function message(text) {
  ui.stageMsg.textContent = text || '';
}

function setTab(tab) {
  root.dataset.tab = tab;
  root.querySelectorAll('[data-tabbtn]').forEach((b) => b.setAttribute('aria-current', b.dataset.tabbtn === tab ? 'true' : 'false'));
}

// ---------- Photos ----------
async function addFiles(fileList) {
  const files = Array.from(fileList || []).filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name));
  for (const file of files) {
    if (state.photos.length >= MAX_PHOTOS) { message(T('st.up.max')); break; }
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      addPhoto(toWorkingCanvas(img), file.name);
    } catch {
      message(T('st.up.badFile'));
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  ui.fileInput.value = '';
  ui.cameraInput.value = '';
}

function addPhoto(canvas, name) {
  const mask = document.createElement('canvas');
  mask.width = canvas.width;
  mask.height = canvas.height;
  state.photos.push({
    canvas, name, mask, key: `p${Date.now()}-${Math.random().toString(36).slice(2)}`, scale: 0, encoded: false,
    points: [], detection: null, corners: null, rect: { length: 4, width: 4 }, history: [], future: [], illum: null, stats: null,
  });
  activate(state.photos.length - 1);
  paintPhotos();
}

function activate(index) {
  state.active = index;
  const p = photo();
  ui.empty.hidden = !!p;
  ui.canvasBox.hidden = !p;
  if (!p) { paintPhotos(); return; }
  for (const c of [ui.original, ui.overlay]) {
    c.width = p.canvas.width;
    c.height = p.canvas.height;
  }
  ui.canvasBox.style.setProperty('--ar', String(p.canvas.width / p.canvas.height));
  ui.original.getContext('2d').drawImage(p.canvas, 0, 0);
  if (renderer) renderer.upload('uPhoto', p.canvas);
  ui.mLength.value = p.rect.length;
  ui.mWidth.value = p.rect.width;
  state.compareBase = null;
  ui.base.hidden = true;
  if (p.mask && renderer) renderer.upload('uMask', p.mask);
  p.illum = null;
  paintGroups();
  paintPhotos();
  afterGeometry();
  if (!p.detection && !hasMask(p)) {
    ui.detectStatus.textContent = '';
    setView('original');
  }
}

function paintPhotos() {
  clear(ui.photos);
  state.photos.forEach((p, i) => {
    const thumb = el('canvas', { width: 96, height: Math.round((p.canvas.height / p.canvas.width) * 96) });
    thumb.getContext('2d').drawImage(p.canvas, 0, 0, thumb.width, thumb.height);
    ui.photos.appendChild(el('div', { class: `st-photo${i === state.active ? ' is-on' : ''}` },
      el('button', { type: 'button', class: 'st-photo-pick', 'aria-label': `${T('st.share.photo', { n: i + 1 })}`, onclick: () => activate(i) }, thumb),
      el('button', { type: 'button', class: 'st-photo-x', 'aria-label': T('st.up.remove'), onclick: () => removePhoto(i), text: '×' })));
  });
}

function removePhoto(i) {
  state.photos.splice(i, 1);
  activate(Math.min(state.active, state.photos.length - 1));
  if (!state.photos.length) { state.active = -1; activate(-1); }
}

/** Lets the customer choose a clear frame from a video; that frame becomes a photo. */
function pickVideoFrame(file) {
  const url = URL.createObjectURL(file);
  const video = el('video', { src: url, muted: true, playsinline: true, preload: 'auto', class: 'st-video' });
  const slider = el('input', { type: 'range', min: 0, max: 1000, value: 0, 'aria-label': T('st.up.videoPick') });
  const close = () => { URL.revokeObjectURL(url); dialog.remove(); ui.videoInput.value = ''; };
  const use = el('button', { type: 'button', class: 'st-btn st-btn-primary', disabled: true, text: T('st.up.useFrame'), onclick: () => {
    addPhoto(toWorkingCanvas(video), file.name);
    close();
  } });
  const dialog = el('div', { class: 'st-modal', role: 'dialog', 'aria-modal': 'true' },
    el('div', { class: 'st-modal-box' }, el('p', { text: T('st.up.videoPick') }), video, slider,
      el('div', { class: 'st-row' }, use, el('button', { type: 'button', class: 'st-btn', onclick: close, text: T('st.up.cancel') }))));
  document.body.appendChild(dialog);
  video.addEventListener('loadeddata', () => { use.disabled = false; });
  video.addEventListener('error', () => { message(T('st.up.badVideo')); close(); });
  slider.addEventListener('input', () => { if (video.duration) video.currentTime = (slider.value / 1000) * video.duration; });
}

// ---------- Detection ----------
async function ensureEncoded(p) {
  if (p.encoded) return;
  ui.progress.hidden = false;
  ui.progress.firstChild.style.width = '0%';
  ui.detectStatus.textContent = T('st.det.analysing');
  try {
    p.scale = await encodePhoto(p.key, p.canvas, (fraction) => {
      ui.progress.firstChild.style.width = `${Math.round(fraction * 100)}%`;
      ui.detectStatus.textContent = fraction < 1 ? T('st.det.loading', { p: Math.round(fraction * 100) }) : T('st.det.analysing');
    });
    p.encoded = true;
  } finally {
    ui.progress.hidden = true;
  }
}

/** Runs the selection model with the photo's current points and puts the result in the mask. */
async function applySelection(p) {
  const result = await decodeSelection(p.key, p.points, p.scale);
  maskFromSelection(result, p.scale, p.mask);
  p.detection = { score: result.score };
  return result;
}

async function runDetection() {
  const p = photo();
  if (!p) { message(T('st.up.empty')); return; }
  ui.detectBtn.disabled = true;
  try {
    await ensureEncoded(p);
    pushHistory(p);
    p.points = DEFAULT_POINTS.map(([fx, fy]) => [fx * p.canvas.width, fy * p.canvas.height, true]);
    const result = await applySelection(p);
    const share = selectedShare(p.mask);
    ui.detectStatus.textContent = share > 0.02 ? `${T('st.det.done')} (${Math.round(result.score * 100)}%)` : T('st.det.none');
    p.corners = fitCorners(p.mask);
    beacon('detect');
    paintGroups();
    afterMask();
    setView(state.product ? 'design' : 'mask');
    if (window.matchMedia('(max-width: 1023px)').matches) setTab(state.product ? 'adjust' : 'tiles');
  } catch {
    ui.detectStatus.textContent = T('st.det.error');
    setView('mask');
    setTool('add');
  } finally {
    ui.detectBtn.disabled = false;
  }
}

/** Tap-to-select: each tap adds a point that the floor includes (or excludes); the model redraws the edges. */
async function smartTap(p, x, y, include) {
  try {
    if (!p.encoded) { ui.detectBtn.disabled = true; await ensureEncoded(p); }
    pushHistory(p);
    p.points.push([x, y, include]);
    await applySelection(p);
    ui.detectStatus.textContent = T('st.det.done');
    paintGroups();
    afterMask();
  } catch {
    ui.detectStatus.textContent = T('st.det.error');
  } finally {
    ui.detectBtn.disabled = false;
  }
}

function paintGroups() {
  clear(ui.groups);
  const p = photo();
  if (!p || !p.points.length) return;
  const inc = p.points.filter((pt) => pt[2]).length;
  ui.groups.appendChild(el('p', { class: 'st-note', text: T('st.det.points', { add: inc, remove: p.points.length - inc, share: Math.round(selectedShare(p.mask) * 100) }) }));
}

// ---------- Mask editing (brush, undo/redo) ----------
function snapshot(p) {
  const img = p.mask.getContext('2d').getImageData(0, 0, p.mask.width, p.mask.height);
  img.points = p.points.slice();
  return img;
}
function restore(p, img) {
  p.mask.getContext('2d').putImageData(img, 0, 0);
  if (img.points) p.points = img.points;
  paintGroups();
}
function pushHistory(p) {
  p.history.push(snapshot(p));
  if (p.history.length > 10) p.history.shift();
  p.future = [];
}
function undo() {
  const p = photo();
  if (!p || !p.history.length) return;
  p.future.push(snapshot(p));
  restore(p, p.history.pop());
  afterMask();
}
function redo() {
  const p = photo();
  if (!p || !p.future.length) return;
  p.history.push(snapshot(p));
  restore(p, p.future.pop());
  afterMask();
}
function resetToAi() {
  const p = photo();
  if (!p || !p.encoded) { runDetection(); return; }
  runDetection();
}
function clearMask() {
  const p = photo();
  if (!p) return;
  pushHistory(p);
  p.mask.getContext('2d').clearRect(0, 0, p.mask.width, p.mask.height);
  p.points = [];
  paintGroups();
  afterMask();
}

function setTool(tool) {
  state.tool = tool;
  root.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.tool === tool ? 'true' : 'false'));
  ui.overlay.classList.toggle('is-editing', !!tool);
  if (['add', 'erase', 'tapAdd', 'tapRemove'].includes(tool) && state.view !== 'mask') setView('mask');
  if (tool === 'corners' && !['design', 'mask', 'original'].includes(state.view)) setView('mask');
  drawOverlay();
}

function setupOverlay() {
  let drawing = false;
  let last = null;
  let dragCorner = -1;
  const pos = (e) => {
    const r = ui.overlay.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * ui.overlay.width, ((e.clientY - r.top) / r.height) * ui.overlay.height];
  };
  const scaleFactor = () => ui.overlay.width / ui.overlay.getBoundingClientRect().width;
  ui.overlay.addEventListener('pointerdown', (e) => {
    const p = photo();
    if (!p || !state.tool) return;
    const pt = pos(e);
    if (state.tool === 'tapAdd' || state.tool === 'tapRemove') {
      smartTap(p, pt[0], pt[1], state.tool === 'tapAdd');
      e.preventDefault();
      return;
    }
    if (state.tool === 'corners') {
      if (!p.corners) p.corners = fitCorners(p.mask);
      const hit = 28 * scaleFactor();
      dragCorner = p.corners.findIndex(([x, y]) => Math.hypot(x - pt[0], y - pt[1]) < hit);
      if (dragCorner < 0) return;
    } else {
      pushHistory(p);
      drawing = true;
      last = pt;
      paint(p, pt, pt);
    }
    ui.overlay.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  ui.overlay.addEventListener('pointermove', (e) => {
    const p = photo();
    if (!p) return;
    const pt = pos(e);
    if (dragCorner >= 0) {
      p.corners[dragCorner] = [Math.max(0, Math.min(p.canvas.width, pt[0])), Math.max(0, Math.min(p.canvas.height, pt[1]))];
      afterGeometry(true);
    } else if (drawing) {
      paint(p, last, pt);
      last = pt;
      drawOverlay();
    }
  });
  const end = () => {
    if (drawing) { drawing = false; afterMask(); }
    if (dragCorner >= 0) { dragCorner = -1; afterGeometry(); }
  };
  ui.overlay.addEventListener('pointerup', end);
  ui.overlay.addEventListener('pointercancel', end);
  const paint = (p, a, b) => {
    const ctx = p.mask.getContext('2d');
    ctx.save();
    ctx.globalCompositeOperation = state.tool === 'erase' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = '#fff';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = state.brush * scaleFactor() * 0.6 + 4;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0] + 0.01, b[1]);
    ctx.stroke();
    ctx.restore();
  };
}

function drawOverlay() {
  const p = photo();
  const ctx = ui.overlay.getContext('2d');
  ctx.clearRect(0, 0, ui.overlay.width, ui.overlay.height);
  if (!p) return;
  if (state.view === 'mask') {
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.drawImage(p.mask, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = '#d2b48c';
    ctx.fillRect(0, 0, ui.overlay.width, ui.overlay.height);
    ctx.restore();
  }
  if (state.view === 'mask' && p.points.length) {
    const s = ui.overlay.width / Math.max(1, ui.overlay.getBoundingClientRect().width);
    for (const [x, y, inc] of p.points) {
      ctx.beginPath();
      ctx.arc(x, y, 9 * s, 0, Math.PI * 2);
      ctx.fillStyle = inc ? '#25d366' : '#c97b72';
      ctx.fill();
      ctx.lineWidth = 2 * s;
      ctx.strokeStyle = '#141414';
      ctx.stroke();
    }
  }
  if (p.corners && (state.tool === 'corners' || state.view === 'mask')) {
    const s = ui.overlay.width / Math.max(1, ui.overlay.getBoundingClientRect().width);
    const c = p.corners;
    ctx.save();
    ctx.lineWidth = 2 * s;
    ctx.strokeStyle = '#25d366';
    // Metre grid inside the rectangle, so alignment with real floor lines is easy to judge.
    const H = floorHomography(c, p.rect.length || 1, p.rect.width || 1);
    if (H && isConvexQuad(c)) {
      ctx.globalAlpha = 0.5;
      for (let u = 1; u < p.rect.length; u++) line(ctx, applyH(H, u, 0), applyH(H, u, p.rect.width));
      for (let v = 1; v < p.rect.width; v++) line(ctx, applyH(H, 0, v), applyH(H, p.rect.length, v));
      ctx.globalAlpha = 1;
    }
    ctx.beginPath();
    c.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.stroke();
    c.forEach(([x, y], i) => {
      ctx.fillStyle = '#141414';
      ctx.beginPath();
      ctx.arc(x, y, 14 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#f1efeb';
      ctx.font = `${Math.round(14 * s)}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), x, y + 0.5 * s);
    });
    ctx.restore();
  }
}
function line(ctx, a, b) {
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.stroke();
}

function afterMask() {
  const p = photo();
  if (!p) return;
  if (renderer) renderer.upload('uMask', p.mask);
  p.illum = null;
  p.stats = null;
  if (!p.corners) p.corners = fitCorners(p.mask);
  drawOverlay();
  schedule();
  updateMeasure();
  if (state.productTab === 'suggested') paintProducts();
}

function afterGeometry(light = false) {
  drawOverlay();
  schedule();
  if (!light) updateMeasure();
}

// ---------- Products ----------
function productStats(p) {
  if (p.stats) return p.stats;
  const around = averageColour(p.canvas, p.mask, true, [0.25, 1]);
  const floor = averageColour(p.canvas, p.mask, false);
  p.stats = { around, floor };
  return p.stats;
}

async function textureFor(product) {
  if (!product.texture) return null;
  if (state.textures.has(product.code)) return state.textures.get(product.code);
  const promise = loadImage(`/api/studio/textures/${product.code}`).then((img) => {
    const colour = averageColour(img, null);
    return { img, colour };
  });
  state.textures.set(product.code, promise);
  return promise;
}

function areaEstimate() {
  const p = photo();
  const entered = Number(state.measure.floorArea);
  if (entered > 0) return entered;
  return p && p.rect.length && p.rect.width ? p.rect.length * p.rect.width : 0;
}

/** Ranks previewable products for the current photo, with the measured reasons behind each suggestion. */
async function suggestions() {
  const p = photo();
  if (!p || !(p.detection || hasMask(p))) return null;
  const stats = productStats(p);
  const area = areaEstimate();
  const list = [];
  for (const product of DATA.products) {
    if (!product.texture || product.availability === 'out') continue;
    let tex;
    try {
      tex = await textureFor(product);
    } catch {
      continue;
    }
    if (!tex || !tex.colour) continue;
    const reasons = [];
    let score = 0;
    if (stats.around) {
      const d = deltaE(tex.colour.lab, stats.around.lab);
      const tone = 1 - Math.min(1, d / 60);
      score += 0.45 * tone;
      if (tone > 0.6) reasons.push('tone');
      else if (Math.abs(tex.colour.lab[0] - stats.around.lab[0]) > 25) { reasons.push('contrast'); score += 0.15; }
    }
    const tileL = tex.colour.lab[0];
    const floorLum = stats.floor ? stats.floor.luminance : 0.5;
    if (floorLum < 0.35) { score += 0.3 * (tileL / 100); if (tileL > 65) reasons.push('light'); }
    else if (floorLum > 0.65) { const mid = 1 - Math.abs(tileL - 60) / 60; score += 0.3 * mid; if (mid > 0.75) reasons.push('mid'); }
    else score += 0.15;
    const tileArea = ((product.w || 40) * (product.h || 40)) / 10000;
    if (area >= 25) { score += tileArea >= 0.2 ? 0.2 : 0.08; if (tileArea >= 0.2) reasons.push('large'); }
    else if (area > 0 && area <= 10) { score += tileArea <= 0.16 ? 0.2 : 0.08; if (tileArea <= 0.16) reasons.push('small'); }
    else score += 0.12;
    if (!reasons.length) reasons.push('tone');
    list.push({ product, score, reasons });
  }
  return list.sort((a, b) => b.score - a.score).slice(0, 4);
}

let paintToken = 0;
async function paintProducts() {
  const token = ++paintToken;
  ui.prodTabs.querySelectorAll('[data-ptab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.ptab === state.productTab ? 'true' : 'false'));
  ui.prodSearch.hidden = state.productTab !== 'all';
  let items = [];
  let note = '';
  if (state.productTab === 'suggested') {
    const result = await suggestions();
    if (token !== paintToken) return;
    if (!result) note = T('st.prod.needPhoto');
    else {
      note = T('st.prod.basedOn');
      items = result.map((r) => ({ product: r.product, reasons: r.reasons.map((k) => T(`st.reason.${k}`)) }));
    }
  } else if (state.productTab === 'popular') {
    const popular = DATA.products.filter((p) => p.popularity > 0).sort((a, b) => b.popularity - a.popularity).slice(0, 8);
    note = popular.length ? T('st.prod.popularBasis') : T('st.prod.popularNone');
    items = popular.map((p) => ({ product: p, reasons: [T('st.reason.enquiries', { n: p.popularity })] }));
  } else {
    const q = state.productFilter.trim().toLowerCase().replace(/^#0*/, '');
    items = DATA.products
      .filter((p) => !q || String(p.code) === q || p.name.toLowerCase().includes(q) || `${p.w}x${p.h}`.includes(q.replace(/[×*\s]/g, 'x')))
      .sort((a, b) => (b.texture ? 1 : 0) - (a.texture ? 1 : 0) || a.code - b.code)
      .map((p) => ({ product: p, reasons: [] }));
  }
  ui.prodNote.textContent = note;
  clear(ui.prodList);
  for (const { product, reasons } of items) ui.prodList.appendChild(productCard(product, reasons));
}

function productCard(p, reasons) {
  const selected = state.product && state.product.code === p.code;
  const status = { available: 'status.available', out: 'status.out', ask: 'status.ask' }[p.availability];
  return el('article', { class: `st-prod${selected ? ' is-on' : ''}${p.texture ? '' : ' is-disabled'}` },
    p.image ? el('img', { src: p.image, alt: '', loading: 'lazy' }) : el('span', { class: 'st-prod-img' }),
    el('div', { class: 'st-prod-body' },
      el('strong', { text: `${p.no} · ${p.name}` }),
      el('small', { text: [p.w && p.h ? `${p.w} × ${p.h} ${T('cm')}` : '', p.price != null ? money(p.price) : '', T(status)].filter(Boolean).join(' · ') }),
      reasons.length ? el('ul', { class: 'st-reasons' }, ...reasons.map((r) => el('li', { text: r }))) : null,
      p.texture
        ? el('button', { type: 'button', class: `st-btn st-btn-sm${selected ? ' st-btn-primary' : ''}`, onclick: () => selectProduct(p), text: selected ? T('st.prod.selected') : T('st.prod.preview') })
        : el('p', { class: 'st-note', title: T('st.prod.noTextureHelp'), text: T('st.prod.noTexture') }),
      el('a', { href: p.url, class: 'st-link', target: '_blank', rel: 'noopener', text: T('st.prod.details') })));
}

async function selectProduct(p, render = true) {
  state.product = p;
  state.layout.groutMm = p.groutMm ?? 3;
  state.layout.groutColor = p.groutColor || '#8c877f';
  paintLayout();
  paintSelected();
  paintProducts();
  updateMeasure();
  try {
    await textureFor(p);
  } catch {
    message(T('st.prod.noTextureHelp'));
    return;
  }
  beacon('apply', p.id);
  if (render) {
    if (!photo() || !hasMask(photo())) message(T('st.prod.needFloor'));
    else setView('design');
  }
  schedule(true);
}

function hasMask(p) {
  if (!p) return false;
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(p.mask, 0, 0, 32, 32);
  const a = ctx.getImageData(0, 0, 32, 32).data;
  for (let i = 3; i < a.length; i += 4) if (a[i] > 127) return true;
  return false;
}

function paintSelected() {
  clear(ui.selected);
  const p = state.product;
  if (!p) {
    ui.selected.appendChild(el('p', { class: 'st-note', text: T('st.prod.needFloor') }));
    ui.realSize.textContent = '';
    return;
  }
  const status = { available: 'status.available', out: 'status.out', ask: 'status.ask' }[p.availability];
  ui.selected.appendChild(el('div', { class: 'st-selected-card' },
    p.image ? el('img', { src: p.image, alt: '' }) : null,
    el('div', null,
      el('strong', { text: `${p.no} · ${p.name}` }),
      el('small', { text: [p.w && p.h ? `${p.w} × ${p.h} ${T('cm')}` : '', p.price != null ? money(p.price) : '', T(status)].filter(Boolean).join(' · ') }),
      el('a', { href: p.url, class: 'st-link', target: '_blank', rel: 'noopener', text: T('st.prod.details') }))));
  ui.realSize.textContent = p.w && p.h ? T('st.adj.real', { size: `${p.w} × ${p.h}` }) : '';
}

function paintLayout() {
  ui.pattern.querySelectorAll('[data-pattern]').forEach((b) => b.setAttribute('aria-pressed', (b.dataset.pattern === 'brick') === state.layout.brick ? 'true' : 'false'));
  ui.rotate.checked = state.layout.rotate90;
  ui.shadows.checked = state.layout.shadows;
  ui.groutColor.value = state.layout.groutColor;
  for (const key of ['angle', 'scale', 'offsetX', 'offsetY', 'groutMm']) {
    const r = ui[`r_${key}`];
    if (r) { r.input.value = state.layout[key]; r.out.textContent = r.fmtFn(state.layout[key]); }
  }
}

// ---------- Rendering ----------
let scheduled = false;
let patternDirty = true;
let pattern = null;
function schedule(rebuildPattern = false) {
  if (rebuildPattern) patternDirty = true;
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => { scheduled = false; renderDesign(); });
}

function currentGeometry(p) {
  if (!p || !p.corners || !isConvexQuad(p.corners) || !(p.rect.length > 0) || !(p.rect.width > 0)) return null;
  const H = floorHomography(p.corners, p.rect.length, p.rect.width);
  const Hinv = H && invert3(H);
  return H && Hinv ? { H, Hinv } : null;
}

async function ensurePattern() {
  const prod = state.product;
  if (!prod) return null;
  const tex = await textureFor(prod);
  if (!tex) return null;
  if (patternDirty || !pattern || pattern.code !== prod.code) {
    const built = buildPattern(tex.img, {
      tileW: prod.w || 40, tileH: prod.h || 40, groutMm: state.layout.groutMm, groutColor: state.layout.groutColor,
      brick: state.layout.brick, rotate90: state.layout.rotate90,
    });
    pattern = { ...built, code: prod.code };
    if (renderer) renderer.upload('uPattern', pattern.canvas, { repeat: true });
    patternDirty = false;
  }
  return pattern;
}

/** Draws the current design into the WebGL canvas. Returns false when something is still missing. */
async function renderDesign() {
  const p = photo();
  if (!renderer || !p) return false;
  const geo = currentGeometry(p);
  const pat = await ensurePattern().catch(() => null);
  if (!geo || !pat) {
    if (state.view === 'design' || state.view === 'compare' || state.view === 'side') message(!pat ? T('st.prod.needFloor') : T('st.persp.hint'));
    return false;
  }
  if (!p.illum) {
    p.illum = buildIllumination(p.canvas, p.mask);
    renderer.upload('uIllum', p.illum.canvas);
  }
  renderer.render({
    width: p.canvas.width,
    height: p.canvas.height,
    Hinv: geo.Hinv,
    periodW: pat.periodW * state.layout.scale,
    periodH: pat.periodH * state.layout.scale,
    angle: (state.layout.angle * Math.PI) / 180,
    offsetX: state.layout.offsetX,
    offsetY: state.layout.offsetY,
    shadows: state.layout.shadows,
  });
  if (['design', 'compare', 'side'].includes(state.view)) message('');
  if (state.view === '3d') refresh3D();
  return true;
}

// ---------- Views ----------
function setView(view) {
  if (view === '3d' && !hasWebgl) { message(T('st.3d.noWebgl')); return; }
  state.view = view;
  ui.viewBar.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.view === view ? 'true' : 'false'));
  const box = ui.canvasBox;
  box.dataset.view = view;
  ui.stage.classList.toggle('is-3d', view === '3d');
  const pressed = ui.viewBar.querySelector('[aria-pressed="true"]');
  if (pressed) {
    // Scroll only the button bar sideways, never the page.
    const bar = ui.viewBar.getBoundingClientRect();
    const btn = pressed.getBoundingClientRect();
    if (btn.left < bar.left) ui.viewBar.scrollLeft -= bar.left - btn.left + 8;
    else if (btn.right > bar.right) ui.viewBar.scrollLeft += btn.right - bar.right + 8;
  }
  ui.gl.hidden = !['design', 'compare', 'side'].includes(view);
  ui.original.hidden = view === 'design';
  ui.handle.hidden = view !== 'compare';
  ui.base.hidden = !(view === 'compare' && state.compareBase);
  ui.original.style.visibility = view === 'compare' && state.compareBase ? 'hidden' : '';
  ui.three.hidden = view !== '3d';
  box.style.display = view === '3d' ? 'none' : '';
  ui.empty.hidden = !!photo() || view === '3d';
  if (view === 'compare') setSplit(50);
  else ui.gl.style.clipPath = '';
  if (view === '3d') open3D();
  drawOverlay();
  schedule();
}

function setupSplit() {
  let dragging = false;
  const move = (e) => {
    const r = ui.canvasBox.getBoundingClientRect();
    setSplit(((e.clientX - r.left) / r.width) * 100);
  };
  ui.handle.addEventListener('pointerdown', (e) => { dragging = true; ui.handle.setPointerCapture(e.pointerId); move(e); });
  ui.handle.addEventListener('pointermove', (e) => { if (dragging) move(e); });
  ui.handle.addEventListener('pointerup', () => { dragging = false; });
  ui.handle.addEventListener('keydown', (e) => {
    const v = Number(ui.handle.getAttribute('aria-valuenow')) || 50;
    if (e.key === 'ArrowLeft') setSplit(v - 5);
    if (e.key === 'ArrowRight') setSplit(v + 5);
  });
  ui.canvasBox.addEventListener('pointerdown', (e) => {
    if (state.view === 'compare' && e.target !== ui.handle) { move(e); }
  });
}

function setSplit(percent) {
  const v = Math.max(0, Math.min(100, percent));
  ui.handle.style.left = `${v}%`;
  ui.handle.setAttribute('aria-valuenow', String(Math.round(v)));
  // The design shows on one side of the line, the original (or a kept design) on the other.
  ui.gl.style.clipPath = `inset(0 0 0 ${v}%)`;
}

// ---------- 3D ----------
async function open3D() {
  const p = photo();
  clear(ui.threeBar);
  const modeBtn = (mode, key) => el('button', { type: 'button', 'aria-pressed': state.threeMode === mode ? 'true' : 'false', onclick: () => { state.threeMode = mode; open3D(); }, text: T(key) });
  ui.threeBar.append(
    el('div', { class: 'st-seg' }, modeBtn('floor', 'st.3d.floor'), modeBtn('photo', 'st.3d.photo')),
    el('div', { class: 'st-row st-3d-presets' },
      ...(state.threeMode === 'photo' ? ['front', 'left', 'right', 'corner', 'top'] : ['corner', 'top', 'front', 'left', 'right'])
        .map((name) => el('button', { type: 'button', class: 'st-tool', onclick: () => state.three && state.three.preset(name), text: T(name === 'front' && state.threeMode === 'photo' ? 'st.3d.camera' : `st.3d.${name}`) })),
      el('button', { type: 'button', class: 'st-tool', onclick: () => state.three && state.three.preset('reset'), text: T('st.3d.reset') }),
      el('button', { type: 'button', class: 'st-tool', onclick: () => state.three && state.three.fullscreen(), text: T('st.3d.fullscreen') }),
      el('label', { class: 'st-check' }, el('input', { type: 'checkbox', onchange: (e) => state.three && state.three.setQuality(e.target.checked) }), T('st.3d.quality')),
      state.threeMode === 'photo'
        ? el('label', { class: 'st-check' }, el('input', { type: 'checkbox', checked: state.threeOriginal, onchange: (e) => { state.threeOriginal = e.target.checked; state.three && state.three.setPhotoSource(e.target.checked ? photo().canvas : ui.gl); } }), T('st.3d.original'))
        : null));
  ui.threeNote.textContent = `${T(state.threeMode === 'floor' ? 'st.3d.floorNote' : 'st.3d.photoNote')} ${T('st.3d.help')}`;
  const ready = p && currentGeometry(p) && state.product && (await renderDesign());
  if (!ready) {
    message(T('st.3d.needFloor'));
    return;
  }
  if (!state.three) {
    try {
      const mod = await import('./studio-3d.js');
      state.three = mod.create3D(ui.threeBox);
      beacon('view3d', state.product && state.product.id);
    } catch {
      message(T('st.3d.noWebgl'));
      return;
    }
  }
  refresh3D();
}

function refresh3D() {
  const p = photo();
  const geo = currentGeometry(p);
  if (!state.three || !geo || !pattern) return;
  if (state.threeMode === 'floor') {
    state.three.showFloor({
      patternCanvas: pattern.canvas,
      periodW: pattern.periodW * state.layout.scale,
      periodH: pattern.periodH * state.layout.scale,
      angle: (state.layout.angle * Math.PI) / 180,
      offsetX: state.layout.offsetX,
      offsetY: state.layout.offsetY,
      length: p.rect.length,
      width: p.rect.width,
    });
    message('');
  } else {
    const ok = state.three.showPhoto({ designCanvas: ui.gl, originalCanvas: p.canvas, H: geo.H, maskCanvas: p.mask, imgW: p.canvas.width, imgH: p.canvas.height, useOriginal: state.threeOriginal });
    message(ok ? '' : T('st.3d.calibrate'));
  }
}

// ---------- Measurements ----------
function paintSections() {
  clear(ui.sections);
  state.measure.sections.forEach((sec, i) => {
    const l = el('input', { type: 'number', class: 'st-input', min: 0, step: 0.1, value: sec.l, 'aria-label': T('st.m.sectionL'), placeholder: T('st.m.sectionL'), oninput: (e) => { sec.l = e.target.value; updateMeasure(); } });
    const w = el('input', { type: 'number', class: 'st-input', min: 0, step: 0.1, value: sec.w, 'aria-label': T('st.m.sectionW'), placeholder: T('st.m.sectionW'), oninput: (e) => { sec.w = e.target.value; updateMeasure(); } });
    ui.sections.appendChild(el('div', { class: 'st-section-row' }, l, el('span', { text: '×' }), w,
      el('button', { type: 'button', class: 'st-tool', 'aria-label': T('st.m.remove'), onclick: () => { state.measure.sections.splice(i, 1); paintSections(); updateMeasure(); }, text: '×' })));
  });
}

function quantities() {
  const p = photo();
  const sections = state.measure.sections.reduce((s, x) => s + (Number(x.l) > 0 && Number(x.w) > 0 ? Number(x.l) * Number(x.w) : 0), 0);
  const base = areaEstimate();
  const area = base + sections;
  const prod = state.product;
  let perM2 = null;
  let tiles = null;
  let total = null;
  if (prod && prod.w && prod.h) {
    const g = state.layout.groutMm / 10;
    perM2 = 10000 / ((prod.w + g) * (prod.h + g));
    tiles = Math.ceil(area * perM2);
    total = Math.ceil(area * perM2 * (1 + state.measure.waste / 100));
  }
  let photoEstimate = null;
  const geo = currentGeometry(p);
  if (p && geo && hasMask(p)) {
    const rectArea = p.rect.length * p.rect.width;
    photoEstimate = photoArea(p.mask, geo.Hinv, Math.max(0.02, rectArea / 400));
  }
  return { area, perM2, tiles, total, photoEstimate };
}

function updateMeasure() {
  const q = quantities();
  clear(ui.results);
  const row = (k, v, cls) => el('div', { class: cls || '' }, el('dt', { text: k }), el('dd', { text: v }));
  ui.results.append(row(T('st.m.area'), `${fmt(q.area, 2)} m²`), el('p', { class: 'st-src', text: T('st.m.src.customer') }));
  if (q.photoEstimate && q.photoEstimate.area > 0) {
    ui.results.append(
      row(T('st.m.areaPhoto'), `≈ ${fmt(q.photoEstimate.area, 1)} m²`),
      el('p', { class: 'st-src' }, T('st.m.src.photo'), ' ',
        el('button', { type: 'button', class: 'st-link', onclick: () => { state.measure.floorArea = q.photoEstimate.area.toFixed(1); ui.mFloor.value = state.measure.floorArea; updateMeasure(); }, text: '↑' })));
  }
  if (state.product && q.perM2) {
    ui.results.append(
      row(T('st.m.tile'), `${state.product.w} × ${state.product.h} ${T('cm')}`),
      row(T('st.m.perM2'), fmt(q.perM2, 2)),
      row(T('st.m.tiles'), `${q.tiles} ${T('st.m.pcs')}`),
      row(T('st.m.total'), `${q.total} ${T('st.m.pcs')}`, 'is-total'),
      el('p', { class: 'st-src', text: T('st.m.withWaste', { p: state.measure.waste }) }));
  } else {
    ui.results.append(el('p', { class: 'st-note', text: T('st.m.needTile') }));
  }
  return q;
}

// ---------- Designs (compare) ----------
function keepDesign() {
  if (!state.product || !photo()) { message(T('st.prod.needFloor')); return; }
  renderDesign().then((ok) => {
    if (!ok) return;
    const label = String.fromCharCode(65 + (state.designs.length % 26));
    const thumb = document.createElement('canvas');
    thumb.width = 200;
    thumb.height = Math.round((ui.gl.height / ui.gl.width) * 200);
    thumb.getContext('2d').drawImage(ui.gl, 0, 0, thumb.width, thumb.height);
    state.designs.push({ label, product: state.product, layout: { ...state.layout }, photo: state.active, image: ui.gl.toDataURL('image/jpeg', 0.85), thumb: thumb.toDataURL('image/jpeg', 0.8) });
    if (state.designs.length > 6) state.designs.shift();
    paintDesigns();
  });
}

function paintDesigns() {
  clear(ui.designs);
  if (!state.designs.length) { ui.designs.appendChild(el('p', { class: 'st-note', text: T('st.d.none') })); return; }
  state.designs.forEach((d, i) => {
    ui.designs.appendChild(el('div', { class: 'st-design' },
      el('img', { src: d.thumb, alt: '' }),
      el('div', null,
        el('strong', { text: `${T('st.d.label', { x: d.label })} · ${d.product.no}` }),
        el('div', { class: 'st-row' },
          el('button', { type: 'button', class: 'st-tool', onclick: () => { state.layout = { ...d.layout }; if (d.photo !== state.active && state.photos[d.photo]) activate(d.photo); selectProduct(d.product); }, text: T('st.d.open') }),
          el('button', { type: 'button', class: 'st-tool', onclick: () => { state.compareBase = d; ui.base.src = d.image; setView('compare'); }, text: T('st.d.compare') }),
          el('button', { type: 'button', class: 'st-tool', 'aria-label': T('st.m.remove'), onclick: () => { state.designs.splice(i, 1); paintDesigns(); }, text: '×' })))));
  });
}

// ---------- Save, share, send ----------
function savedProjects() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch { return []; }
}
function storeProjects(list) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(list.slice(-20))); } catch { /* private mode */ }
}

function projectData() {
  const q = quantities();
  const prod = state.product;
  return {
    productId: prod ? prod.id : null,
    productCode: prod ? prod.code : null,
    productName: prod ? prod.name : '',
    tileSize: prod && prod.w && prod.h ? `${prod.w} × ${prod.h}` : '',
    layout: state.layout,
    measure: { floorArea: state.measure.floorArea, sections: state.measure.sections, waste: state.measure.waste },
    area: Number(q.area.toFixed(2)),
    tiles: q.total,
    waste: state.measure.waste,
    designs: state.designs.map((d) => ({ label: d.label, productId: d.product.id, productCode: d.product.code, layout: d.layout })),
  };
}

async function api(method, url, body, isForm) {
  const headers = {};
  if (state.project) headers['X-Project-Key'] = state.project.key;
  if (body && !isForm) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { method, headers, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || T('st.s.error'));
  return data;
}

async function save() {
  if (!state.photos.length) { ui.saveStatus.textContent = T('st.s.needDesign'); return null; }
  if (!state.consent) { ui.saveStatus.textContent = T('st.s.needConsent'); ui.consent.focus(); return null; }
  ui.saveBtn.disabled = true;
  ui.saveStatus.textContent = T('st.s.saving');
  try {
    if (!state.project) {
      const created = await api('POST', '/api/studio/projects', { consent: true, lang: DATA.lang, description: state.description, data: projectData() });
      state.project = { id: created.id, ref: created.ref, key: created.key, expiresAt: created.expiresAt };
      storeProjects([...savedProjects().filter((x) => x.id !== created.id), { id: created.id, ref: created.ref, key: created.key, expiresAt: created.expiresAt, savedAt: Date.now() }]);
    } else {
      await api('PUT', `/api/studio/projects/${state.project.id}`, { description: state.description, data: projectData() });
    }
    const activeBefore = state.active;
    for (let i = 0; i < state.photos.length; i++) {
      if (state.active !== i) activate(i);
      const ok = await renderDesign();
      const p = state.photos[i];
      const form = new FormData();
      form.append('original', await canvasBlob(p.canvas, 'image/jpeg', 0.85), 'original.jpg');
      if (ok) form.append('result', await canvasBlob(ui.gl, 'image/jpeg', 0.85), 'result.jpg');
      form.append('mask', await canvasBlob(p.mask, 'image/png'), 'mask.png');
      form.append('data', JSON.stringify({ corners: p.corners, rect: p.rect, points: p.points, w: p.canvas.width }));
      await api('PUT', `/api/studio/projects/${state.project.id}/views/${i}`, form, true);
    }
    if (state.active !== activeBefore) activate(activeBefore);
    ui.saveStatus.textContent = T('st.s.saved', { ref: state.project.ref });
    ui.saveBtn.textContent = T('st.s.update');
    history.replaceState(null, '', `${location.pathname}#p=${state.project.id}.${state.project.key}`);
    paintProject();
    paintMine();
    return state.project;
  } catch (error) {
    ui.saveStatus.textContent = error.message || T('st.s.error');
    return null;
  } finally {
    ui.saveBtn.disabled = false;
  }
}

function paintProject() {
  clear(ui.projectBox);
  if (!state.project) return;
  ui.projectBox.append(
    el('p', null, el('strong', { text: `${T('st.s.ref')}: ${state.project.ref}` })),
    el('p', { class: 'st-note', text: T('st.s.kept', { date: new Date(state.project.expiresAt).toLocaleDateString() }) }),
    el('div', { class: 'st-row' },
      el('button', { type: 'button', class: 'st-tool', onclick: reportProblem, text: T('st.s.report') }),
      el('button', { type: 'button', class: 'st-tool st-danger', onclick: deleteProject, text: T('st.s.delete') })));
}

function paintMine() {
  clear(ui.mine);
  const list = savedProjects().filter((x) => x.expiresAt > Date.now() && (!state.project || x.id !== state.project.id));
  if (!list.length) return;
  ui.mine.append(el('p', { class: 'st-sub', text: T('st.s.mine') }),
    ...list.reverse().map((x) => el('div', { class: 'st-row' }, el('span', { text: x.ref }),
      el('button', { type: 'button', class: 'st-tool', onclick: () => openProject(x.id, x.key), text: T('st.s.open') }))));
}

async function shareUrl() {
  const project = state.project || (await save());
  if (!project) return null;
  const r = await api('POST', `/api/studio/projects/${project.id}/share`);
  return { url: `${location.origin}${r.path}`, expiresAt: r.expiresAt };
}

async function copyShare() {
  try {
    const share = await shareUrl();
    if (!share) return;
    try { await navigator.clipboard.writeText(share.url); } catch { window.prompt('', share.url); }
    ui.saveStatus.textContent = T('st.s.shareDone', { date: new Date(share.expiresAt).toLocaleDateString() });
  } catch (error) {
    ui.saveStatus.textContent = error.message;
  }
}

async function sendToFactory() {
  // The window is opened first (browsers block pop-ups opened after a delay), then pointed at WhatsApp.
  const win = window.open('', '_blank');
  try {
    const share = await shareUrl();
    if (!share) { if (win) win.close(); return; }
    const prod = state.product;
    const q = quantities();
    const lines = [T('st.wa.intro', { name: DATA.shopName })];
    if (prod) lines.push(T('st.wa.product', { code: prod.no, product: prod.name, size: prod.w && prod.h ? `${prod.w} × ${prod.h} ${T('cm')}` : '' }));
    if (q.area > 0 && q.total) lines.push(T('st.wa.area', { area: fmt(q.area, 1), tiles: q.total }));
    lines.push(T('st.wa.ask'), T('st.wa.ref', { ref: state.project.ref }), share.url);
    const url = `https://wa.me/${DATA.whatsapp}?text=${encodeURIComponent(lines.join('\n'))}`;
    beacon('quote', prod && prod.id);
    if (win) win.location.href = url;
    else location.href = url;
  } catch (error) {
    if (win) win.close();
    ui.saveStatus.textContent = error.message;
  }
}

async function downloadImage() {
  const p = photo();
  if (!p) return;
  const ok = await renderDesign();
  const source = ok ? ui.gl : p.canvas;
  const out = document.createElement('canvas');
  out.width = source.width;
  out.height = source.height + 44;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#141414';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(source, 0, 0);
  ctx.fillStyle = '#d2b48c';
  ctx.font = '600 18px Inter, "Noto Kufi Arabic", sans-serif';
  ctx.textBaseline = 'middle';
  const label = [DATA.shopName, T('st.short'), state.product ? `${state.product.no} · ${state.product.w} × ${state.product.h} ${T('cm')}` : '', state.project ? state.project.ref : ''].filter(Boolean).join(' · ');
  ctx.fillText(label, 14, source.height + 22);
  const blob = await canvasBlob(out, 'image/jpeg', 0.9);
  const a = el('a', { href: URL.createObjectURL(blob), download: `kargay-shre-design${state.project ? `-${state.project.ref}` : ''}.jpg` });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  beacon('download', state.product && state.product.id);
}

async function deleteProject() {
  if (!state.project || !window.confirm(T('st.s.deleteConfirm'))) return;
  try {
    await api('DELETE', `/api/studio/projects/${state.project.id}`);
    storeProjects(savedProjects().filter((x) => x.id !== state.project.id));
    state.project = null;
    history.replaceState(null, '', location.pathname);
    ui.saveBtn.textContent = T('st.s.save');
    ui.saveStatus.textContent = T('st.s.deleted');
    paintProject();
    paintMine();
  } catch (error) {
    ui.saveStatus.textContent = error.message;
  }
}

async function reportProblem() {
  const text = window.prompt(T('st.s.reportPrompt'));
  if (!text || !state.project) return;
  try {
    await api('POST', `/api/studio/projects/${state.project.id}/report`, { message: text });
    ui.saveStatus.textContent = T('st.s.reportSent');
  } catch (error) {
    ui.saveStatus.textContent = error.message;
  }
}

/** Reopens a saved project on this device (owner key from the address or local storage). */
async function openProject(id, key) {
  state.project = { id, key };
  try {
    const project = await api('GET', `/api/studio/projects/${id}`);
    state.project = { id, key, ref: project.ref, expiresAt: project.expiresAt };
    state.description = project.description || '';
    ui.description.value = state.description;
    state.consent = true;
    ui.consent.checked = true;
    const d = project.data || {};
    if (d.layout) state.layout = { ...state.layout, ...d.layout };
    if (d.measure) state.measure = { ...state.measure, ...d.measure };
    ui.mFloor.value = state.measure.floorArea || '';
    ui.mWaste.value = state.measure.waste;
    state.photos = [];
    for (const view of project.views) {
      const fetchImg = async (kind) => {
        const res = await fetch(`/api/studio/projects/${id}/views/${view.idx}/${kind}`, { headers: { 'X-Project-Key': key } });
        if (!res.ok) return null;
        const url = URL.createObjectURL(await res.blob());
        try { return await loadImage(url); } finally { URL.revokeObjectURL(url); }
      };
      const original = await fetchImg('original');
      if (!original) continue;
      addPhoto(toWorkingCanvas(original), `${project.ref}-${view.idx + 1}`);
      const p = photo();
      const maskImg = view.hasMask ? await fetchImg('mask') : null;
      if (maskImg) p.mask.getContext('2d').drawImage(maskImg, 0, 0, p.mask.width, p.mask.height);
      if (view.data.corners) {
        const sx = p.canvas.width / (view.data.w || original.naturalWidth || p.canvas.width);
        p.corners = view.data.corners.map(([x, y]) => [x * sx, y * sx]);
      }
      if (view.data.rect) p.rect = view.data.rect;
      if (Array.isArray(view.data.points)) p.points = view.data.points.map(([x, y, inc]) => [x * sx, y * sx, !!inc]);
      afterMask();
    }
    if (state.photos.length) activate(0);
    paintLayout();
    paintSections();
    const prod = d.productCode != null ? DATA.products.find((x) => x.code === d.productCode) : null;
    if (prod) await selectProduct(prod);
    ui.saveBtn.textContent = T('st.s.update');
    paintProject();
    paintMine();
    setView(prod ? 'design' : 'mask');
  } catch {
    state.project = null;
    storeProjects(savedProjects().filter((x) => x.id !== id));
    message(T('st.s.notFound'));
    paintMine();
  }
}

build();
paintDesigns();
