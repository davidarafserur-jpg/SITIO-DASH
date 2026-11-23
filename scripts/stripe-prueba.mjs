// Crea en Stripe (SÓLO modo prueba) el producto, los 3 precios y los 3 Payment Links,
// y guarda sus IDs en .env.   Uso:  npm run stripe:prueba
// Se puede correr varias veces: reutiliza lo que ya exista (por lookup_key / metadata).
import Stripe from 'stripe';
import { actualizarEnv, cargarEnv } from './env.mjs';

cargarEnv();
const llave = process.env.STRIPE_SECRET_KEY || '';
if (!/^sk_test_/.test(llave)) {
  console.error('\n✖ Pon tu llave secreta de PRUEBA (sk_test_…) en el archivo .env, en STRIPE_SECRET_KEY=');
  console.error('  Este script se niega a trabajar con llaves reales (sk_live_).\n');
  process.exit(1);
}
const stripe = new Stripe(llave);
const sitio = (process.env.SITE_URL || 'http://localhost:8888').replace(/\/$/, '');

const PLANES = [
  { clave: 'mensual', nombre: 'Mensual', monto: 63684, recurrente: true },
  { clave: 'trimestral', nombre: 'Prepago 3 meses', monto: 191052 },
  { clave: 'anual', nombre: 'Anual (paga 10, recibe 12)', monto: 636840 },
  // Salud Digital familiar: cada familiar $275 + IVA al mes (tarifario DASH INDIVIDUAL). Sin Payment Link:
  // se cobran junto con el titular desde /api/checkout.
  { clave: 'familiar_mensual', nombre: 'Familiar (mensual)', monto: 31900, recurrente: true, sinEnlace: true, familiar: true },
  { clave: 'familiar_anual', nombre: 'Familiar (anual, paga 10 recibe 12)', monto: 319000, sinEnlace: true, familiar: true },
];

const PRODUCTOS = {
  salud_digital: { name: 'DASH MEDIC CARE – Salud Digital', description: 'Membresía Salud Digital (incluye IVA)' },
  salud_digital_familiar: { name: 'Salud Digital – Familiar', description: 'Familiar adicional de la membresía Salud Digital familiar (incluye IVA)' },
};

async function producto(clave = 'salud_digital') {
  // list (no search): la búsqueda de Stripe tarda en ver productos recién creados
  for await (const p of stripe.products.list({ limit: 100, active: true })) {
    if (p.metadata?.dash === clave) return p;
  }
  return stripe.products.create({ ...PRODUCTOS[clave], metadata: { dash: clave } });
}

async function precio(prod, p) {
  const lookup = `dash_salud_digital_${p.clave}${p.familiar ? '_v2' : ''}`;
  const r = await stripe.prices.list({ lookup_keys: [lookup], limit: 1 });
  if (r.data[0]) return r.data[0];
  return stripe.prices.create({
    product: prod.id,
    currency: 'mxn',
    unit_amount: p.monto,
    tax_behavior: 'inclusive',
    lookup_key: lookup,
    nickname: `Salud Digital – ${p.nombre}`,
    ...(p.recurrente ? { recurring: { interval: 'month' } } : {}),
  });
}

async function enlaceExistente(clave) {
  for await (const l of stripe.paymentLinks.list({ limit: 100, active: true })) {
    if (l.metadata?.dash_plan === clave) return l;
  }
  return null;
}

// Ever Health pide nombre, apellido paterno y apellido materno por separado (Stripe permite 3 campos).
const CAMPOS = [
  { key: 'nombre', label: { type: 'custom', custom: 'Nombre(s)' }, type: 'text' },
  { key: 'apellidopaterno', label: { type: 'custom', custom: 'Apellido paterno' }, type: 'text' },
  { key: 'apellidomaterno', label: { type: 'custom', custom: 'Apellido materno' }, type: 'text', optional: true },
];

async function enlace(p, pr) {
  const previo = await enlaceExistente(p.clave);
  if (previo) {
    const claves = (previo.custom_fields || []).map((c) => c.key).join(',');
    if (claves === CAMPOS.map((c) => c.key).join(',')) return previo;
    return stripe.paymentLinks.update(previo.id, { custom_fields: CAMPOS });
  }
  const base = {
    line_items: [{ price: pr.id, quantity: 1 }],
    metadata: { dash_plan: p.clave },
    custom_fields: CAMPOS,
    phone_number_collection: { enabled: true },
    after_completion: { type: 'redirect', redirect: { url: `${sitio}/gracias-membresia.html` } },
  };
  if (p.recurrente) {
    return stripe.paymentLinks.create({ ...base, payment_method_types: ['card'] });
  }
  try {
    return await stripe.paymentLinks.create({ ...base, customer_creation: 'always', payment_method_types: ['card', 'oxxo'] });
  } catch (e) {
    console.warn(`  (OXXO no disponible en tu cuenta: ${e.message}) → sólo tarjeta`);
    return stripe.paymentLinks.create({ ...base, customer_creation: 'always', payment_method_types: ['card'] });
  }
}

const prod = await producto();
console.log(`Producto: ${prod.id}`);
const env = {};
for (const p of PLANES) {
  const pr = await precio(p.familiar ? await producto('salud_digital_familiar') : prod, p);
  const M = p.clave.toUpperCase();
  env[`STRIPE_PRICE_${M}`] = pr.id;
  if (p.sinEnlace) { console.log(`${p.nombre.padEnd(36)} ${pr.id}`); continue; }
  const l = await enlace(p, pr);
  env[`STRIPE_LINK_${M}`] = l.url;
  console.log(`${p.nombre.padEnd(36)} ${pr.id}  ${l.url}`);
}
actualizarEnv(env);
console.log('\n✔ Listo. Los IDs quedaron guardados en .env (modo prueba).');
