/* AI Studio: floor selection on the visitor's device with ONNX Runtime Web.
   Model: SlimSAM-77 (a compressed Segment Anything model, Apache-2.0). The photo is encoded once; each prompt
   (points on the floor to include or exclude) is then decoded in a few tens of milliseconds.
   Photos are processed here, in the browser; nothing is uploaded for this. */
import * as ort from '/vendor/ort/ort.wasm.min.mjs';

ort.env.wasm.wasmPaths = '/vendor/ort/';
// Threads need cross-origin isolation, which the site does not use; one thread works everywhere.
ort.env.wasm.numThreads = 1;

const BASE = '/models/Xenova/slimsam-77-uniform/onnx/';
const ENCODER = `${BASE}vision_encoder_quantized.onnx`;
const DECODER = `${BASE}prompt_encoder_mask_decoder_quantized.onnx`;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];
const SIZE = 1024;
const CACHE = 'ks-studio-models-v2';

let sessions = null;
const embeddings = new Map(); // photo key → { image_embeddings, image_positional_embeddings }

/** Downloads a model file once and keeps it in the browser cache. */
async function fetchModel(url, progress) {
  let cache = null;
  try {
    cache = await caches.open(CACHE);
    const hit = await cache.match(url);
    if (hit) return new Uint8Array(await hit.arrayBuffer());
  } catch { /* Cache API unavailable (private mode): download normally */ }
  const res = await fetch(url);
  if (!res.ok) throw new Error('model-download');
  const total = Number(res.headers.get('content-length')) || 0;
  let bytes;
  if (!res.body || !total) {
    bytes = new Uint8Array(await res.arrayBuffer());
  } else {
    const reader = res.body.getReader();
    const chunks = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      progress(loaded, total);
    }
    bytes = new Uint8Array(loaded);
    let offset = 0;
    for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
  }
  if (cache) cache.put(url, new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } })).catch(() => {});
  return bytes;
}

async function load() {
  if (sessions) return sessions;
  const sizes = { enc: 8_882_165, dec: 4_903_810 };
  const done = { enc: 0, dec: 0 };
  const report = (part) => (loaded) => {
    done[part] = loaded;
    postMessage({ type: 'progress', loaded: done.enc + done.dec, total: sizes.enc + sizes.dec });
  };
  const [enc, dec] = await Promise.all([fetchModel(ENCODER, report('enc')), fetchModel(DECODER, report('dec'))]);
  const options = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
  sessions = { encoder: await ort.InferenceSession.create(enc, options), decoder: await ort.InferenceSession.create(dec, options) };
  return sessions;
}

/** pixels: RGBA of the photo resized so its longest side is 1024 (width × height). */
async function encode(key, pixels, width, height) {
  const { encoder } = await load();
  const plane = SIZE * SIZE;
  const input = new Float32Array(3 * plane); // zero padding to the right and bottom, as the model expects
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const o = y * SIZE + x;
      input[o] = (pixels[i] / 255 - MEAN[0]) / STD[0];
      input[plane + o] = (pixels[i + 1] / 255 - MEAN[1]) / STD[1];
      input[2 * plane + o] = (pixels[i + 2] / 255 - MEAN[2]) / STD[2];
    }
  }
  const out = await encoder.run({ pixel_values: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]) });
  embeddings.set(key, out);
  while (embeddings.size > 4) embeddings.delete(embeddings.keys().next().value);
}

/**
 * points: [[x, y, include]] in the 1024-scaled photo. Returns the selection as a grid over the padded
 * 1024 square (255 = selected), choosing the largest of the model's confident answers, because a floor is
 * usually the biggest surface at the prompted points.
 */
async function decode(key, points) {
  const { decoder } = await load();
  const emb = embeddings.get(key);
  if (!emb) throw new Error('not-encoded');
  const out = await decoder.run({
    input_points: new ort.Tensor('float32', Float32Array.from(points.flatMap((p) => [p[0], p[1]])), [1, 1, points.length, 2]),
    input_labels: new ort.Tensor('int64', BigInt64Array.from(points.map((p) => (p[2] ? 1n : 0n))), [1, 1, points.length]),
    image_embeddings: emb.image_embeddings,
    image_positional_embeddings: emb.image_positional_embeddings,
  });
  const iou = out.iou_scores.data;
  const masks = out.pred_masks.data;
  const [, , k, h, w] = out.pred_masks.dims;
  const cells = h * w;
  const areas = [];
  for (let m = 0; m < k; m++) {
    let n = 0;
    for (let j = 0; j < cells; j++) if (masks[m * cells + j] > 0) n++;
    areas.push(n);
  }
  const top = Math.max(...iou);
  let best = -1;
  for (let m = 0; m < k; m++) if (iou[m] >= top - 0.08 && (best < 0 || areas[m] > areas[best])) best = m;
  const grid = new Uint8Array(cells);
  for (let j = 0; j < cells; j++) grid[j] = masks[best * cells + j] > 0 ? 255 : 0;
  return { grid, width: w, height: h, score: iou[best] };
}

onmessage = async (event) => {
  const { type, id, key, pixels, width, height, points } = event.data;
  try {
    if (type === 'encode') {
      await encode(key, pixels, width, height);
      postMessage({ type: 'encoded', id });
    } else if (type === 'decode') {
      const result = await decode(key, points);
      postMessage({ type: 'decoded', id, ...result }, [result.grid.buffer]);
    }
  } catch (error) {
    postMessage({ type: 'error', id, message: String((error && error.message) || error) });
  }
};
