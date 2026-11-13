// Lectura de variables de entorno y constantes del producto.

export function requerida(nombre) {
  const v = process.env[nombre];
  if (v === undefined || String(v).trim() === '') {
    throw new Error(`Falta la variable de entorno ${nombre}`);
  }
  return String(v).trim();
}

export function opcional(nombre, porDefecto = '') {
  const v = process.env[nombre];
  return v === undefined || String(v).trim() === '' ? porDefecto : String(v).trim();
}

export function bandera(nombre, porDefecto = false) {
  const v = opcional(nombre).toLowerCase();
  if (!v) return porDefecto;
  return ['1', 'true', 'si', 'sí', 'yes'].includes(v);
}

export function numero(nombre, porDefecto) {
  const n = Number(opcional(nombre, String(porDefecto)));
  if (!Number.isFinite(n)) throw new Error(`La variable ${nombre} debe ser un número`);
  return n;
}

export function esModoPrueba() {
  return /^(sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY || '');
}

export function lista(nombre) {
  return requerida(nombre).split(',').map((s) => s.trim()).filter(Boolean);
}

export function urlSitio() {
  return (opcional('SITE_URL') || process.env.URL || '').replace(/\/$/, '');
}

export function liderPorDefecto() {
  return opcional('LIDER_CODIGO', 'PAULO').toUpperCase();
}

export const PRODUCTO = {
  marca: 'DASH MEDIC CARE',
  planEverHealth: 'Basic',
  membresia: 'Salud Digital',
  telefono: '(55) 8120-2122',
};

// Meses de vigencia de cada prepago
export const MESES_PREPAGO = { trimestral: 3, anual: 12 };

export function esPrepago(modalidad) {
  return Object.hasOwn(MESES_PREPAGO, String(modalidad || '').toLowerCase());
}

export function grupoDe(empresa) {
  return `DASH Individual – ${empresa || 'web'}`;
}
