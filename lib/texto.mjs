// Utilidades de texto.

export function normalizar(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

/** Interpreta "sí", "si", "x", "true", "1"… Vacío cuenta como `siVacio`. */
export function esSi(valor, siVacio = false) {
  const v = normalizar(valor);
  if (!v) return siVacio;
  return ['si', 'yes', 'true', '1', 'x', 'activo'].includes(v);
}

export function escaparHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** CSV con comillas siempre, separado por comas. `columnas` = [[clave, encabezado], ...] */
export function aCsv(columnas, filas) {
  const celda = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lineas = [columnas.map(([, h]) => celda(h)).join(',')];
  for (const f of filas) lineas.push(columnas.map(([k]) => celda(f[k])).join(','));
  return lineas.join('\r\n');
}

export function redondear(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export function agregarNota(notas, nueva) {
  return notas ? `${notas} | ${nueva}` : nueva;
}

export function pesos(n) {
  return `$${Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
