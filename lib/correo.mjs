// Envío de correo con Resend (https://resend.com).
import { opcional, requerida } from './config.mjs';
import { correoLocal, guardarCorreoLocal } from './local.mjs';

/**
 * @param {object} c
 * @param {string|string[]} c.para
 * @param {string} c.asunto
 * @param {string} c.html
 * @param {string} [c.texto]
 * @param {string|string[]} [c.cc]
 * @param {{filename:string, content:string}[]} [c.adjuntos]  content en base64
 * @param {string} [clave]  Idempotency-Key: Resend no duplica el correo si se reintenta con la misma clave.
 */
export async function enviarCorreo({ para, asunto, html, texto, cc, adjuntos }, clave) {
  const destinatarios = [].concat(para).filter(Boolean);
  if (!destinatarios.length) throw new Error(`Correo "${asunto}" sin destinatario`);
  if (correoLocal()) return guardarCorreoLocal({ para: destinatarios, cc, asunto, html, texto, adjuntos, clave });
  const headers = {
    Authorization: `Bearer ${requerida('RESEND_API_KEY')}`,
    'Content-Type': 'application/json',
  };
  if (clave) headers['Idempotency-Key'] = clave.slice(0, 256);
  const cuerpo = {
    from: requerida('EMAIL_FROM'),
    to: destinatarios,
    subject: asunto,
    html,
    text: texto,
  };
  const ccs = [].concat(cc || []).filter(Boolean);
  if (ccs.length) cuerpo.cc = ccs;
  const responder = opcional('EMAIL_REPLY_TO');
  if (responder) cuerpo.reply_to = responder;
  if (adjuntos?.length) cuerpo.attachments = adjuntos;

  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers, body: JSON.stringify(cuerpo) });
  if (!r.ok) {
    const detalle = await r.text();
    // Destinatario mal escrito o inexistente: reintentar no lo arregla.
    if (r.status === 422 && /`to`|email address|recipient/i.test(detalle)) {
      throw new CorreoInvalidoError(`Destinatario inválido (${destinatarios.join(', ')}): ${detalle}`);
    }
    throw new Error(`Resend respondió ${r.status}: ${detalle}`);
  }
  return r.json();
}

/** Error permanente: la dirección de correo no es válida. No vale la pena que Stripe reintente. */
export class CorreoInvalidoError extends Error {
  constructor(mensaje) { super(mensaje); this.name = 'CorreoInvalidoError'; }
}
