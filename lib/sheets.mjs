// Acceso a Google Sheets con una cuenta de servicio (API REST v4).
import { JWT } from 'google-auth-library';
import { requerida } from './config.mjs';
import { PESTANAS, SEMILLAS } from './esquema.mjs';
import { normalizar } from './texto.mjs';

let cliente;
let pestanasListas = false;

function credenciales() {
  let raw = requerida('GOOGLE_SERVICE_ACCOUNT_JSON');
  if (!raw.startsWith('{')) raw = Buffer.from(raw, 'base64').toString('utf8');
  let c;
  try { c = JSON.parse(raw); } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON no es un JSON válido');
  }
  if (!c.client_email || !c.private_key) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON debe incluir client_email y private_key');
  }
  return { email: c.client_email, key: c.private_key.replace(/\\n/g, '\n') };
}

function google() {
  if (!cliente) {
    const { email, key } = credenciales();
    cliente = new JWT({ email, key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  }
  return cliente;
}

async function api(ruta, { method = 'GET', data, params } = {}) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${requerida('SHEET_ID')}${ruta}`;
  try {
    const r = await google().request({ url, method, data, params });
    return r.data;
  } catch (e) {
    const msg = e.response?.data?.error?.message || e.message;
    throw new Error(`Google Sheets (${method} ${ruta.split('?')[0]}): ${msg}`);
  }
}

const rango = (pestana, a1) => encodeURIComponent(`'${pestana}'!${a1}`);

function letra(indice) {
  let s = '';
  for (let n = indice + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  }
  return s;
}

function esquemaDe(pestana) {
  const cols = PESTANAS[pestana];
  if (!cols) throw new Error(`Pestaña desconocida: ${pestana}`);
  return cols;
}

/** Crea las pestañas que falten y escribe encabezados en las vacías. Una vez por arranque. */
export async function asegurarPestanas() {
  if (pestanasListas) return;
  const meta = await api('?fields=sheets.properties.title');
  const existentes = new Set((meta.sheets || []).map((s) => s.properties.title));
  const faltantes = Object.keys(PESTANAS).filter((p) => !existentes.has(p));
  if (faltantes.length) {
    await api(':batchUpdate', {
      method: 'POST',
      data: { requests: faltantes.map((title) => ({ addSheet: { properties: { title } } })) },
    });
  }
  for (const pestana of Object.keys(PESTANAS)) {
    const r = await api(`/values/${rango(pestana, '1:1')}`);
    if (!r.values?.length) {
      const encabezados = esquemaDe(pestana).map(([, h]) => h);
      const filas = [encabezados, ...(SEMILLAS[pestana] || []).map((o) => esquemaDe(pestana).map(([k]) => o[k] ?? ''))];
      await api(`/values/${rango(pestana, 'A1')}?valueInputOption=RAW`, {
        method: 'PUT', data: { values: filas },
      });
    }
  }
  pestanasListas = true;
}

/** Mapa índice de columna → clave interna, según los encabezados reales de la hoja. */
function mapearEncabezados(pestana, encabezados) {
  const porTexto = new Map(esquemaDe(pestana).map(([k, h]) => [normalizar(h), k]));
  return encabezados.map((h) => porTexto.get(normalizar(h)) || null);
}

async function leerEncabezados(pestana) {
  await asegurarPestanas();
  const r = await api(`/values/${rango(pestana, '1:1')}`);
  const enc = r.values?.[0] || [];
  const claves = mapearEncabezados(pestana, enc);
  const faltan = esquemaDe(pestana).filter(([k]) => !claves.includes(k)).map(([, h]) => h);
  if (faltan.length) {
    throw new Error(`A la pestaña "${pestana}" le faltan las columnas: ${faltan.join(', ')}`);
  }
  return claves;
}

/**
 * Lee una pestaña completa. Cada fila es un objeto con las claves internas
 * y `_fila` (número de fila en la hoja, empezando en 2).
 */
export async function leerTabla(pestana) {
  await asegurarPestanas();
  const r = await api(`/values/${rango(pestana, 'A1:ZZ')}`, {
    params: { valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' },
  });
  const [enc = [], ...resto] = r.values || [];
  const claves = mapearEncabezados(pestana, enc);
  const filas = [];
  resto.forEach((valores, i) => {
    if (!valores.some((v) => v !== '' && v !== null && v !== undefined)) return;
    const o = { _fila: i + 2 };
    claves.forEach((k, j) => {
      if (!k) return;
      const v = valores[j];
      o[k] = typeof v === 'string' ? v.trim() : (v ?? '');
    });
    filas.push(o);
  });
  return filas;
}

/** Agrega filas al final. Los objetos usan claves internas; las desconocidas se ignoran. */
export async function agregarFilas(pestana, objetos) {
  if (!objetos.length) return;
  const claves = await leerEncabezados(pestana);
  const values = objetos.map((o) => claves.map((k) => (k && o[k] !== undefined && o[k] !== null ? o[k] : '')));
  await api(`/values/${rango(pestana, 'A1')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: 'POST', data: { values },
  });
}

/** Actualiza celdas: cambios = [{ fila, cambios: { clave: valor } }] */
export async function actualizarFilas(pestana, cambios) {
  if (!cambios.length) return;
  const claves = await leerEncabezados(pestana);
  const data = [];
  for (const { fila, cambios: c } of cambios) {
    for (const [k, v] of Object.entries(c)) {
      const col = claves.indexOf(k);
      if (col < 0) throw new Error(`Columna "${k}" no existe en ${pestana}`);
      data.push({ range: `'${pestana}'!${letra(col)}${fila}`, values: [[v ?? '']] });
    }
  }
  await api('/values:batchUpdate', { method: 'POST', data: { valueInputOption: 'RAW', data } });
}

export async function actualizarFila(pestana, fila, cambios) {
  return actualizarFilas(pestana, [{ fila, cambios }]);
}
