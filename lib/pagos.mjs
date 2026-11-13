// Lógica de negocio de los eventos de Stripe: altas, bajas, cobros, comisiones y reembolsos.
// Cada paso es idempotente (unaVez + verificación en la hoja), así que un reintento de Stripe
// nunca duplica filas ni correos.
import { MESES_PREPAGO, PRODUCTO, esPrepago, grupoDe, liderPorDefecto } from './config.mjs';
import { ahoraCDMX, finDeVigencia, hoyCDMX, maxFecha, normalizarFecha, sumarDias } from './fechas.mjs';
import { actualizarFila, agregarFilas, leerTabla } from './sheets.mjs';
import { unaVez } from './idempotencia.mjs';
import { calcularComisiones, esReverso, reglasComisiones } from './comisiones.mjs';
import { enviarCorreo } from './correo.mjs';
import * as plantillas from './plantillas.mjs';
import { alertaAdmin } from './alertas.mjs';
import { agregarNota, normalizar, redondear } from './texto.mjs';
import {
  atribucionDeReferencia, atribucionDeSuscripcion, cantidadDeSuscripcion, esSuscripcionDeMembresia,
  formaPagoSAT, idDe, pagoDeFactura, productoDeSesion, stripe, suscripcionDeFactura,
} from './stripe.mjs';

export async function procesarEvento(evento) {
  const o = evento.data.object;
  switch (evento.type) {
    case 'checkout.session.completed':
      if (o.payment_status === 'unpaid') {
        return { estado: 'Pago pendiente (OXXO/SPEI): se registrará al confirmarse' };
      }
      return checkoutPagado(o);
    case 'checkout.session.async_payment_succeeded':
      return checkoutPagado(o);
    case 'checkout.session.async_payment_failed':
      return { estado: 'Pago OXXO/SPEI no realizado o vencido: sin alta' };
    case 'invoice.paid':
      return facturaPagada(o);
    case 'invoice.payment_failed':
      return pagoFallido(o);
    case 'customer.subscription.deleted':
      return suscripcionCancelada(o);
    case 'charge.refunded':
      return cargoReembolsado(o);
    default:
      return { estado: `Evento ${evento.type} ignorado` };
  }
}

// ---------------------------------------------------------------- datos del cliente

function separarNombre(completo) {
  const p = String(completo || '').trim().split(/\s+/).filter(Boolean);
  if (p.length <= 1) return { nombre: p[0] || '', apellidos: '' };
  const nApellidos = p.length >= 3 ? 2 : 1; // en México normalmente dos apellidos
  return { nombre: p.slice(0, -nApellidos).join(' '), apellidos: p.slice(-nApellidos).join(' ') };
}

/** Nombre, apellidos, correo y celular de la sesión (campos personalizados del Payment Link). */
export function datosCliente(session) {
  const campos = session.custom_fields || [];
  const etiqueta = (c) => normalizar(`${c.key || ''} ${c.label?.custom || ''}`);
  const valor = (c) => String(c?.text?.value || c?.dropdown?.value || '').trim();
  const campoApellidos = campos.find((c) => etiqueta(c).includes('apellido'));
  const campoNombre = campos.find((c) => c !== campoApellidos && etiqueta(c).includes('nombre'));
  let nombre = valor(campoNombre);
  let apellidos = valor(campoApellidos);
  const completo = session.customer_details?.name || '';
  if (!nombre && !apellidos) ({ nombre, apellidos } = separarNombre(completo));
  else if (!nombre) nombre = separarNombre(completo).nombre;
  return {
    nombre,
    apellidos,
    correo: String(session.customer_details?.email || session.customer_email || '').trim().toLowerCase(),
    celular: String(session.customer_details?.phone || '').trim(),
  };
}

const nombreCompleto = (c) => `${c.nombre} ${c.apellidos}`.trim();

// ---------------------------------------------------------------- checkout

