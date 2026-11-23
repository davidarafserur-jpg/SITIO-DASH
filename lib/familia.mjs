// Salud Digital familiar: el titular contrata y suma hasta 6 familiares ($275 + IVA c/u).
// Cada familiar es un usuario normal (su propia alta en Ever Health). Sólo datos de contacto.
import { normalizar } from './texto.mjs';

export const MAX_FAMILIARES = 6;
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const limpio = (s, max = 60) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * Valida la lista de familiares que manda la página.
 * @returns {{ familiares?: {nombre, apellidoPaterno, apellidoMaterno, correo}[], error?: string }}
 */
export function validarFamiliares(lista, correoTitular = '') {
  if (!Array.isArray(lista)) return { error: 'Lista de familiares inválida.' };
  if (lista.length > MAX_FAMILIARES) return { error: `Puedes sumar hasta ${MAX_FAMILIARES} familiares.` };
  const vistos = new Set([normalizar(correoTitular)].filter(Boolean));
  const familiares = [];
  for (const [i, f] of lista.entries()) {
    const n = i + 1;
    const fam = {
      nombre: limpio(f?.nombre),
      apellidoPaterno: limpio(f?.apellidoPaterno),
      apellidoMaterno: limpio(f?.apellidoMaterno),
      correo: limpio(f?.correo, 120).toLowerCase(),
    };
    if (!fam.nombre || !fam.apellidoPaterno) return { error: `Familiar ${n}: escribe nombre y apellido paterno.` };
    if (!CORREO.test(fam.correo)) return { error: `Familiar ${n}: el correo no es válido.` };
    if (vistos.has(fam.correo)) return { error: `Familiar ${n}: cada persona necesita un correo distinto (es su acceso).` };
    vistos.add(fam.correo);
    familiares.push(fam);
  }
  return { familiares };
}

/** Familiares → metadata de Stripe (una clave por familiar; cada valor < 500 caracteres). */
export function familiaresAMetadata(familiares) {
  const m = { familiares: String(familiares.length) };
  familiares.forEach((f, i) => {
    m[`fam_${i + 1}`] = JSON.stringify({ n: f.nombre, p: f.apellidoPaterno, m: f.apellidoMaterno, c: f.correo });
  });
  return m;
}

/** metadata de Stripe → familiares. */
export function familiaresDeMetadata(metadata = {}) {
  const total = Math.min(MAX_FAMILIARES, Number(metadata.familiares) || 0);
  const r = [];
  for (let i = 1; i <= total; i++) {
    try {
      const f = JSON.parse(metadata[`fam_${i}`] || '');
      r.push({ nombre: f.n || '', apellidoPaterno: f.p || '', apellidoMaterno: f.m || '', correo: String(f.c || '').toLowerCase(), celular: '' });
    } catch { /* clave faltante o dañada: se omite */ }
  }
  return r;
}

/** Referencia de la fila de un familiar: la del titular + "#f1", "#f2"… */
export const referenciaFamiliar = (referenciaTitular, i) => `${referenciaTitular}#f${i}`;
export const esReferenciaFamiliar = (ref) => /#f\d+$/.test(String(ref || ''));
export const titularDeReferencia = (ref) => String(ref || '').replace(/#f\d+$/, '');
