// Conecta Stripe (SÓLO modo prueba) con un sitio publicado de pruebas:
// - crea (o reutiliza) el webhook  <sitio>/api/stripe-webhook  con los 7 eventos
// - apunta la página de "gracias" de los Payment Links de prueba a ese sitio
// - escribe .env.netlify con todas las variables para importarlas en Netlify
// Uso:  node scripts/stripe-sitio-pruebas.mjs https://dash-pruebas.netlify.app
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import Stripe from 'stripe';
import { cargarEnv, raiz } from './env.mjs';

cargarEnv();
const llave = process.env.STRIPE_SECRET_KEY || '';
if (!/^sk_test_/.test(llave)) { console.error('✖ Hace falta la llave de PRUEBA (sk_test_) en .env'); process.exit(1); }
const sitio = (process.argv[2] || '').replace(/\/$/, '');
if (!/^https:\/\//.test(sitio)) { console.error('✖ Indica la URL https del sitio de pruebas'); process.exit(1); }

const stripe = new Stripe(llave);
const EVENTOS = [
  'checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed',
  'invoice.paid', 'invoice.payment_failed', 'customer.subscription.deleted', 'charge.refunded',
];
const urlWebhook = `${sitio}/api/stripe-webhook`;

// El secreto sólo se puede leer al crear el webhook: si ya existía, se borra y se crea de nuevo.
for await (const w of stripe.webhookEndpoints.list({ limit: 100 })) {
  if (w.url === urlWebhook) await stripe.webhookEndpoints.del(w.id);
}
const webhook = await stripe.webhookEndpoints.create({
  url: urlWebhook, enabled_events: EVENTOS, description: 'DASH MEDIC CARE – sitio de pruebas',
});
console.log(`Webhook: ${webhook.id} → ${urlWebhook}`);

for await (const l of stripe.paymentLinks.list({ limit: 100, active: true })) {
  if (!l.metadata?.dash_plan) continue;
  await stripe.paymentLinks.update(l.id, {
    after_completion: { type: 'redirect', redirect: { url: `${sitio}/gracias-membresia.html` } },
  });
  console.log(`Payment Link ${l.metadata.dash_plan}: gracias → ${sitio}/gracias-membresia.html`);
}

const v = (k) => process.env[k] || '';
const lineas = [
  '# Variables para el sitio de PRUEBAS en Netlify. Copia TODO y pégalo en',
  '# Netlify → Project configuration → Environment variables → Add a variable → Import from a .env file',
  '# Este archivo NO se sube a GitHub. Bórralo cuando termines.',
  `STRIPE_SECRET_KEY=${llave}`,
  `STRIPE_WEBHOOK_SECRET=${webhook.secret}`,
  ...['STRIPE_PRICE_MENSUAL', 'STRIPE_PRICE_TRIMESTRAL', 'STRIPE_PRICE_ANUAL', 'STRIPE_LINK_MENSUAL', 'STRIPE_LINK_TRIMESTRAL', 'STRIPE_LINK_ANUAL']
    .map((k) => `${k}=${v(k)}`),
  'LIDER_CODIGO=PAULO',
  'CORPORATIVOS_ACTIVOS=201',
  'UMBRAL_BOLSA=450',
  'FACTURACION_ACTIVA=false',
];
const archivo = path.join(raiz, '.env.netlify');
writeFileSync(archivo, `${lineas.join('\n')}\n`);
console.log(`\n✔ Listo. Variables en ${archivo}`);