async function checkoutPagado(session) {
  const s = stripe();
  const producto = await productoDeSesion(session);
  if (!producto) return { estado: `Sesión ${session.id} no es de Salud Digital: ignorada` };
  const { modalidad, cantidad } = producto;
  const { empresa, vendedor } = atribucionDeReferencia(session.client_reference_id);
  const cliente = datosCliente(session);

  let clienteStripe = idDe(session.customer);
  if (!clienteStripe) {
    // Los Payment Links de pago único pueden no crear cliente; lo creamos para el portal y el historial.
    const c = await s.customers.create({
      email: cliente.correo || undefined,
      name: nombreCompleto(cliente) || undefined,
      phone: cliente.celular || undefined,
      metadata: { empresa, vendedor },
    }, { idempotencyKey: `cliente-${session.id}` });
    clienteStripe = c.id;
  }

  if (session.mode === 'subscription') {
    const subId = idDe(session.subscription);
    await s.subscriptions.update(subId, {
      metadata: { empresa, vendedor, client_reference_id: session.client_reference_id || '' },
    });
    await asegurarAlta({
      clave: subId, cliente, clienteStripe, modalidad, empresa, vendedor,
      vigenteHasta: '', referencia: subId, pagoId: '',
    });
    // El cobro y la comisión del primer mes se registran con invoice.paid.
    return { estado: 'Alta mensual registrada', suscripcion: subId };
  }

  // ---- Prepago (trimestral / anual)
  const pagoId = idDe(session.payment_intent) || session.id;
  const meses = MESES_PREPAGO[modalidad] * cantidad;
  const movimientos = await leerTabla('Movimientos');
  const activa = buscarPrepagoActivo(movimientos, cliente.correo, clienteStripe, session.id);
  let tipoCobro;
  let resultado;

  if (activa) {
    tipoCobro = 'renovacion';
    const nuevaVigencia = await unaVez(`renovacion/${session.id}`, async () => {
      const finActual = normalizarFecha(activa.vigenteHasta) || hoyCDMX();
      const inicio = maxFecha(sumarDias(finActual, 1), hoyCDMX());
      const nueva = finDeVigencia(inicio, meses);
      await actualizarFila('Movimientos', activa._fila, {
        vigenteHasta: nueva,
        modalidad,
        avisoRenovacion: '',
        notas: agregarNota(activa.notas, `Renovó ${modalidad} el ${hoyCDMX()} hasta ${nueva} (${session.id})`),
      });
      return nueva;
    });
    if (cliente.correo) {
      await unaVez(`correo-renovacion/${session.id}`, async () => {
        await enviarCorreo({
          para: cliente.correo,
          ...plantillas.renovacionConfirmada({ nombre: cliente.nombre, modalidad, vigenteHasta: nuevaVigencia, pagoId }),
        }, `renovacion-${session.id}`);
        return true;
      });
    }
    resultado = { estado: 'Renovación de prepago registrada', vigenteHasta: nuevaVigencia };
  } else {
    tipoCobro = 'prepago';
    const vigenteHasta = finDeVigencia(hoyCDMX(), meses);
    await asegurarAlta({
      clave: session.id, cliente, clienteStripe, modalidad, empresa, vendedor,
      vigenteHasta, referencia: session.id, pagoId,
    });
    resultado = { estado: 'Alta de prepago registrada', vigenteHasta };
  }

  await registrarCobroYComisiones({
    clave: pagoId, tipo: tipoCobro, modalidad, cantidad,
    monto: (session.amount_total || 0) / 100,
    correo: cliente.correo, nombre: nombreCompleto(cliente), clienteStripe,
    pagoId, referencia: session.id, numero: '', empresa, vendedor,
  });
  return resultado;
}

/** Fila de Alta de prepago activa del mismo cliente (para detectar renovaciones). */
function buscarPrepagoActivo(movimientos, correo, clienteStripe, sesionId) {
  return movimientos
    .filter((f) => f.movimiento === 'Alta'
      && normalizar(f.estado) === 'activo'
      && esPrepago(f.modalidad)
      && f.referencia !== sesionId
      && ((correo && normalizar(f.correo) === normalizar(correo)) || (clienteStripe && f.clienteStripe === clienteStripe)))
    .sort((a, b) => String(normalizarFecha(b.vigenteHasta)).localeCompare(String(normalizarFecha(a.vigenteHasta))))[0];
}

