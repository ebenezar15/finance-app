/**
 * Reads the text of a picture (a payment-receipt screenshot) on the device, with Tesseract
 * compiled to WebAssembly. Nothing is uploaded and nothing is fetched from another origin: the
 * worker script, the wasm core and the English language data are bundled as assets of this app
 * and handed to tesseract.js as same-origin URLs.
 *
 * All of it (about 0.2 MB of script, a 3.9 MB core and 2.9 MB of language data) is loaded on
 * first use only, through dynamic imports, so none of it is in the main bundle. The single-file
 * embed build cannot ship separate worker/wasm files, so OCR is switched off there
 * (`ocrAvailable()` is false and the imports below are compiled out).
 *
 * Two things matter for receipt screens, and both were measured rather than guessed:
 *  - "Sparse text" page segmentation. Tesseract's block modes drop the big, isolated amount in the
 *    middle of a Google Pay or Paytm screen; sparse mode finds it. Its output is unordered, so the
 *    words are put back into visual rows here.
 *  - The rupee sign. The English model has no "₹", so it comes out as "3", "2", "%", "¥"… or
 *    nothing. A digit is the dangerous case ("₹3,500" → "33,500"), so the first glyph of every
 *    number is checked against the shape of "₹" in the pixels and corrected when it matches.
 */

/** Long side, in pixels, that pictures are scaled down to before reading. */
export const OCR_MAX_SIDE = 1600;

const EMBED = !!import.meta.env.VITE_EMBED;

/** False in the single-file embed build and in browsers without workers / WebAssembly / canvas. */
export function ocrAvailable(): boolean {
  if (EMBED) return false;
  return typeof Worker !== 'undefined' && typeof WebAssembly === 'object' && typeof document !== 'undefined'
    && typeof HTMLCanvasElement !== 'undefined';
}

// ---- Picture → greyscale canvas ----

interface Grey { lum: Uint8ClampedArray; width: number; height: number }
export interface Box { x0: number; y0: number; x1: number; y1: number }

async function decode(file: Blob): Promise<{ src: CanvasImageSource; width: number; height: number; done: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file);
      return { src: bmp, width: bmp.width, height: bmp.height, done: () => bmp.close() };
    } catch { /* some formats only decode through <img>; try that next */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((ok, fail) => { img.onload = () => ok(); img.onerror = () => fail(new Error('This picture couldn’t be opened.')); img.src = url; });
    return { src: img, width: img.naturalWidth, height: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
  } catch (e) { URL.revokeObjectURL(url); throw e; }
}

/**
 * Draws the picture at most OCR_MAX_SIDE on its long side, in greyscale, dark text on light: a
 * dark-mode screenshot is inverted, which reads noticeably better.
 */
