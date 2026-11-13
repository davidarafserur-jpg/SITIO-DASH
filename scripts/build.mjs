// Copia el sitio estático a /dist para publicarlo en Netlify.
// Deja fuera el código de la automatización, la documentación, archivos ocultos y respaldos.
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';

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