async function asegurarAlta({ clave, cliente, clienteStripe, modalidad, empresa, vendedor, vigenteHasta, referencia, pagoId }) {
  await unaVez(`alta/${clave}`, async () => {
    const movimientos = await leerTabla('Movimientos');
    if (movimientos.some((f) => f.movimiento === 'Alta' && f.referencia === referencia)) return 'ya existía';
    await agregarFilas('Movimientos', [{
      fecha: ahoraCDMX(),
      movimiento: 'Alta',
      nombre: cliente.nombre,
      apellidos: cliente.apellidos,
      correo: cliente.correo,
      celular: cliente.celular,
      plan: PRODUCTO.planEverHealth,
      membresia: PRODUCTO.membresia,
      modalidad,
      grupo: grupoDe(empresa),
      vendedor,
      clienteStripe,
      vigenteHasta,
      enviado: 'no',
      estado: 'activo',
      empresa,
      referencia,
      pagoId,
      notas: '',
    }]);
    return 'registrada';
  });

  if (!cliente.correo) {
    console.warn(`[alta] ${referencia} sin correo: no se envió bienvenida`);
    return;
  }
  await unaVez(`correo-bienvenida/${clave}`, async () => {
    await enviarCorreo({
      para: cliente.correo,
      ...plantillas.bienvenida({ nombre: cliente.nombre, modalidad, vigenteHasta, pagoId }),
    }, `bienvenida-${clave}`);
    return true;
  });
}

// ---------------------------------------------------------------- cobros y comisiones

async function registrarCobroYComisiones(c) {
  const fecha = ahoraCDMX();
  if (!(c.monto > 0)) return; // sólo se comisiona lo efectivamente cobrado

  await unaVez(`cobro/${c.clave}`, async () => {
    const cobros = await leerTabla('Cobros');
    if (cobros.some((f) => f.referencia === c.referencia && f.pagoId === c.pagoId)) return 'ya existía';
    await agregarFilas('Cobros', [{
      fecha, tipo: c.tipo, modalidad: c.modalidad, correo: c.correo, nombre: c.nombre,
      clienteStripe: c.clienteStripe, montoCobrado: redondear(c.monto), montoReembolsado: 0,
      pagoId: c.pagoId, referencia: c.referencia, numero: c.numero,
      formaPago: await formaPagoSAT(c.pagoId), empresa: c.empresa, vendedor: c.vendedor, cfdi: '',
    }]);
    return 'registrado';
  });

  await unaVez(`comisiones/${c.clave}`, async () => {
    const vendedores = await leerTabla('Vendedores');
    const { filas, notas } = calcularComisiones({
      vendedor: c.vendedor, vendedores,
      cobro: { tipo: c.tipo, modalidad: c.modalidad, cantidad: c.cantidad },
      reglas: reglasComisiones(), lider: liderPorDefecto(),
    });
    if (notas.length) console.log(`[comisiones] ${c.referencia}: ${notas.join('; ')}`);
    await agregarFilas('Comisiones', filas.map((f) => ({
      fecha, pagoId: c.pagoId, referencia: c.referencia, tipo: c.tipo, modalidad: c.modalidad,
      correo: c.correo, clienteStripe: c.clienteStripe, empresa: c.empresa, vendedorVenta: c.vendedor,
      beneficiario: f.codigo, nombreBeneficiario: f.nombre, rol: f.rol, cantidad: c.cantidad,
      monto: f.monto, detalle: f.detalle, pagada: 'no',
    })));
    return filas.length;
  });
}

