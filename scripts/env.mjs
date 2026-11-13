// Lectura y escritura del archivo .env local (nunca se sube a git).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const archivoEnv = path.join(raiz, '.env');

/** Carga .env en process.env (sin pisar lo que ya exista). */
export function cargarEnv() {
  if (!existsSync(archivoEnv)) return;
  for (const linea of readFileSync(archivoEnv, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env) && m[2] !== '') process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
}

/** Escribe o reemplaza variables en .env, conservando el resto del archivo. */
export function actualizarEnv(cambios) {
  let texto = existsSync(archivoEnv) ? readFileSync(archivoEnv, 'utf8') : '';
  for (const [k, v] of Object.entries(cambios)) {
    const re = new RegExp(`^\\s*${k}\\s*=.*$`, 'm');
    texto = re.test(texto) ? texto.replace(re, `${k}=${v}`) : `${texto.replace(/\s*$/, '')}\n${k}=${v}\n`;
    process.env[k] = v;
  }
  writeFileSync(archivoEnv, texto);
}
