// Facturación CFDI 4.0. Apagada mientras FACTURACION_ACTIVA=false:
// las solicitudes se guardan en la pestaña "Facturacion" como "pendiente" y se avisa a ADMIN_EMAIL.
import { PRODUCTO, bandera, requerida } from './config.mjs';
import { ahoraCDMX, hoyCDMX, normalizarFecha } from './fechas.mjs';
import { actualizarFila, actualizarFilas, agregarFilas, leerTabla } from './sheets.mjs';
import { emitirCfdi, enviarCfdiPorCorreo, PUBLICO_EN_GENERAL } from './facturapi.mjs';
import { alertaAdmin } from './alertas.mjs';
import { normalizar, redondear } from './texto.mjs';

export const REGIMENES = ['601', '603', '605', '606', '608', '612', '616', '621', '625', '626'];
export const USOS = ['G03', 'D01', 'S01'];
const RFC = /^[A-ZÑ&]{3,4}\d{6}[A-Z\d]{3}$/;

/** Valida y limpia los datos del formulario. */
export function validarSolicitud(d) {
  const datos = {
    correo: String(d.correo || '').trim().toLowerCase(),
    rfc: String(d.rfc || '').trim().toUpperCase().replace(/[\s-]/g, ''),
    razonSocial: String(d.razon_social || '').trim().toUpperCase(),
    regimen: String(d.regimen_fiscal || '').trim(),
    cp: String(d.cp || '').trim(),
    uso: String(d.uso_cfdi || '').trim().toUpperCase(),
    idPago: String(d.id_pago || '').trim(),
  };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.correo)) return { error: 'Escribe un correo válido.' };
  if (!RFC.test(datos.rfc)) return { error: 'El RFC no tiene un formato válido.' };
  if (datos.rfc === PUBLICO_EN_GENERAL.rfc) return { error: 'Para factura a público en general no necesitas solicitarla.' };
  if (datos.razonSocial.length < 3) return { error: 'Escribe tu nombre o razón social como aparece en tu Constancia de Situación Fiscal.' };
  if (!REGIMENES.includes(datos.regimen)) return { error: 'Selecciona tu régimen fiscal.' };
  if (!/^\d{5}$/.test(datos.cp)) return { error: 'El código postal debe tener 5 dígitos.' };
  if (!USOS.includes(datos.uso)) return { error: 'Selecciona el uso del CFDI.' };
  if (datos.idPago.length < 4) return { error: 'Escribe el ID de tu pago.' };
  return { datos };
}

const ERROR_PAGO = 'No encontramos un pago con ese ID y ese correo. Revisa el ID en tu correo de bienvenida o en tu recibo de Stripe.';