async function facturaPagada(inv) {
  const subId = suscripcionDeFactura(inv);
  if (!subId) return { estado: 'Factura sin suscripción: ignorada' };
  if (!(inv.amount_paid > 0)) return { estado: 'Factura en $0: sin cobro ni comisión' };

  const sub = await stripe().subscriptions.retrieve(subId);
  if (!esSuscripcionDeMembresia(sub)) return { estado: `Suscripción ${subId} de otro producto: ignorada` };
  const { empresa, vendedor } = await atribucionDeSuscripcion(sub);
  const tipo = inv.billing_reason === 'subscription_create' ? 'cierre' : 'mensual';
  const pagoId = await pagoDeFactura(inv);

  await registrarCobroYComisiones({
    clave: inv.id, tipo, modalidad: 'mensual', cantidad: cantidadDeSuscripcion(sub),
    monto: inv.amount_paid / 100,
    correo: String(inv.customer_email || '').toLowerCase(), nombre: inv.customer_name || '',
    clienteStripe: idDe(inv.customer), pagoId, referencia: inv.id, numero: inv.number || '',
    empresa, vendedor,
  });
  return { estado: `Cobro ${tipo} registrado`, factura: inv.id };
}

// ---------------------------------------------------------------- bajas

const MOTIVOS = {
  cancellation_requested: 'Cancelación solicitada por el cliente',
  payment_failed: 'Pago fallido sin más reintentos',
  payment_disputed: 'Contracargo / disputa',
};

async function pagoFallido(inv) {
  const subId = suscripcionDeFactura(inv);
  if (!subId) return { estado: 'Factura sin suscripción: ignorada' };
  if (inv.next_payment_attempt) {
    return { estado: `Pago fallido; Stripe reintentará el ${new Date(inv.next_payment_attempt * 1000).toISOString()}` };
  }
  return registrarBaja({ referencia: subId, motivo: MOTIVOS.payment_failed });
}

async function suscripcionCancelada(sub) {
  const motivo = MOTIVOS[sub.cancellation_details?.reason] || 'Suscripción cancelada';
  const r = await registrarBaja({ referencia: sub.id, motivo });
  if (r.registrada || r.yaEstabaDeBaja) await revisarMinimoTresMeses(sub);
  return r;
}

/** Aviso a administración si se canceló antes de 3 cobros (plazo mínimo del contrato). */
async function revisarMinimoTresMeses(sub) {
  await unaVez(`minimo/${sub.id}`, async () => {
    const facturas = await stripe().invoices.list({ subscription: sub.id, status: 'paid', limit: 12 });
    const cobros = facturas.data.filter((f) => f.amount_paid > 0).length;
    if (cobros >= 3) return cobros;
    const movimientos = await leerTabla('Movimientos');
    const alta = movimientos.find((f) => f.movimiento === 'Alta' && f.referencia === sub.id);
    const nota = `Canceló antes del mínimo de 3 meses (${cobros} cobro${cobros === 1 ? '' : 's'})`;
    if (alta) await actualizarFila('Movimientos', alta._fila, { notas: agregarNota(alta.notas, nota) });
    await alertaAdmin('Cancelación antes del plazo mínimo', [
      `${alta ? `${alta.nombre} ${alta.apellidos} <${alta.correo}>` : idDe(sub.customer)} canceló la suscripción ${sub.id}.`,
      `${nota}. Revisa si procede cobrar los meses restantes.`,
    ], `minimo-${sub.id}`);
    return cobros;
  });
}

/**
 * Registra la BAJA de la membresía cuya fila de Alta tiene `referencia` (sub_… o cs_…).
 * Agrega una fila "Baja" (enviado_a_EverHealth = no) y marca la Alta como "baja".
 */
