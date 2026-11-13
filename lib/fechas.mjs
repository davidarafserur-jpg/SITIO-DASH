// Fechas en hora de la Ciudad de México (UTC-6 todo el año desde 2022).
// Las fechas de calendario se manejan como texto "AAAA-MM-DD".
import { esModoPrueba } from './config.mjs';

const TZ = 'America/Mexico_City';

function partes(d = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  return Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value]));
}

const dos = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${dos(m)}-${dos(d)}`;

/** Hoy en CDMX. En modo prueba se puede simular con HOY_SIMULADO=AAAA-MM-DD. */
export function hoyCDMX() {
  const sim = process.env.HOY_SIMULADO;
  if (sim && /^\d{4}-\d{2}-\d{2}$/.test(sim) && esModoPrueba()) return sim;
  const p = partes();
  return iso(p.year, p.month, p.day);
}

/** "AAAA-MM-DD HH:mm" en CDMX. */
export function ahoraCDMX() {
  const p = partes();
  return `${hoyCDMX()} ${p.hour}:${p.minute}`;
}

export function sumarMeses(fecha, meses) {
  const [y, m, d] = fecha.split('-').map(Number);
  const total = y * 12 + (m - 1) + meses;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const ultimoDia = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return iso(ny, nm, Math.min(d, ultimoDia));
}

export function sumarDias(fecha, dias) {
  const [y, m, d] = fecha.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + dias));
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Días de `desde` a `hasta` (positivo si `hasta` es posterior). */
export function diasEntre(desde, hasta) {
  const a = Date.UTC(...desde.split('-').map((n, i) => Number(n) - (i === 1 ? 1 : 0)));
  const b = Date.UTC(...hasta.split('-').map((n, i) => Number(n) - (i === 1 ? 1 : 0)));
  return Math.round((b - a) / 86400000);
}

export function maxFecha(a, b) {
  return a > b ? a : b;
}

/** Último día de vigencia de un periodo de `meses` que empieza en `inicio`. */
export function finDeVigencia(inicio, meses) {
  return sumarDias(sumarMeses(inicio, meses), -1);
}

/**
 * Convierte lo que venga de Sheets a "AAAA-MM-DD": texto ISO, "AAAA-MM-DD HH:mm",
 * "DD/MM/AAAA" o número de serie de fecha de Sheets. Devuelve '' si no se reconoce.
 */
export function normalizarFecha(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') {
    const t = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
    return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(m[1], m[2], m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return iso(m[3], m[2], m[1]);
  return '';
}