async function prepare(file: Blob): Promise<{ canvas: HTMLCanvasElement } & Grey> {
  const pic = await decode(file);
  try {
    if (!pic.width || !pic.height) throw new Error('This picture couldn’t be opened.');
    const scale = Math.min(1, OCR_MAX_SIDE / Math.max(pic.width, pic.height));
    const width = Math.max(1, Math.round(pic.width * scale)), height = Math.max(1, Math.round(pic.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('This browser can’t read pictures.');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(pic.src, 0, 0, width, height);
    const img = ctx.getImageData(0, 0, width, height);
    const px = img.data, lum = new Uint8ClampedArray(width * height);
    let sum = 0;
    for (let i = 0, j = 0; i < px.length; i += 4, j++) { lum[j] = (px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8; sum += lum[j]; }
    const dark = (globalThis as any).__k?.noInvert ? false : sum / lum.length < 110;
    for (let i = 0, j = 0; i < px.length; i += 4, j++) {
      if (dark) lum[j] = 255 - lum[j];
      px[i] = px[i + 1] = px[i + 2] = lum[j]; px[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return { canvas, lum, width, height };
  } finally { pic.done(); }
}

// ---- The rupee sign ----

/**
 * Splits a word's box into glyphs (runs of inked columns) and says whether the first one has the
 * shape of "₹": a full-width bar along the top, a second full-width bar a quarter of the way
 * down, a thin join between them, and a single diagonal leg below that ends in a point. No digit
 * has two wide bars in its top half, which is what keeps "3", "2", "5" and "7" out.
 */
export function rupeeGlyph(g: Grey, box: Box): { glyphs: number; rupee: boolean } {
  const x0 = Math.max(0, Math.floor(box.x0) - 2), x1 = Math.min(g.width - 1, Math.ceil(box.x1) + 2);
  const y0 = Math.max(0, Math.floor(box.y0) - 2), y1 = Math.min(g.height - 1, Math.ceil(box.y1) + 2);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  if (w < 8 || h < 10) return { glyphs: 0, rupee: false };
  // Background = the commonest shade in the box; ink = anything clearly away from it.
  const hist = new Uint32Array(32);
  let lo = 255, hi = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const v = g.lum[y * g.width + x]; hist[v >> 3]++; if (v < lo) lo = v; if (v > hi) hi = v; }
  let bgBin = 0;
  for (let i = 1; i < 32; i++) if (hist[i] > hist[bgBin]) bgBin = i;
  const bg = bgBin * 8 + 4;
  const reach = Math.max(bg - lo, hi - bg);
  if (reach < 40) return { glyphs: 0, rupee: false };
  const cut = reach * 0.45;
  const ink = (x: number, y: number) => Math.abs(g.lum[(y0 + y) * g.width + x0 + x] - bg) > cut;

  const cols: [number, number][] = [];
  let start = -1;
  for (let x = 0; x <= w; x++) {
    let on = false;
    if (x < w) for (let y = 0; y < h; y++) if (ink(x, y)) { on = true; break; }
    if (on && start < 0) start = x;
    if (!on && start >= 0) { cols.push([start, x - 1]); start = -1; }
  }
  if (!cols.length) return { glyphs: 0, rupee: false };
  const [c0, c1] = cols[0];
  const gw = c1 - c0 + 1;
  let r0 = -1, r1 = -1;
  const rows: number[] = [], runs: number[] = [];
  for (let y = 0; y < h; y++) {
    let n = 0, r = 0, prev = false;
    for (let x = c0; x <= c1; x++) { const on = ink(x, y); if (on) { n++; if (!prev) r++; } prev = on; }
    rows.push(n / gw); runs.push(r);
    if (n) { if (r0 < 0) r0 = y; r1 = y; }
  }
  const gh = r1 - r0 + 1;
  // Too small to judge, or not glyph-shaped (two letters run together, a rule, a speck).
  if (gh < 12 || gw < gh * 0.3 || gw > gh * 0.95) return { glyphs: cols.length, rupee: false };
  const at = (f: number) => r0 + Math.round(f * (gh - 1));
  const span = (a: number, b: number) => rows.slice(at(a), at(b) + 1);
  const peak = (a: number, b: number) => { const s = span(a, b); const m = Math.max(...s); return { m, y: at(a) + s.indexOf(m) }; };
  const top = peak(0, 0.12), second = peak(0.17, 0.36);
  const between = Math.min(1, ...rows.slice(top.y + 1, second.y));
  const foot = Math.max(...span(0.9, 1));
  // Below the second bar there is only the leg: one stroke per row, never wide (bold faces reach 0.6).
  const leg = rows.slice(at(0.62), at(0.9) + 1), legRuns = runs.slice(at(0.62), at(0.9) + 1);
  // Measured over five font families, two weights, 18–130 px: on "₹" both bars cover ≥ 0.89 of the
  // width; on every digit at least one of them is ≤ 0.8.
  const rupee = top.m >= 0.85 && second.m >= 0.85 && between <= 0.45 && foot <= 0.5
    && Math.max(...leg) <= 0.65 && legRuns.every((r) => r === 1);
  if ((globalThis as any).__k?.dbg) console.log('F', JSON.stringify({ gw, gh, top: +top.m.toFixed(2), second: +second.m.toFixed(2), sy: +((second.y - r0) / gh).toFixed(2), between: +between.toFixed(2), foot: +foot.toFixed(2), leg: +Math.max(...leg).toFixed(2), legRuns: Math.max(...legRuns), rupee }));
  return { glyphs: cols.length, rupee };
}

/** A word that is only a number, as an amount is printed: "250", "1,249.50", "33,500". */
const NUMBER_WORD = /^\d[\d,]*(?:\.\d{1,2})?$/;

/** Puts the "₹" back when the pixels say the number starts with one (or that one was left out). */
function fixRupee(text: string, box: Box, g: Grey): string {
  if (!NUMBER_WORD.test(text) || text.length > 12) return text;
  const { glyphs, rupee } = rupeeGlyph(g, box);
  if (!rupee) return text;
  // The sign read as a digit. Only the digits it has been seen to turn into are ever replaced.
  if (glyphs === text.length && text.length > 1 && /^[237]/.test(text)) return `₹${text.slice(1)}`;
  if (glyphs === text.length + 1) return `₹${text}`;                          // the sign was skipped
  return text;
}

// ---- Words → rows ----

interface OcrWord { text: string; bbox: Box }
interface OcrLine { words: OcrWord[]; bbox: Box }

/**
 * Sparse-text mode returns fragments in no useful order ("Ramesh Stores" and the "₹250" at the
 * other end of the same row come back separately). Fragments that overlap vertically are joined
 * left to right, and the rows are returned top to bottom.
 */
export function toRows(lines: OcrLine[]): string[] {
  const rows: { y0: number; y1: number; parts: OcrLine[] }[] = [];
  for (const l of [...lines].sort((a, b) => a.bbox.y0 - b.bbox.y0)) {
    const h = l.bbox.y1 - l.bbox.y0;
    const row = rows.find((r) => {
      const overlap = Math.min(r.y1, l.bbox.y1) - Math.max(r.y0, l.bbox.y0);
      const rh = r.y1 - r.y0;
      // Same row: they overlap by most of the shorter one, and are of comparable size.
      return overlap >= Math.min(h, rh) * 0.6 && Math.max(h, rh) <= Math.min(h, rh) * 2.2
        && r.parts.every((p) => p.bbox.x1 <= l.bbox.x0 + 2 || l.bbox.x1 <= p.bbox.x0 + 2);
    });
    if (row) { row.parts.push(l); row.y0 = Math.min(row.y0, l.bbox.y0); row.y1 = Math.max(row.y1, l.bbox.y1); }
    else rows.push({ y0: l.bbox.y0, y1: l.bbox.y1, parts: [l] });
  }
  return rows
    .sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1))
    .map((r) => r.parts.sort((a, b) => a.bbox.x0 - b.bbox.x0).map((p) => p.words.map((w) => w.text).join(' ')).join('  ').trim())
    .filter(Boolean);
}

// ---- Tesseract, loaded on first use ----

type TWorker = import('tesseract.js').Worker;

/** WebAssembly SIMD (every current browser; missing on Android WebViews before Chrome 91). */
const hasSimd = () => {
  try { return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])); } catch { return false; }
};
const abs = (u: string) => new URL(u, document.baseURI).href;

