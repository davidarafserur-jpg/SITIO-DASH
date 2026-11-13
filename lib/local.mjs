// Modo local (sólo con `npm run local`, nunca en Netlify):
// - Sin SHEET_ID, las pestañas se guardan en .local/hoja.json en lugar de Google Sheets.
// - Sin RESEND_API_KEY, los correos se guardan en .local/correos/ en lugar de enviarse.
// - La idempotencia (Netlify Blobs) se guarda en .local/blobs.json.
// La carpeta .local/ no se sube a git ni se publica.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { opcional } from './config.mjs';
import { PESTANAS, SEMILLAS } from './esquema.mjs';

export function esLocal() {
  return process.env.MODO_LOCAL === '1' && !process.env.NETLIFY && !process.env.AWS_LAMBDA_FUNCTION_NAME;
}
export const sheetsLocal = () => esLocal() && !opcional('SHEET_ID');
export const correoLocal = () => esLocal() && !opcional('RESEND_API_KEY');

export const carpetaLocal = () => path.resolve(process.env.CARPETA_LOCAL || path.join(process.cwd(), '.local'));

// Un solo escritor a la vez (los eventos de Stripe llegan en paralelo)
let cola = Promise.resolve();
function enCola(fn) {
  const r = cola.then(fn, fn);
  cola = r.catch(() => {});
  return r;
}

async function leerJson(nombre, porDefecto) {
  try { return JSON.parse(await readFile(path.join(carpetaLocal(), nombre), 'utf8')); } catch { return porDefecto; }
}
async function escribirJson(nombre, datos) {
  await mkdir(carpetaLocal(), { recursive: true });
  await writeFile(path.join(carpetaLocal(), nombre), JSON.stringify(datos, null, 2));
}

// ---------- Blobs ----------
export const blobsLocal = {
  get: (k) => enCola(async () => { const d = await leerJson('blobs.json', {}); return k in d ? d[k] : null; }),
  set: (k, v) => enCola(async () => { const d = await leerJson('blobs.json', {}); d[k] = v; await escribirJson('blobs.json', d); }),
};

// ---------- Hoja ----------
// En local se agrega un vendedor de ejemplo (V012) para ver el reparto vendedor + líder.
const SEMILLAS_LOCALES = {
  Vendedores: [...(SEMILLAS.Vendedores || []), { codigo: 'V012', nombre: 'Vendedor de prueba', lider: 'PAULO', activo: 'sí' }],
};

async function hoja() {
  const h = await leerJson('hoja.json', null);
  if (h) return h;
  const nueva = Object.fromEntries(Object.keys(PESTANAS).map((p) => [p, SEMILLAS_LOCALES[p] || SEMILLAS[p] || []]));
  await escribirJson('hoja.json', nueva);
  return nueva;
}

export const hojaLocal = {
  leer: () => enCola(async () => {
    const h = await hoja();
    return h;
  }),
  leerTabla: (pestana) => enCola(async () => {
    const h = await hoja();
    return (h[pestana] || []).map((o, i) => ({ ...o, _fila: i + 2 }));
  }),
  agregarFilas: (pestana, objetos) => enCola(async () => {
    const h = await hoja();
    const claves = PESTANAS[pestana].map(([k]) => k);
    h[pestana] = h[pestana] || [];
    for (const o of objetos) h[pestana].push(Object.fromEntries(claves.map((k) => [k, o[k] ?? ''])));
    await escribirJson('hoja.json', h);
  }),
  actualizarFilas: (pestana, cambios) => enCola(async () => {
    const h = await hoja();
    const claves = PESTANAS[pestana].map(([k]) => k);
    for (const { fila, cambios: c } of cambios) {
      const o = h[pestana]?.[fila - 2];
      if (!o) throw new Error(`Fila ${fila} no existe en ${pestana} (local)`);
      for (const [k, v] of Object.entries(c)) {
        if (!claves.includes(k)) throw new Error(`Columna "${k}" no existe en ${pestana}`);
        o[k] = v ?? '';
      }
    }
    await escribirJson('hoja.json', h);
  }),
};

// ---------- Correos ----------
export async function guardarCorreoLocal(correo) {
  return enCola(async () => {
    const lista = await leerJson('correos.json', []);
    const id = `local_${Date.now()}_${lista.length + 1}`;
    lista.push({ id, en: new Date().toISOString(), ...correo, adjuntos: (correo.adjuntos || []).map((a) => ({ filename: a.filename, content: a.content })) });
    await escribirJson('correos.json', lista);
    console.log(`[local] Correo guardado (no enviado): "${correo.asunto}" → ${[].concat(correo.para).join(', ')}`);
    return { id };
  });
}
export const correosLocales = () => enCola(() => leerJson('correos.json', []));
