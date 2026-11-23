// Precios especiales por empresa (venta directa a sus colaboradores).
// La empresa llega en el enlace o QR del vendedor: membresias.html?e=<código>&v=<vendedor>.
// IMPORTANTE: membresias.html tiene una copia de esta tabla (const EMPRESAS) para mostrar precios;
// si cambias algo aquí, cámbialo también allá. El cobro siempre usa ESTA tabla y los precios de Stripe.
//
// Montos en MXN SIN IVA. Anual = paga 10 meses, recibe 12.

export const EMPRESAS = {
  // Plan de Ejecución La Cosmopolitana · Sede Iztapalapa (nov 2026): $439 por colaborador (20% sobre $549)
  cosmopolitana: {
    nombre: 'La Cosmopolitana',
    paquetes: [
      { clave: 'individual', nombre: 'Individual', personas: 1, mensual: 439, anual: 4390 },
      { clave: 'duo', nombre: 'Dúo', personas: 2, mensual: 699, anual: 6990 },
      { clave: 'familiar', nombre: 'Familiar', personas: 4, mensual: 999, anual: 9990 },
      { clave: 'extendido', nombre: 'Extendido', personas: 7, mensual: 1499, anual: 14990 },
    ],
    // Programa Fundadores: 20% en el primer pago mensual (cupón de Stripe, una sola vez).
    fundadores: { activo: true, porcentaje: 20, cupon: 'FUNDADORES_COSMO' },
  },
};

export const empresaConPrecio = (codigo) => EMPRESAS[String(codigo || '').toLowerCase()] || null;

/** El paquete más chico que alcanza para `personas` (titular + familiares). */
export function paqueteParaPersonas(empresa, personas) {
  return empresa.paquetes.find((p) => p.personas >= personas) || null;
}

/** lookup_key del precio en Stripe: dash_empresa_<empresa>_<paquete>_<modalidad> */
export const lookupEmpresa = (codigo, paquete, modalidad) => `dash_empresa_${codigo}_${paquete}_${modalidad}`;
export const esLookupEmpresa = (k) => /^dash_empresa_[a-z0-9]+_[a-z]+_(mensual|anual)$/.test(String(k || ''));
export const modalidadDeLookup = (k) => String(k || '').match(/_(mensual|anual)$/)?.[1] || '';
