// Cliente de Stripe y lectores tolerantes a distintas versiones de la API.
// (Desde la versión 2025-03-31 algunos campos de Invoice cambiaron de lugar; aquí se leen ambas formas.)
import Stripe from 'stripe';
import { opcional, requerida } from './config.mjs';
import { esLookupEmpresa, lookupEmpresa, modalidadDeLookup } from './empresas.mjs';

let cliente;
export function stripe() {
  if (!cliente) cliente = new Stripe(requerida('STRIPE_SECRET_KEY'), { maxNetworkRetries: 2 });
  return cliente;
}

export const idDe = (x) => (typeof x === 'string' ? x : x?.id || '');

export function suscripcionDeFactura(inv) {
  return idDe(inv.subscription)
    || idDe(inv.parent?.subscription_details?.subscription)
    || idDe(inv.lines?.data?.find((l) => l.subscription)?.subscription)
    || idDe(inv.lines?.data?.find((l) => l.parent?.subscription_item_details)?.parent?.subscription_item_details?.subscription)
    || '';
}

/** PaymentIntent de una factura pagada; si no se encuentra, devuelve el ID de la factura. */
export async function pagoDeFactura(inv) {
  const directo = idDe(inv.payment_intent);
  if (directo) return directo;
  const incluido = inv.payments?.data?.find((p) => p.status === 'paid')?.payment?.payment_intent;
  if (incluido) return idDe(incluido);
  try {
    const pagos = await stripe().invoicePayments.list({ invoice: inv.id, limit: 5 });
    const p = pagos.data.find((x) => x.status === 'paid') || pagos.data[0];
    if (p?.payment?.payment_intent) return idDe(p.payment.payment_intent);
  } catch (e) {
    console.warn(`[stripe] No se pudo obtener el pago de la factura ${inv.id}: ${e.message}`);
  }
  return inv.id;
}

/** Forma de pago SAT (c_FormaPago) a partir del PaymentIntent. Nunca lanza error. */
export async function formaPagoSAT(pagoId) {
  if (!String(pagoId).startsWith('pi_')) return '99';
  try {
    const pi = await stripe().paymentIntents.retrieve(pagoId, { expand: ['latest_charge'] });
    const d = pi.latest_charge?.payment_method_details;
    switch (d?.type) {
      case 'card': return d.card?.funding === 'debit' ? '28' : '04';
      case 'oxxo': return '01';
      case 'customer_balance': return '03';
      default: return '99';
    }
  } catch (e) {
    console.warn(`[stripe] Forma de pago no disponible para ${pagoId}: ${e.message}`);
    return '99';
  }
}

/** Price IDs configurados → modalidad */
export function preciosConfigurados() {
  const m = {};
  for (const [modalidad, variable] of [
    ['mensual', 'STRIPE_PRICE_MENSUAL'],
    ['trimestral', 'STRIPE_PRICE_TRIMESTRAL'],
    ['anual', 'STRIPE_PRICE_ANUAL'],
  ]) {
    const id = opcional(variable);
    if (id) m[id] = modalidad;
  }
  return m;
}

/** Price IDs de los familiares de Salud Digital familiar (mensual y anual), si se configuraron. */
export function preciosFamiliares() {
  return new Set([opcional('STRIPE_PRICE_FAMILIAR_MENSUAL'), opcional('STRIPE_PRICE_FAMILIAR_ANUAL')].filter(Boolean));
}

// Los precios de familiar llevan lookup_key "dash_salud_digital_familiar_…" (scripts/stripe-prueba.mjs),
// así se reconocen aunque no estén en las variables de entorno.
const LOOKUP_FAMILIAR = 'dash_salud_digital_familiar_';
const esPrecioFamiliar = (price) => preciosFamiliares().has(price?.id) || String(price?.lookup_key || '').startsWith(LOOKUP_FAMILIAR);

/** Price ID del familiar para la modalidad: variable de entorno o búsqueda por lookup_key. */
export async function precioFamiliar(modalidad) {
  const id = opcional(modalidad === 'anual' ? 'STRIPE_PRICE_FAMILIAR_ANUAL' : 'STRIPE_PRICE_FAMILIAR_MENSUAL');
  if (id) return id;
  const r = await stripe().prices.list({ lookup_keys: [`${LOOKUP_FAMILIAR}${modalidad}_v2`, `${LOOKUP_FAMILIAR}${modalidad}`], active: true, limit: 2 });
  const p = r.data.find((x) => x.lookup_key.endsWith('_v2')) || r.data[0];
  if (!p) throw new Error(`No hay precio de familiar ${modalidad} en Stripe`);
  return p.id;
}

