// Plantillas de correo con la identidad de DASH MEDIC CARE (colores, logo y tipografía del sitio).
// Sólo datos de contacto y pago; nunca datos de salud.
// HTML pensado para correo: tablas y estilos en línea (Gmail, Outlook y Apple Mail).
import { PRODUCTO, urlSitio } from './config.mjs';
import { escaparHtml as e, pesos } from './texto.mjs';

// Paleta del sitio (membresias.html)
const C = {
  navy: '#1E2461', azul: '#1565C0', teal: '#1E8FBA', cian: '#47C6E8', cian2: '#7DD8F0',
  texto: '#1a1a2e', gris: '#6B7280', borde: '#E5E9F2', fondo: '#F4F8FF', suave: '#EEF9FD',
};
const FUENTE = "'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MODALIDADES = { mensual: 'Mensual', trimestral: 'Prepago 3 meses', anual: 'Anual (paga 10, recibe 12)' };

const sitio = () => urlSitio() || 'https://dashmediccare.com';
const logo = () => `${sitio()}/img/logo-dash.png`;

/**
 * Marco común: logo, franja con degradado, contenido y pie azul marino.
 * @param {{previa:string, etiqueta?:string, titulo:string, subtitulo?:string, cuerpo:string, interno?:boolean}} o
 */
function marco({ previa, etiqueta, titulo, subtitulo, cuerpo, interno = false }) {
  const pie = interno
    ? `<p style="margin:0;font-size:12px;color:${C.cian2};">Aviso automático de la automatización de pagos de DASH MEDIC CARE.</p>`
    : `<p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#ffffff;">DASH MEDIC CARE <span style="font-weight:400;color:${C.cian2};">by Ever Health</span></p>
<p style="margin:0 0 14px;font-size:13px;color:#C9D3F5;">¿Dudas? Llámanos o escríbenos por WhatsApp al <a href="https://wa.me/525581202122" style="color:#ffffff;font-weight:700;text-decoration:none;">${PRODUCTO.telefono}</a></p>
<p style="margin:0 0 14px;font-size:13px;">
<a href="${e(sitio())}/mi-cuenta.html" style="color:${C.cian};text-decoration:none;font-weight:600;">Mi cuenta</a>
<span style="color:#5B6497;">&nbsp;·&nbsp;</span>
<a href="${e(sitio())}/facturacion.html" style="color:${C.cian};text-decoration:none;font-weight:600;">Solicitar factura</a>
<span style="color:#5B6497;">&nbsp;·&nbsp;</span>
<a href="${e(sitio())}" style="color:${C.cian};text-decoration:none;font-weight:600;">dashmediccare.com</a></p>
<p style="margin:0;font-size:11px;line-height:1.5;color:#8C95C4;">Recibes este correo porque tienes una membresía de DASH MEDIC CARE. Nunca te pediremos datos de salud ni contraseñas por correo.</p>`;

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><title>${e(titulo)}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:${C.fondo};font-family:${FUENTE};color:${C.texto};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.fondo};">${e(previa)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.fondo};padding:28px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid ${C.borde};">
<tr><td align="center" style="padding:26px 24px 22px;background:#ffffff;">
<a href="${e(sitio())}" style="text-decoration:none;"><img src="${e(logo())}" width="128" alt="DASH MEDIC CARE" style="display:block;width:128px;max-width:128px;height:auto;border:0;"></a>
</td></tr>
<tr><td style="background-color:${C.azul};background-image:linear-gradient(135deg, ${C.navy} 0%, ${C.azul} 60%, ${C.teal} 100%);padding:34px 36px;">
${etiqueta ? `<p style="margin:0 0 10px;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${C.cian2};">${e(etiqueta)}</p>` : ''}
<h1 style="margin:0;font-size:26px;line-height:1.25;font-weight:800;color:#ffffff;">${e(titulo)}</h1>
${subtitulo ? `<p style="margin:10px 0 0;font-size:16px;line-height:1.5;color:#DCE6FF;">${subtitulo}</p>` : ''}
</td></tr>
<tr><td style="padding:32px 36px 30px;font-size:15px;line-height:1.65;color:${C.texto};">
${cuerpo}
</td></tr>
<tr><td style="background:${C.navy};padding:26px 36px;">
${pie}
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

// ---------------------------------------------------------------- piezas

const parrafo = (html) => `<p style="margin:0 0 16px;">${html}</p>`;

