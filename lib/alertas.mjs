// Avisos internos a ADMIN_EMAIL y envío de correos a clientes.
import { lista } from './config.mjs';
import { CorreoInvalidoError, enviarCorreo } from './correo.mjs';
import { alerta } from './plantillas.mjs';

export async function alertaAdmin(titulo, lineas, clave) {
  const { asunto, html, texto } = alerta(titulo, [].concat(lineas));
  console.log(`[alerta] ${titulo}: ${[].concat(lineas).join(' | ')}`);
  return enviarCorreo({ para: lista('ADMIN_EMAIL'), asunto, html, texto }, clave);
}

/**
 * Envía un correo a un cliente. Si su dirección es inválida (mal escrita, inexistente),
 * NO lanza error: avisa a administración y devuelve false, para que el webhook siga
 * y Stripe no reintente durante días algo que no se va a arreglar solo.
 * Cualquier otro error (Resend caído, etc.) sí se lanza para que Stripe reintente.
 */
export async function enviarAlCliente(correo, clave, contexto) {
  try {
    await enviarCorreo(correo, clave);
    return true;
  } catch (e) {
    if (!(e instanceof CorreoInvalidoError)) throw e;
    console.warn(`[correo] ${e.message}`);
    await alertaAdmin('Correo de cliente inválido', [
      `No se pudo enviar "${correo.asunto}" a ${[].concat(correo.para).join(', ')}: la dirección no es válida.`,
      contexto || '',
      'Corrige el correo del cliente en Stripe y en la hoja, y contáctalo por teléfono o WhatsApp.',
    ].filter(Boolean), `correo-invalido-${clave || correo.asunto}`);
    return false;
  }
}