/**
 * Modalidad, cantidad (titulares) y familiares de una Checkout Session;
 * null si no es una membresía Salud Digital.
 */
export async function productoDeSesion(session) {
  const items = await stripe().checkout.sessions.listLineItems(session.id, { limit: 20 });
  const precios = preciosConfigurados();
  const familiares = items.data.filter((li) => esPrecioFamiliar(li.price)).reduce((t, li) => t + (li.quantity || 0), 0);
  // Paquete de empresa (p. ej. La Cosmopolitana): un solo precio que ya incluye a la familia.
  const deEmpresa = items.data.find((li) => esLookupEmpresa(li.price?.lookup_key));
  if (deEmpresa) {
    return {
      modalidad: modalidadDeLookup(deEmpresa.price.lookup_key), cantidad: 1, familiares: 0,
      paquete: deEmpresa.price.metadata?.paquete || '', personas: Number(deEmpresa.price.metadata?.personas) || 1,
      empresaPrecio: deEmpresa.price.metadata?.empresa || '',
    };
  }
  for (const li of items.data) {
    const modalidad = precios[li.price?.id];
    if (modalidad) return { modalidad, cantidad: li.quantity || 1, familiares };
  }
  if (Object.keys(precios).length) return null; // hay Price IDs configurados y ninguno coincide
  // Respaldo si aún no configuras los Price IDs: modo y monto unitario (centavos MXN)
  const li = items.data[0];
  if (!li) return null;
  if (session.mode === 'subscription') return { modalidad: 'mensual', cantidad: li.quantity || 1 };
  const porMonto = { 191052: 'trimestral', 636840: 'anual' };
  const modalidad = porMonto[li.price?.unit_amount];
  return modalidad ? { modalidad, cantidad: li.quantity || 1 } : null;
}

export function esSuscripcionDeMembresia(sub) {
  const id = opcional('STRIPE_PRICE_MENSUAL');
  if (!id) return true;
  return (sub.items?.data || []).some((i) => i.price?.id === id || esLookupEmpresa(i.price?.lookup_key));
}

/** Precio de Stripe del paquete de una empresa (por lookup_key). */
export async function precioEmpresa(codigo, paquete, modalidad) {
  const r = await stripe().prices.list({ lookup_keys: [lookupEmpresa(codigo, paquete, modalidad)], active: true, limit: 1 });
  if (!r.data[0]) throw new Error(`No hay precio de ${codigo} ${paquete} ${modalidad} en Stripe`);
  return r.data[0].id;
}

/** Número de familiares (Salud Digital familiar) en una suscripción. */
export function familiaresDeSuscripcion(sub) {
  const porPrecio = (sub.items?.data || []).filter((i) => esPrecioFamiliar(i.price)).reduce((t, i) => t + (i.quantity || 0), 0);
  // En paquetes de empresa los familiares no son un precio aparte: van en la metadata.
  return porPrecio || Number(sub.metadata?.familiares) || 0;
}

export function cantidadDeSuscripcion(sub) {
  const id = opcional('STRIPE_PRICE_MENSUAL');
  const items = (sub.items?.data || []).filter((i) => !id || i.price?.id === id);
  return items.reduce((s, i) => s + (i.quantity || 1), 0) || 1;
}

/** "cosmopolitana__V012" → { empresa, vendedor }. Sin datos: web / directo. */
export function atribucionDeReferencia(ref) {
  const [e = '', v = ''] = String(ref || '').split('__');
  const limpio = (s) => s.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60);
  return { empresa: limpio(e) || 'web', vendedor: limpio(v) || 'directo' };
}

/** Empresa y vendedor de una suscripción (metadata, o la Checkout Session que la creó). */
export async function atribucionDeSuscripcion(sub) {
  if (sub.metadata?.vendedor) {
    return { empresa: sub.metadata.empresa || 'web', vendedor: sub.metadata.vendedor };
  }
  const s = stripe();
  const sesiones = await s.checkout.sessions.list({ subscription: sub.id, limit: 1 });
  const sesion = sesiones.data[0];
  const atrib = atribucionDeReferencia(sesion?.client_reference_id);
  if (sesion) {
    await s.subscriptions.update(sub.id, {
      metadata: { ...atrib, client_reference_id: sesion.client_reference_id || '' },
    });
  }
  return atrib;
}
