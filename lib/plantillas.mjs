// Plantillas de correo. Sólo datos de contacto y pago; nunca datos de salud.
import { PRODUCTO, urlSitio } from './config.mjs';
import { escaparHtml as e, pesos } from './texto.mjs';

const AZUL = '#1E2461';
const CIAN = '#47C6E8';

function marco(titulo, cuerpoHtml) {
  return `<!DOCTYPE html><html lang="es"><body style="margin:0;background:#f3f6fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f6fb;padding:24px 0;"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;">
<tr><td style="background:${AZUL};padding:22px 28px;color:#fff;font-size:20px;font-weight:bold;">DASH MEDIC CARE</td></tr>
<tr><td style="padding:28px;font-size:15px;line-height:1.6;">
<h1 style="font-size:22px;color:${AZUL};margin:0 0 16px;">${e(titulo)}</h1>
${cuerpoHtml}
<p style="margin:24px 0 0;color:#6b7280;font-size:13px;">¿Dudas? Llámanos o escríbenos por WhatsApp al <b>${PRODUCTO.telefono}</b>.</p>
</td></tr></table></td></tr></table></body></html>`;
}

const boton = (url, texto) =>
  `<p style="margin:22px 0;"><a href="${e(url)}" style="background:${CIAN};color:${AZUL};font-weight:bold;text-decoration:none;padding:12px 26px;border-radius:8px;display:inline-block;">${e(texto)}</a></p>`;

const enlaces = () => {
  const base = urlSitio();
  if (!base) return '';
  return `<p style="font-size:13px;color:#6b7280;">Administra tu membresía en <a href="${e(base)}/mi-cuenta.html">Mi cuenta</a> · Solicita tu factura en <a href="${e(base)}/facturacion.html">Facturación</a></p>`;
};

export function bienvenida({ nombre, modalidad, vigenteHasta, pagoId }) {
  const asunto = '¡Bienvenido a DASH MEDIC CARE! Tu acceso llega en máximo 48 h';
  const condiciones = modalidad === 'mensual'
    ? 'Tu membresía se cobra automáticamente cada mes a tu tarjeta. El plazo mínimo es de 3 meses facturables y puedes cancelar con 30 días de aviso desde "Mi cuenta".'
    : `Tu membresía (${e(modalidad)}) está vigente hasta el <b>${e(vigenteHasta)}</b>. Te avisaremos 10 días antes para que la renueves.`;
  const html = marco(`¡Hola${nombre ? `, ${e(nombre)}` : ''}!`, `
<p>Gracias por contratar tu membresía <b>${PRODUCTO.membresia}</b>.</p>
<p style="background:#eef9fd;border-left:4px solid ${CIAN};padding:12px 16px;"><b>Tu acceso llega a tu correo en máximo 48 h desde DASH MEDIC CARE by Ever Health.</b> Revisa también tu carpeta de spam o promociones.</p>
<p>${condiciones}</p>
${pagoId ? `<p style="font-size:13px;color:#6b7280;">ID de tu pago (para solicitar factura): <b>${e(pagoId)}</b></p>` : ''}
${enlaces()}`);
  const texto = `Gracias por contratar tu membresía ${PRODUCTO.membresia}.
Tu acceso llega a tu correo en máximo 48 h desde DASH MEDIC CARE by Ever Health.
${modalidad === 'mensual' ? 'Cargo automático mensual. Mínimo 3 meses; cancelación con 30 días de aviso.' : `Vigente hasta ${vigenteHasta}.`}
${pagoId ? `ID de pago para factura: ${pagoId}\n` : ''}Contacto: ${PRODUCTO.telefono}`;
  return { asunto, html, texto };
}

export function renovacionConfirmada({ nombre, modalidad, vigenteHasta, pagoId }) {
  const asunto = 'Renovamos tu membresía DASH MEDIC CARE';
  const html = marco(`¡Gracias por renovar${nombre ? `, ${e(nombre)}` : ''}!`, `
<p>Tu membresía <b>${PRODUCTO.membresia}</b> (${e(modalidad)}) ahora está vigente hasta el <b>${e(vigenteHasta)}</b>.</p>
<p>Tu acceso de DASH MEDIC CARE by Ever Health sigue igual; no tienes que hacer nada más.</p>
${pagoId ? `<p style="font-size:13px;color:#6b7280;">ID de tu pago (para solicitar factura): <b>${e(pagoId)}</b></p>` : ''}
${enlaces()}`);
  const texto = `Tu membresía ${PRODUCTO.membresia} quedó vigente hasta ${vigenteHasta}. ${pagoId ? `ID de pago: ${pagoId}. ` : ''}Contacto: ${PRODUCTO.telefono}`;
  return { asunto, html, texto };
}

export function avisoRenovacion({ nombre, modalidad, vigenteHasta, dias, link, precio }) {
  const asunto = `Tu membresía DASH MEDIC CARE vence el ${vigenteHasta}`;
  const html = marco(`Hola${nombre ? `, ${e(nombre)}` : ''}: tu membresía está por vencer`, `
<p>Tu membresía <b>${PRODUCTO.membresia}</b> (${e(modalidad)}) vence el <b>${e(vigenteHasta)}</b>${dias > 0 ? ` (en ${dias} días)` : ' (hoy)'}.</p>
<p>Renueva para no perder tu acceso${precio ? ` — ${e(precio)}` : ''}. Puedes pagar con tarjeta, en OXXO o por transferencia SPEI.</p>
${link ? boton(link, 'Renovar mi membresía') : ''}
<p style="font-size:13px;color:#6b7280;">Si ya renovaste, ignora este mensaje.</p>`);
  const texto = `Tu membresía ${PRODUCTO.membresia} vence el ${vigenteHasta}. Renueva aquí: ${link || '(escríbenos)'}. Contacto: ${PRODUCTO.telefono}`;
  return { asunto, html, texto };
}

export function loteEverHealth({ fecha, altas, bajas }) {
  const asunto = `DASH MEDIC CARE – lote de altas y bajas ${fecha} (${altas} altas, ${bajas} bajas)`;
  const html = marco('Lote diario de altas y bajas', `
<p>Adjuntamos el lote del <b>${e(fecha)}</b> del grupo DASH Individual, plan <b>${PRODUCTO.planEverHealth}</b>:</p>
<ul><li>Altas: <b>${altas}</b></li><li>Bajas: <b>${bajas}</b></li></ul>
<p>Por favor envíen el correo de acceso a las altas en un máximo de 48 horas.</p>`);
  const texto = `Lote ${fecha}: ${altas} altas, ${bajas} bajas. CSV adjunto.`;
  return { asunto, html, texto };
}

export function alerta(titulo, lineas) {
  const html = marco(titulo, lineas.map((l) => `<p>${e(l)}</p>`).join(''));
  return { asunto: `[DASH pagos] ${titulo}`, html, texto: lineas.join('\n') };
}

export const PRECIOS = {
  trimestral: `${pesos(1910.52)} (3 meses, IVA incluido)`,
  anual: `${pesos(6368.4)} (12 meses por el precio de 10, IVA incluido)`,
};