export async function solicitarFactura(datos) {
  const cobros = await leerTabla('Cobros');
  const id = normalizar(datos.idPago);
  const cobro = cobros.find((c) => [c.pagoId, c.referencia, c.numero].some((v) => v && normalizar(v) === id));
  if (!cobro || normalizar(cobro.correo) !== datos.correo) return { ok: false, mensaje: ERROR_PAGO };

  const monto = redondear((Number(cobro.montoCobrado) || 0) - (Number(cobro.montoReembolsado) || 0));
  if (monto <= 0) return { ok: false, mensaje: 'Ese pago fue reembolsado; no se puede facturar.' };
  if (cobro.cfdi) return { ok: false, mensaje: 'Ese pago ya está facturado. Si no recibiste tu CFDI, escríbenos.' };

  if (bandera('FACTURACION_SOLO_MES_EN_CURSO', true)
    && normalizarFecha(cobro.fecha).slice(0, 7) !== hoyCDMX().slice(0, 7)) {
    return {
      ok: false,
      mensaje: `Sólo podemos facturar pagos del mes en curso; los anteriores ya se incluyeron en la factura global. Escríbenos al ${PRODUCTO.telefono}.`,
    };
  }

  const solicitudes = await leerTabla('Facturacion');
  if (solicitudes.some((s) => s.pagoId === cobro.pagoId && ['pendiente', 'emitida'].includes(normalizar(s.estado)))) {
    return { ok: true, mensaje: 'Ya tenemos tu solicitud para ese pago. Te enviaremos tu CFDI por correo.' };
  }

  const fila = {
    fecha: ahoraCDMX(), correo: datos.correo, rfc: datos.rfc, razonSocial: datos.razonSocial,
    regimen: datos.regimen, cp: datos.cp, uso: datos.uso, pagoId: cobro.pagoId, monto,
    estado: 'pendiente', cfdiId: '', notas: '',
  };

  if (!bandera('FACTURACION_ACTIVA')) {
    await agregarFilas('Facturacion', [fila]);
    await alertaAdmin('Nueva solicitud de factura', [
      `${datos.razonSocial} (${datos.rfc}) solicitó CFDI del pago ${cobro.pagoId} por $${monto}.`,
      'La facturación automática está apagada: emítela manualmente y marca la solicitud como "emitida".',
    ]);
    return { ok: true, mensaje: 'Recibimos tu solicitud. Te enviaremos tu CFDI a tu correo en un máximo de 72 horas hábiles.' };
  }

  try {
    const cfdi = await emitirCfdi({
      receptor: { ...datos },
      conceptos: [{ descripcion: `Membresía ${PRODUCTO.membresia} (${cobro.modalidad})`, precioConIva: monto, folio: cobro.pagoId }],
      formaPago: cobro.formaPago || '99',
      uso: datos.uso,
      externalId: cobro.pagoId,
    });
    await enviarCfdiPorCorreo(cfdi.id, datos.correo);
    await agregarFilas('Facturacion', [{ ...fila, estado: 'emitida', cfdiId: cfdi.id }]);
    await actualizarFila('Cobros', cobro._fila, { cfdi: cfdi.id });
    return { ok: true, mensaje: 'Listo: emitimos tu CFDI y lo enviamos a tu correo.' };
  } catch (e) {
    console.error('[facturacion] Error al emitir CFDI:', e.message);
    await agregarFilas('Facturacion', [{ ...fila, estado: 'error', notas: e.message.slice(0, 300) }]);
    await alertaAdmin('Error al emitir CFDI', [`Pago ${cobro.pagoId}, RFC ${datos.rfc}.`, e.message]);
    return {
      ok: false,
      mensaje: 'No pudimos emitir tu CFDI con esos datos. Revisa que coincidan con tu Constancia de Situación Fiscal; ya avisamos a nuestro equipo.',
    };
  }
}

/** Factura global a público en general de los cobros de `periodo` (AAAA-MM) sin CFDI individual. */
export async function emitirFacturaGlobal(periodo) {
  const cobros = await leerTabla('Cobros');
  const delMes = cobros.filter((c) => normalizarFecha(c.fecha).startsWith(periodo)
    && !c.cfdi
    && (Number(c.montoCobrado) || 0) - (Number(c.montoReembolsado) || 0) > 0);
  if (!delMes.length) return { estado: `Sin cobros por facturar en ${periodo}` };

  // Una factura global por forma de pago (el CFDI admite una sola)
  const grupos = new Map();
  for (const c of delMes) {
    const k = c.formaPago || '99';
    grupos.set(k, [...(grupos.get(k) || []), c]);
  }
  const [anio, mes] = periodo.split('-');
  const emitidas = [];
  for (const [formaPago, lista] of grupos) {
    const cfdi = await emitirCfdi({
      receptor: { ...PUBLICO_EN_GENERAL, cp: requerida('LUGAR_EXPEDICION_CP') },
      conceptos: lista.map((c) => ({
        descripcion: `Membresía ${PRODUCTO.membresia} (${c.modalidad})`,
        precioConIva: redondear(Number(c.montoCobrado) - (Number(c.montoReembolsado) || 0)),
        folio: c.pagoId,
      })),
      formaPago,
      uso: 'S01',
      global: { periodicity: 'month', months: mes, year: Number(anio) },
      externalId: `global-${periodo}-${formaPago}`,
    });
    await actualizarFilas('Cobros', lista.map((c) => ({ fila: c._fila, cambios: { cfdi: `Global ${cfdi.id}` } })));
    emitidas.push({ formaPago, cfdi: cfdi.id, pagos: lista.length });
  }
  return { estado: 'Factura global emitida', emitidas };
}
