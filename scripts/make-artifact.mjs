// Turns the single-file embed build into a page fragment for a host that supplies its own
// <html>/<head>/<body> skeleton (a shared Artifact link). Usage: node scripts/make-artifact.mjs out.html
import { readFileSync, writeFileSync } from 'node:fs';

const out = process.argv[2] ?? 'dist-embed/tandem.html';
const html = readFileSync('dist-embed/index.html', 'utf8');
const pick = (re) => [...html.matchAll(re)].map((m) => m[0]);
const styles = pick(/<style[\s\S]*?<\/style>/g);
const scripts = pick(/<script[\s\S]*?<\/script>/g);
if (!scripts.length) throw new Error('No inlined script found — run `vite build --mode embed` first.');
const page = [
  '<title>Tandem</title>',
  '<meta name="theme-color" content="#0F4C5C">',
  ...styles,
  '<div id="root"></div>',
  ...scripts,
].join('\n');
// Some hosts reject a literal U+FFFD (it usually signals corrupted text). In this bundle it only
// appears inside JS string/regex literals, where the escape \uFFFD is equivalent.
const safe = page.replace(/\uFFFD/g, '\\uFFFD');
writeFileSync(out, safe);
console.log(`Wrote ${out} (${(safe.length / 1024).toFixed(0)} KB)`);
