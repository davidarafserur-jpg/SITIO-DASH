// Copia el sitio estático a /dist para publicarlo en Netlify.
// Deja fuera el código de la automatización, la documentación, archivos ocultos y respaldos.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';

const EXCLUIR = new Set([
  'node_modules', 'netlify', 'lib', 'scripts', 'test', 'dist',
  'package.json', 'package-lock.json', 'netlify.toml',
]);
const EXCLUIR_PATRON = [
  /^\./,                 // .git, .env, .netlify, .claude, .gitignore…
  /\.md$/i,              // README.md, PRUEBAS.md
  /^index\.respaldo/i,   // respaldos locales de index.html
];

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist');

const copiados = [];
for (const nombre of readdirSync('.')) {
  if (EXCLUIR.has(nombre) || EXCLUIR_PATRON.some((r) => r.test(nombre))) continue;
  cpSync(nombre, `dist/${nombre}`, { recursive: true });
  copiados.push(nombre);
}
console.log(`[build] Publicando en dist/: ${copiados.join(', ')}`);

// Payment Links desde variables de entorno (STRIPE_LINK_MENSUAL / _TRIMESTRAL / _ANUAL):
// sólo se llenan los que estén vacíos en membresias.html; el archivo original no se modifica.
const LINKS = {
  digital_mensual: process.env.STRIPE_LINK_MENSUAL,
  digital_trimestral: process.env.STRIPE_LINK_TRIMESTRAL,
  digital_anual: process.env.STRIPE_LINK_ANUAL,
};
if (existsSync('dist/membresias.html') && Object.values(LINKS).some(Boolean)) {
  let html = readFileSync('dist/membresias.html', 'utf8');
  const puestos = [];
  for (const [clave, url] of Object.entries(LINKS)) {
    if (!url || !/^https:\/\/buy\.stripe\.com\/[A-Za-z0-9_]+$/.test(url)) continue;
    const re = new RegExp(`(${clave}\\s*:\\s*)''`);
    if (re.test(html)) { html = html.replace(re, `$1'${url}'`); puestos.push(clave); }
  }
  // Sitio de pruebas: franja visible para que nadie confunda los pagos de prueba con reales
  if (Object.values(LINKS).some((u) => /\/test_/.test(u || ''))) {
    const aviso = '<div style="position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#f59e0b;color:#111;font:600 13px/1.4 system-ui;padding:6px 12px;text-align:center">SITIO DE PRUEBAS — nada se cobra de verdad · tarjeta 4242 4242 4242 4242</div>';
    html = html.replace('</body>', `${aviso}</body>`);
  }
  writeFileSync('dist/membresias.html', html);
  if (puestos.length) console.log(`[build] Payment Links desde variables de entorno: ${puestos.join(', ')}`);
}
