// Cliente mínimo de Facturapi (CFDI 4.0). https://docs.facturapi.io
import { opcional, requerida } from './config.mjs';

const BASE = 'https://www.facturapi.io/v2';

async function api(ruta, cuerpo, method = 'POST') {
  const r = await fetch(`${BASE}${ruta}`, {
    method,
    headers: { Authorization: `Bearer ${requerida('FACTURAPI_KEY')}`, 'Content-Type': 'application/json' },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Facturapi ${r.status}: ${datos.message || JSON.stringify(datos)}`);
  return datos;
}

/**
 * @param {object} p
 * @param {{rfc, razonSocial, regimen, cp, correo}} p.receptor
 * @param {{descripcion, precioConIva, cantidad?, folio?}[]} p.conceptos
 * @param {string} p.formaPago   c_FormaPago (01 efectivo, 03 transferencia, 04 crédito, 28 débito, 99 por definir)
 * @param {string} p.uso         c_UsoCFDI (G03, D01, S01…)
 * @param {object} [p.global]    { periodicity, months, year } para factura global
 */
export async function emitirCfdi({ receptor, conceptos, formaPago, uso, global, externalId }) {
  const cuerpo = {
    type: 'I',
    customer: {
      legal_name: receptor.razonSocial,
      tax_id: receptor.rfc,
      tax_system: receptor.regimen,
      email: receptor.correo || undefined,
      address: { zip: receptor.cp },
    },
    items: conceptos.map((c) => ({
      quantity: c.cantidad || 1,
      product: {
        description: c.descripcion,
        product_key: opcional('SAT_CLAVE_PRODUCTO', '01010101'),
        unit_key: opcional('SAT_CLAVE_UNIDAD', 'E48'),
        price: c.precioConIva,
        tax_included: true,
        taxes: [{ type: 'IVA', rate: 0.16 }],
        sku: c.folio || undefined,
      },
    })),
    use: uso,
    payment_form: formaPago || '99',
    payment_method: 'PUE',
    external_id: externalId || undefined,
  };
  if (global) cuerpo.global = global;
  return api('/invoices', cuerpo);
}

export async function enviarCfdiPorCorreo(id, correo) {
  return api(`/invoices/${id}/email`, correo ? { email: correo } : {});
}

export const PUBLICO_EN_GENERAL = {
  rfc: 'XAXX010101000',
  razonSocial: 'PUBLICO EN GENERAL',
  regimen: '616',
};