let worker: Promise<TWorker> | undefined;
let idle: ReturnType<typeof setTimeout> | undefined;
let onProgress: ((fraction: number) => void) | undefined;

/**
 * `import.meta.env.VITE_EMBED` is a build-time constant, so in the embed build this whole function
 * (and with it the 7 MB of assets its imports would pull in) is dropped from the bundle.
 */
const load: (() => Promise<TWorker>) | null = import.meta.env.VITE_EMBED ? null : async () => {
  const [{ createWorker }, workerUrl, coreUrl, langUrl] = await Promise.all([
    import('tesseract.js'),
    import('tesseract.js/dist/worker.min.js?url').then((m) => m.default),
    // LSTM-only cores: the legacy engine isn't used, and they are about 0.6 MB smaller.
    (hasSimd() ? import('tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url') : import('tesseract.js-core/tesseract-core-lstm.wasm.js?url')).then((m) => m.default),
    import('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz?url').then((m) => m.default),
  ]);
  const w = await createWorker('eng', 1 /* LSTM only */, {
    workerPath: abs(workerUrl),
    corePath: abs(coreUrl),
    // A plain same-origin worker: no blob: indirection, and no CDN fallback is ever consulted.
    workerBlobURL: false,
    // tesseract.js fetches `${langPath}/eng.traineddata.gz`, which can't name a hashed asset. Ending
    // langPath with "#" turns what it appends into a URL fragment, which is never sent, so the
    // worker requests exactly our own asset.
    langPath: `${abs(langUrl)}#`,
    // The service worker / HTTP cache keeps the file; don't copy 5 MB into IndexedDB as well.
    cacheMethod: 'none',
    logger: (m) => { if (m.status === 'recognizing text') onProgress?.(m.progress); },
  });
  await w.setParameters({
    tessedit_pageseg_mode: '11' as never, // PSM.SPARSE_TEXT
    user_defined_dpi: '200',
    preserve_interword_spaces: '1',
  });
  return w;
};

function getWorker(): Promise<TWorker> {
  if (!load) return Promise.reject(new Error('Reading pictures isn’t available in this version of Tandem.'));
  return (worker ??= load().catch((e) => {
    worker = undefined;
    console.warn('OCR failed to start', e);
    throw new Error('The text reader couldn’t be loaded. If you’re offline, open this once with a connection so it can be saved on the phone.');
  }));
}

/** Frees the worker (roughly 100 MB of memory). It is also freed after a minute and a half unused. */
export async function closeOcr(): Promise<void> {
  clearTimeout(idle);
  const w = worker;
  worker = undefined;
  if (w) await w.then((x) => x.terminate()).catch(() => undefined);
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * The text in a picture, one visual row per line, top to bottom. Calls are queued: one picture is
 * read at a time. `progress` is called with 0…1 while the text is being recognised.
 */
export function readImageText(file: Blob, progress?: (fraction: number) => void): Promise<string> {
  const run = async () => {
    clearTimeout(idle);
    const [w, pic] = await Promise.all([getWorker(), prepare(file)]);
    onProgress = progress;
    try {
      const K = (globalThis as any).__k ?? {}; await w.setParameters({ tessedit_pageseg_mode: (K.psm ?? '11') as never, user_defined_dpi: K.dpi ?? '200' });
      const { data } = await w.recognize(pic.canvas, {}, { text: true, blocks: true });
      const lines: OcrLine[] = [];
      for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) {
        const words = l.words
          .filter((x) => x.text.trim() && (x.confidence >= (K.minConf ?? 15) || /\d/.test(x.text) || (console.log('DROP', x.text, Math.round(x.confidence)), false)))
          .map((x) => ({ text: fixRupee(x.text.trim(), x.bbox, pic), bbox: x.bbox }));
        if (words.length) lines.push({ words, bbox: l.bbox });
      }
      return lines.length ? toRows(lines).join('\n') : data.text.trim();
    } finally {
      onProgress = undefined;
      pic.canvas.width = pic.canvas.height = 0;
      idle = setTimeout(() => void closeOcr(), 90_000);
    }
  };
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}
