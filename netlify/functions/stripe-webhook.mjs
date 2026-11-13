// Webhook de Stripe → https://<tu-sitio>/api/stripe-webhook
// Verifica la firma, ignora eventos ya procesados y responde 500 si algo falla
// (Sheets, correo, Stripe) para que Stripe reintente.
import { requerida } from '../../lib/config.mjs';
import { marcarProcesado, yaProcesado } from '../../lib/idempotencia.mjs';
import { procesarEvento } from '../../lib/pagos.mjs';
import { stripe } from '../../lib/stripe.mjs';

const respuesta = (status, cuerpo) => new Response(JSON.stringify(cuerpo), {
  status, headers: { 'Content-Type': 'application/json' },
});

export default async (req) => {
  if (req.method !== 'POST') return respuesta(405, { error: 'Método no permitido' });

  let secreto;
  try { secreto = requerida('STRIPE_WEBHOOK_SECRET'); } catch (e) {
    console.error('[webhook] Configuración incompleta:', e.message);
    return respuesta(500, { error: 'Configuración incompleta' });
  }

  const cuerpo = await req.text();
  let evento;
  try {
    evento = stripe().webhooks.constructEvent(cuerpo, req.headers.get('stripe-signature') || '', secreto);
  } catch (e) {
    console.warn('[webhook] Firma inválida:', e.message);
    return respuesta(400, { error: 'Firma inválida' });
  }

  try {
    if (await yaProcesado(evento.id)) {
      console.log(`[webhook] ${evento.type} ${evento.id} ya procesado: se omite`);
      return respuesta(200, { recibido: true, duplicado: true });
    }
    const resultado = await procesarEvento(evento);
    await marcarProcesado(evento.id, evento.type);
    console.log(`[webhook] ${evento.type} ${evento.id} →`, JSON.stringify(resultado));
    return respuesta(200, { recibido: true, resultado });
  } catch (e) {
    console.error(`[webhook] ERROR en ${evento.type} ${evento.id}:`, e?.stack || e);
    return respuesta(500, { error: 'Error al procesar; Stripe reintentará' });
  }
};

export const config = { path: '/api/stripe-webhook' };