export async function registrarBaja({ referencia, motivo, alta: altaDada }) {
  let alta = altaDada;
  if (!alta) {
    const movimientos = await leerTabla('Movimientos');
    alta = movimientos.find((f) => f.movimiento === 'Alta' && f.referencia === referencia);
  }
  if (!alta) {
    console.warn(`[baja] No hay Alta con referencia ${referencia}; no se registra baja`);
    return { registrada: false, estado: 'Sin alta registrada: nada que dar de baja' };
  }
  if (normalizar(alta.estado) === 'baja') {
    return { registrada: false, yaEstabaDeBaja: true, estado: 'Ya estaba dada de baja' };
  }
  await unaVez(`baja/${referencia}`, async () => {
    await agregarFilas('Movimientos', [{
      fecha: ahoraCDMX(),
      movimiento: 'Baja',
      nombre: alta.nombre,
      apellidos: alta.apellidos,
      correo: alta.correo,
      celular: alta.celular,
      plan: alta.plan || PRODUCTO.planEverHealth,
      membresia: alta.membresia || PRODUCTO.membresia,
      modalidad: alta.modalidad,
      grupo: alta.grupo,
      vendedor: alta.vendedor,
      clienteStripe: alta.clienteStripe,
      vigenteHasta: esPrepago(alta.modalidad) ? normalizarFecha(alta.vigenteHasta) : hoyCDMX(),
      enviado: 'no',
      estado: '',
      empresa: alta.empresa,
      referencia,
      pagoId: '',
      notas: motivo,
    }]);
    return true;
  });
  await actualizarFila('Movimientos', alta._fila, { estado: 'baja' });
  return { registrada: true, estado: `Baja registrada: ${motivo}` };
}

// ---------------------------------------------------------------- reembolsos

async function cargoReembolsado(charge) {
  const pagoId = idDe(charge.payment_intent) || charge.id;
  const facturaId = idDe(charge.invoice);
  const cobros = await leerTabla('Cobros');
  const cobro = cobros.find((f) => f.pagoId === pagoId) || (facturaId && cobros.find((f) => f.referencia === facturaId));
  if (!cobro) {
    console.warn(`[reembolso] Cargo ${charge.id} (${pagoId}) no está en Cobros`);
    return { estado: 'Reembolso de un pago que no está en Cobros: sin cambios' };
  }

  const reembolsado = charge.amount_refunded / 100;
  const proporcion = charge.amount > 0 ? Math.min(1, charge.amount_refunded / charge.amount) : 1;
  await actualizarFila('Cobros', cobro._fila, { montoReembolsado: redondear(reembolsado) });

  // Revierte la parte proporcional de cada comisión de ese pago (recalculado: idempotente)
  const comisiones = (await leerTabla('Comisiones')).filter((f) => f.pagoId === cobro.pagoId && f.referencia === cobro.referencia);
  const porBeneficiario = new Map();
  for (const f of comisiones) {
    const b = porBeneficiario.get(f.beneficiario) || { original: 0, revertido: 0, base: null };
    if (esReverso(f)) b.revertido += Number(f.monto) || 0;
    else { b.original += Number(f.monto) || 0; b.base = b.base || f; }
    porBeneficiario.set(f.beneficiario, b);
  }
  const nuevas = [];
  for (const b of porBeneficiario.values()) {
    if (!b.base) continue;
    const falta = redondear(-redondear(b.original * proporcion) - b.revertido);
    if (falta < 0) {
      nuevas.push({
        ...b.base,
        fecha: ahoraCDMX(),
        tipo: 'reverso',
        monto: falta,
        detalle: `Reembolso del ${Math.round(proporcion * 100)}% (${charge.id})`,
        pagada: 'no',
      });
    }
  }
  await agregarFilas('Comisiones', nuevas);

  await unaVez(`aviso-reembolso/${charge.id}/${charge.amount_refunded}`, async () => {
    await alertaAdmin('Reembolso registrado', [
      `Pago ${cobro.pagoId} de ${cobro.nombre || cobro.correo}: reembolsado $${reembolsado} de $${cobro.montoCobrado}.`,
      `Se agregaron ${nuevas.length} fila(s) de reverso en Comisiones.`,
      'La membresía NO se da de baja automáticamente: si procede, cancélala en Stripe (mensual) o registra la baja.',
    ], `reembolso-${charge.id}-${charge.amount_refunded}`);
    return true;
  });
  return { estado: 'Reembolso registrado', reversos: nuevas.length };
}