const destacado = (html) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 22px;">
<tr><td style="background:${C.suave};border-left:4px solid ${C.cian};border-radius:10px;padding:16px 18px;font-size:15px;line-height:1.55;color:${C.navy};">${html}</td></tr></table>`;

const boton = (url, texto) => `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr>
<td style="background:${C.cian};border-radius:10px;"><a href="${e(url)}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;color:${C.navy};text-decoration:none;font-family:${FUENTE};">${e(texto)}</a></td>
</tr></table>`;

const subtitulo = (texto) => `<p style="margin:26px 0 12px;font-size:13px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${C.azul};">${e(texto)}</p>`;

function pasos(lista) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;">${lista.map(([titulo, texto], i) => `
<tr><td width="40" valign="top" style="padding:0 0 16px;">
<div style="width:30px;height:30px;line-height:30px;border-radius:15px;background:${C.navy};color:#ffffff;font-size:14px;font-weight:700;text-align:center;">${i + 1}</div></td>
<td valign="top" style="padding:3px 0 16px;font-size:15px;line-height:1.5;"><b style="color:${C.navy};">${e(titulo)}</b><br><span style="color:${C.gris};">${texto}</span></td></tr>`).join('')}
</table>`;
}

function resumen(filas) {
  const visibles = filas.filter(([, v]) => v);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;border:1px solid ${C.borde};border-radius:12px;border-collapse:separate;">
${visibles.map(([k, v], i) => `<tr>
<td style="padding:12px 16px;font-size:13px;color:${C.gris};${i ? `border-top:1px solid ${C.borde};` : ''}">${e(k)}</td>
<td align="right" style="padding:12px 16px;font-size:14px;font-weight:600;color:${C.texto};${i ? `border-top:1px solid ${C.borde};` : ''}">${v}</td></tr>`).join('')}
</table>`;
}

const incluye = () => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;">
${['Consultas ilimitadas de medicina general por videollamada, a cualquier hora.', 'Receta e informe médico.', 'Descuentos en laboratorio y farmacia.']
    .map((t) => `<tr><td width="26" valign="top" style="padding:0 0 10px;font-size:15px;color:${C.cian};font-weight:800;">✓</td><td style="padding:0 0 10px;font-size:15px;line-height:1.5;">${e(t)}</td></tr>`).join('')}
</table>`;

const nombreModalidad = (m) => MODALIDADES[String(m || '').toLowerCase()] || e(m);
const saludo = (nombre) => (nombre ? `, ${nombre}` : '');

// ---------------------------------------------------------------- correos al cliente

export function bienvenida({ nombre, modalidad, vigenteHasta, pagoId, titularNombre = '', familiares = 0 }) {
  const asunto = '¡Bienvenido a DASH MEDIC CARE! Tu acceso llega en máximo 48 h';
  const mensual = modalidad === 'mensual';
  const esFamiliar = Boolean(titularNombre);
  const familia = esFamiliar
    ? parrafo(`<b>${e(titularNombre)}</b> te sumó a su membresía <b>${PRODUCTO.membresia} familiar</b>. Tienes tu propio acceso y tu propio expediente; la membresía la administra y la paga ${e(titularNombre)}.`)
    : familiares
      ? destacado(`Sumaste a <b>${familiares} ${familiares === 1 ? 'familiar' : 'familiares'}</b>. Cada uno recibirá su propio acceso en su correo, también en máximo 48 h.`)
      : '';
  const condiciones = mensual
    ? 'Tu membresía se cobra automáticamente cada mes a tu tarjeta. El plazo mínimo es de 3 meses: si cancelas antes, se cobran los meses que falten para completarlo. Puedes cancelar con 30 días de aviso desde <b>Mi cuenta</b>.'
    : `Tu membresía está vigente hasta el <b>${e(vigenteHasta)}</b>. Te avisaremos 10 días antes para que puedas renovarla.`;
  const html = marco({
    previa: 'Tu acceso de DASH MEDIC CARE by Ever Health llega a tu correo en máximo 48 horas.',
    etiqueta: 'Membresía activa',
    titulo: `¡Bienvenido${saludo(nombre)}!`,
    subtitulo: 'Tu médico 24/7, en tu celular.',
    cuerpo: `${esFamiliar ? familia : parrafo(`Gracias por contratar tu membresía <b>${PRODUCTO.membresia}${familiares ? ' familiar' : ''}</b>. Ya estamos dando de alta tu acceso.`)}
${destacado(`<b>Tu acceso llega a tu correo en máximo 48 h</b> desde <b>DASH MEDIC CARE by Ever Health</b>. Revisa también tu carpeta de spam o promociones.`)}
${esFamiliar ? '' : familia}
${subtitulo('¿Qué sigue?')}
${pasos([
    ['Recibe tu acceso', 'Te llegará un correo de DASH MEDIC CARE by Ever Health en máximo 48 horas.'],
    ['Activa tu cuenta', 'Sigue las instrucciones de ese correo para entrar.'],
    ['Consulta cuando lo necesites', 'Habla con un médico general por videollamada, a cualquier hora.'],
  ])}
${subtitulo('Tu membresía incluye')}
${incluye()}
${subtitulo('Resumen')}
${resumen([
    ['Membresía', `${PRODUCTO.membresia}${esFamiliar || familiares ? ' familiar' : ''}`],
    ['Modalidad', nombreModalidad(modalidad)],
    familiares ? ['Personas', `Tú + ${familiares} ${familiares === 1 ? 'familiar' : 'familiares'}`] : ['', ''],
    esFamiliar ? ['Titular', e(titularNombre)] : [mensual ? 'Cobro' : 'Vigente hasta', mensual ? 'Automático cada mes' : e(vigenteHasta)],
    esFamiliar && !mensual ? ['Vigente hasta', e(vigenteHasta)] : ['', ''],
    ['ID de pago (para factura)', pagoId ? `<span style="font-family:Consolas,monospace;font-size:13px;">${e(pagoId)}</span>` : ''],
  ])}
${esFamiliar ? '' : parrafo(`<span style="font-size:14px;color:${C.gris};">${condiciones}</span>`)}`,
  });
  const texto = `¡Bienvenido${saludo(nombre)}!
Gracias por contratar tu membresía ${PRODUCTO.membresia}.
Tu acceso llega a tu correo en máximo 48 h desde DASH MEDIC CARE by Ever Health. Revisa spam o promociones.
${mensual ? 'Cobro automático mensual. Mínimo 3 meses: si cancelas antes se cobran los meses restantes. Cancelación con 30 días de aviso.' : `Vigente hasta ${vigenteHasta}.`}
${pagoId ? `ID de pago para factura: ${pagoId}\n` : ''}Mi cuenta: ${sitio()}/mi-cuenta.html
Dudas: ${PRODUCTO.telefono} (teléfono y WhatsApp)`;
  return { asunto, html, texto };
}

export function renovacionConfirmada({ nombre, modalidad, vigenteHasta, pagoId }) {
  const asunto = 'Renovamos tu membresía DASH MEDIC CARE';
  const html = marco({
    previa: `Tu membresía quedó vigente hasta el ${vigenteHasta}.`,
    etiqueta: 'Renovación confirmada',
    titulo: `¡Gracias por renovar${saludo(nombre)}!`,
    subtitulo: `Tu membresía sigue activa hasta el <b style="color:#ffffff;">${e(vigenteHasta)}</b>.`,
    cuerpo: `${parrafo(`Tu acceso de <b>DASH MEDIC CARE by Ever Health</b> sigue igual: no tienes que hacer nada más.`)}
${resumen([
    ['Membresía', PRODUCTO.membresia],
    ['Modalidad', nombreModalidad(modalidad)],
    ['Vigente hasta', e(vigenteHasta)],
    ['ID de pago (para factura)', pagoId ? `<span style="font-family:Consolas,monospace;font-size:13px;">${e(pagoId)}</span>` : ''],
  ])}`,
  });
  const texto = `Tu membresía ${PRODUCTO.membresia} quedó vigente hasta ${vigenteHasta}. ${pagoId ? `ID de pago: ${pagoId}. ` : ''}Dudas: ${PRODUCTO.telefono}`;
  return { asunto, html, texto };
}

export function avisoRenovacion({ nombre, modalidad, vigenteHasta, dias, link, precio }) {
  const asunto = `Tu membresía DASH MEDIC CARE vence el ${vigenteHasta}`;
  const cuando = dias > 0 ? `en ${dias} ${dias === 1 ? 'día' : 'días'}` : 'hoy';
  const html = marco({
    previa: `Tu membresía vence ${cuando}. Renuévala para no perder tu acceso.`,
    etiqueta: 'Aviso de renovación',
    titulo: `Hola${saludo(nombre)}, tu membresía vence ${cuando}`,
    subtitulo: `Fecha de vencimiento: <b style="color:#ffffff;">${e(vigenteHasta)}</b>`,
    cuerpo: `${parrafo(`Renueva tu membresía <b>${PRODUCTO.membresia}</b> (${nombreModalidad(modalidad)}) para seguir consultando a un médico cuando lo necesites.`)}
${precio ? resumen([['Renovación', e(precio)], ['Formas de pago', 'Tarjeta, OXXO o SPEI']]) : ''}
${link ? boton(link, 'Renovar mi membresía') : parrafo(`Escríbenos al <b>${PRODUCTO.telefono}</b> y te ayudamos a renovar.`)}
${parrafo(`<span style="font-size:13px;color:${C.gris};">Si ya renovaste, ignora este mensaje.</span>`)}`,
  });
  const texto = `Tu membresía ${PRODUCTO.membresia} vence el ${vigenteHasta}. Renueva aquí: ${link || `(escríbenos al ${PRODUCTO.telefono})`}`;
  return { asunto, html, texto };
}

export function cargoMinimo({ nombre, meses, cobros, minimo, monto }) {
  const asunto = 'Confirmamos la cancelación de tu membresía DASH MEDIC CARE';
  const html = marco({
    previa: `Recibimos tu cancelación. Se cobraron ${meses} ${meses === 1 ? 'mes' : 'meses'} para completar el plazo mínimo.`,
    etiqueta: 'Cancelación recibida',
    titulo: `Hola${saludo(nombre)}, recibimos tu cancelación`,
    cuerpo: `${parrafo(`Tu membresía <b>${PRODUCTO.membresia}</b> quedó cancelada. Lamentamos que te vayas.`)}
${destacado(`Tu membresía tiene un plazo mínimo de <b>${minimo} meses</b>. Como se habían pagado ${cobros} de ${minimo}, se cobró a tu tarjeta lo correspondiente a ${meses} ${meses === 1 ? 'mes restante' : 'meses restantes'}.`)}
${resumen([
    ['Meses pagados', String(cobros)],
    ['Meses para completar el mínimo', String(meses)],
    ['Cargo', pesos(monto)],
  ])}
${parrafo(`Si crees que hay un error, escríbenos al <b>${PRODUCTO.telefono}</b> y lo revisamos contigo.`)}`,
  });
  const texto = `Tu membresía ${PRODUCTO.membresia} quedó cancelada. Por el plazo mínimo de ${minimo} meses se cobraron ${meses} ${meses === 1 ? 'mes' : 'meses'} restantes: ${pesos(monto)}. Dudas: ${PRODUCTO.telefono}`;
  return { asunto, html, texto };
}

// ---------------------------------------------------------------- correos internos

export function loteEverHealth({ fecha, altas, bajas }) {
  const asunto = `DASH MEDIC CARE – lote de altas y bajas ${fecha} (${altas} altas, ${bajas} bajas)`;
  const html = marco({
    previa: `${altas} altas y ${bajas} bajas del ${fecha}.`,
    etiqueta: 'Lote diario',
    titulo: 'Altas y bajas del día',
    subtitulo: `Grupo DASH Individual · plan ${PRODUCTO.planEverHealth} · ${e(fecha)}`,
    interno: true,
    cuerpo: `${resumen([['Altas', `<b>${altas}</b>`], ['Bajas', `<b>${bajas}</b>`]])}
${parrafo('Adjuntamos el archivo con el formato de alta (nombre, apellido paterno, apellido materno y correo) y el detalle de cada movimiento.')}
${destacado('Por favor envíen el correo de acceso a las altas en un máximo de <b>48 horas</b>.')}`,
  });
  const texto = `Lote ${fecha}: ${altas} altas, ${bajas} bajas. Archivo adjunto. Accesos en máximo 48 h.`;
  return { asunto, html, texto };
}

export function alerta(titulo, lineas) {
  const html = marco({
    previa: lineas[0] || titulo,
    etiqueta: 'Aviso para administración',
    titulo,
    interno: true,
    cuerpo: lineas.map((l) => parrafo(e(l))).join(''),
  });
  return { asunto: `[DASH pagos] ${titulo}`, html, texto: lineas.join('\n') };
}

export const PRECIOS = {
  trimestral: `${pesos(1910.52)} por 3 meses (IVA incluido)`,
  anual: `${pesos(6368.4)} por 12 meses, pagas 10 (IVA incluido)`,
};
