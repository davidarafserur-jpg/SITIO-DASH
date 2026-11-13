// Cálculo de comisiones. Función pura: no toca Stripe ni Sheets (se prueba con `npm test`).
import { esSi, normalizar } from './texto.mjs';

/**
 * Reglas en pesos por membresía.
 * SUPUESTO (pendiente de definir por DASH): en prepagos, el pago cuenta como 1 cierre
 * + (meses comisionables − 1) mensualidades, todo en el momento del cobro; en una
 * renovación de prepago todos los meses cuentan como mensualidad (sin cierre).
 * Se puede cambiar sin tocar código con la variable COMISIONES_JSON.
 */
export const REGLAS_PREDETERMINADAS = {
  lider: { cierre: 149, mensual: 50 },
  vendedor: { cierre: 120, mensual: 30 },
  liderSobreVendedor: { cierre: 29, mensual: 20 },
  prepago: {
    mesesComisionables: { trimestral: 3, anual: 12 },
    cierreEnRenovacion: false,
  },
  // Si un vendedor está marcado como inactivo, ¿sigue cobrando residuales?
  pagarAInactivos: false,
};

function fusionar(base, extra) {
  if (!extra || typeof extra !== 'object') return base;
  const r = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(extra)) {
    r[k] = v && typeof v === 'object' && !Array.isArray(v) && typeof base[k] === 'object'
      ? fusionar(base[k], v) : v;
  }
  return r;
}

export function reglasComisiones(json = process.env.COMISIONES_JSON) {
  if (!json) return REGLAS_PREDETERMINADAS;
  try { return fusionar(REGLAS_PREDETERMINADAS, JSON.parse(json)); } catch {
    throw new Error('COMISIONES_JSON no es un JSON válido');
  }
}

/** Cuántos cierres y cuántas mensualidades representa un cobro. */
export function unidadesDelCobro({ tipo, modalidad, cantidad = 1 }, reglas = REGLAS_PREDETERMINADAS) {
  const n = Math.max(1, Number(cantidad) || 1);
  let cierres = 0;
  let mensuales = 0;
  if (tipo === 'cierre') cierres = 1;
  else if (tipo === 'mensual') mensuales = 1;
  else if (tipo === 'prepago' || tipo === 'renovacion') {
    const meses = reglas.prepago.mesesComisionables[modalidad];
    if (!meses) throw new Error(`Sin meses comisionables para la modalidad "${modalidad}"`);
    const conCierre = tipo === 'prepago' || reglas.prepago.cierreEnRenovacion;
    cierres = conCierre ? 1 : 0;
    mensuales = meses - cierres;
  } else {
    throw new Error(`Tipo de cobro desconocido: ${tipo}`);
  }
  return { cierres: cierres * n, mensuales: mensuales * n };
}

/**
 * @param {object} p
 * @param {string} p.vendedor        código que vino en client_reference_id
 * @param {object[]} p.vendedores    filas de la pestaña Vendedores {codigo, nombre, lider, activo}
 * @param {object} p.cobro           { tipo: cierre|mensual|prepago|renovacion, modalidad, cantidad }
 * @param {string} p.lider           código del líder por defecto (LIDER_CODIGO)
 * @returns {{ filas: {codigo, nombre, rol, monto, detalle}[], notas: string[] }}
 */
export function calcularComisiones({ vendedor, vendedores = [], cobro, reglas = REGLAS_PREDETERMINADAS, lider = 'PAULO' }) {
  const notas = [];
  const filas = [];
  const codigo = String(vendedor || '').trim().toUpperCase();
  const liderDefecto = String(lider || '').trim().toUpperCase();
  const buscar = (c) => vendedores.find((v) => String(v.codigo || '').trim().toUpperCase() === c);

  if (!codigo || codigo === 'DIRECTO') {
    notas.push('Venta directa (sin código de vendedor): no genera comisión');
    return { filas, notas };
  }

  let v = buscar(codigo);
  if (!v && codigo === liderDefecto) v = { codigo, nombre: codigo, lider: codigo, activo: 'sí' };
  if (!v) {
    notas.push(`Código de vendedor "${codigo}" no está en la pestaña Vendedores: no genera comisión`);
    return { filas, notas };
  }

  const { cierres, mensuales } = unidadesDelCobro(cobro, reglas);
  const monto = (tarifa) => cierres * tarifa.cierre + mensuales * tarifa.mensual;
  const detalle = (tarifa) => [
    cierres ? `${cierres} cierre × $${tarifa.cierre}` : '',
    mensuales ? `${mensuales} mensual × $${tarifa.mensual}` : '',
  ].filter(Boolean).join(' + ');
  const activo = (fila) => esSi(fila.activo, true) || reglas.pagarAInactivos;

  const codigoLider = String(v.lider || '').trim().toUpperCase();
  const esLider = !codigoLider || codigoLider === codigo;

  if (esLider) {
    if (activo(v)) filas.push({ codigo, nombre: v.nombre || codigo, rol: 'líder', monto: monto(reglas.lider), detalle: detalle(reglas.lider) });
    else notas.push(`Líder ${codigo} inactivo: no se paga`);
    return { filas, notas };
  }

  if (activo(v)) {
    filas.push({ codigo, nombre: v.nombre || codigo, rol: 'vendedor', monto: monto(reglas.vendedor), detalle: detalle(reglas.vendedor) });
  } else {
    notas.push(`Vendedor ${codigo} inactivo: no se paga su parte`);
  }

  const l = buscar(codigoLider) || (codigoLider === liderDefecto ? { codigo: codigoLider, nombre: codigoLider, activo: 'sí' } : null);
  if (!l) {
    notas.push(`El líder "${codigoLider}" de ${codigo} no está en Vendedores: no se paga la parte de líder`);
  } else if (!activo(l)) {
    notas.push(`Líder ${codigoLider} inactivo: no se paga la parte de líder`);
  } else {
    filas.push({
      codigo: codigoLider, nombre: l.nombre || codigoLider, rol: 'líder',
      monto: monto(reglas.liderSobreVendedor),
      detalle: `${detalle(reglas.liderSobreVendedor)} (sobre venta de ${codigo})`,
    });
  }
  return { filas, notas };
}

export function esReverso(fila) {
  return normalizar(fila.tipo) === 'reverso';
}
