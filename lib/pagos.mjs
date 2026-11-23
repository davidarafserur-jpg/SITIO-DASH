// Lógica de negocio de los eventos de Stripe: altas, bajas, cobros, comisiones y reembolsos.
// Cada paso es idempotente (unaVez + verificación en la hoja), así que un reintento de Stripe
// nunca duplica filas ni correos.
import { MESES_PREPAGO, PRODUCTO, esPrepago, grupoDe, liderPorDefecto, numero } from './config.mjs';
import { ahoraCDMX, finDeVigencia, hoyCDMX, maxFecha, normalizarFecha, sumarDias } from './fechas.mjs';
import { actualizarFila, agregarFilas, leerTabla } from './sheets.mjs';
import { unaVez } from './idempotencia.mjs';
import { calcularComisiones, esReverso, reglasComisiones } from './comisiones.mjs';
import * as plantillas from './plantillas.mjs';
import { alertaAdmin, enviarAlCliente } from './alertas.mjs';
import { agregarNota, normalizar, redondear } from './texto.mjs';
import {
  atribucionDeReferencia, atribucionDeSuscripcion, cantidadDeSuscripcion, esSuscripcionDeMembresia,
  familiaresDeSuscripcion, formaPagoSAT, idDe, pagoDeFactura, productoDeSesion, stripe, suscripcionDeFactura,
} from './stripe.mjs';
import { familiaresDeMetadata, referenciaFamiliar } from './familia.mjs';

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
  // Ever Health pide paterno y materno por separado; con un solo campo, la 1ª palabra es el paterno.
  const campoPaterno = campos.find((c) => etiqueta(c).includes('paterno'));
  const campoMaterno = campos.find((c) => etiqueta(c).includes('materno'));
  let apellidoPaterno = valor(campoPaterno);
  let apellidoMaterno = valor(campoMaterno);
  if (!apellidoPaterno && !apellidoMaterno) {
    const p = apellidos.split(/\s+/).filter(Boolean);
    apellidoPaterno = p[0] || '';
    apellidoMaterno = p.slice(1).join(' ');
  }
  if (campoPaterno || campoMaterno) apellidos = `${apellidoPaterno} ${apellidoMaterno}`.trim();
  return {
    nombre,
    apellidos,
    apellidoPaterno,
    apellidoMaterno,
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
  const familiares = familiaresDeMetadata(session.metadata);
  if (familiares.length !== (producto.familiares || 0)) {
    console.warn(`[familia] ${session.id}: ${producto.familiares || 0} familiares cobrados y ${familiares.length} registrados`);
  }

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
      vigenteHasta: '', referencia: subId, pagoId: '', familiares: familiares.length,
    });
    await altasFamiliares({ familiares, titular: cliente, clave: subId, referencia: subId, clienteStripe, modalidad, empresa, vendedor, vigenteHasta: '', pagoId: '' });
    // El cobro y la comisión del primer mes se registran con invoice.paid.
    return { estado: 'Alta mensual registrada', suscripcion: subId, familiares: familiares.length };
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
      await unaVez(`correo-renovacion/${session.id}`, () => enviarAlCliente({
        para: cliente.correo,
        ...plantillas.renovacionConfirmada({ nombre: cliente.nombre, modalidad, vigenteHasta: nuevaVigencia, pagoId }),
      }, `renovacion-${session.id}`, `Renovación ${modalidad} (${session.id}).`));
    }
    await altasFamiliares({
      familiares, titular: cliente, clave: session.id, referencia: activa.referencia, clienteStripe,
      modalidad, empresa, vendedor, vigenteHasta: nuevaVigencia, pagoId, renovacion: true,
    });
    resultado = { estado: 'Renovación de prepago registrada', vigenteHasta: nuevaVigencia, familiares: familiares.length };
  } else {
    tipoCobro = 'prepago';
    const vigenteHasta = finDeVigencia(hoyCDMX(), meses);
    await asegurarAlta({
      clave: session.id, cliente, clienteStripe, modalidad, empresa, vendedor,
      vigenteHasta, referencia: session.id, pagoId, familiares: familiares.length,
    });
    await altasFamiliares({ familiares, titular: cliente, clave: session.id, referencia: session.id, clienteStripe, modalidad, empresa, vendedor, vigenteHasta, pagoId });
    resultado = { estado: 'Alta de prepago registrada', vigenteHasta, familiares: familiares.length };
  }

  await registrarCobroYComisiones({
    familiares: producto.familiares || 0,
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

/**
 * Salud Digital familiar: una fila de Alta por familiar (cada uno es un usuario normal con su
 * propio acceso de Ever Health), con referencia "<titular>#f1", "#f2"… En una renovación de
 * prepago, el familiar que ya estaba activo sólo extiende su vigencia.
 */
async function altasFamiliares({ familiares, titular, clave, referencia, clienteStripe, modalidad, empresa, vendedor, vigenteHasta, pagoId, renovacion = false }) {
  if (!familiares.length) return;
  const titularNombre = `${titular.nombre} ${titular.apellidoPaterno || ''}`.trim();
  for (const [i, fam] of familiares.entries()) {
    const ref = referenciaFamiliar(referencia, i + 1);
    if (fam.correo && normalizar(fam.correo) === normalizar(titular.correo)) {
      // El correo es el acceso de Ever Health: no puede repetirse con el del titular.
      await unaVez(`familiar-duplicado/${clave}/${i + 1}`, () => alertaAdmin('Familiar con el mismo correo que el titular', [
        `En el paquete familiar de ${titularNombre} <${titular.correo}>, el familiar ${i + 1} (${fam.nombre} ${fam.apellidoPaterno}) trae el mismo correo que el titular.`,
        'No se registró ese familiar. Pide al titular el correo correcto y agrégalo a mano en la pestaña Movimientos.',
      ], `familiar-duplicado-${clave}-${i + 1}`).then(() => true));
      continue;
    }
    if (renovacion) {
      const previo = (await leerTabla('Movimientos')).find((f) => f.movimiento === 'Alta'
        && normalizar(f.estado) === 'activo' && normalizar(f.correo) === normalizar(fam.correo));
      if (previo) {
        await unaVez(`renovacion-familiar/${clave}/${i + 1}`, async () => {
          await actualizarFila('Movimientos', previo._fila, {
            vigenteHasta, modalidad, avisoRenovacion: '',
            notas: agregarNota(previo.notas, `Renovó con el titular el ${hoyCDMX()} hasta ${vigenteHasta}`),
          });
          return true;
        });
        continue;
      }
    }
    await asegurarAlta({
      clave: `${clave}#f${i + 1}`, cliente: fam, clienteStripe, modalidad, empresa, vendedor,
      vigenteHasta, referencia: ref, pagoId, titularNombre,
      notas: `Familiar de ${titularNombre} <${titular.correo}> (Salud Digital familiar)`,
    });
  }
}

async function asegurarAlta({ clave, cliente, clienteStripe, modalidad, empresa, vendedor, vigenteHasta, referencia, pagoId, titularNombre = '', notas = '', familiares = 0 }) {
  await unaVez(`alta/${clave}`, async () => {
    const movimientos = await leerTabla('Movimientos');
    if (movimientos.some((f) => f.movimiento === 'Alta' && f.referencia === referencia)) return 'ya existía';
    await agregarFilas('Movimientos', [{
      fecha: ahoraCDMX(),
      movimiento: 'Alta',
      nombre: cliente.nombre,
      apellidoPaterno: cliente.apellidoPaterno,
      apellidoMaterno: cliente.apellidoMaterno,
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
      notas: notas || (familiares ? `Titular de Salud Digital familiar con ${familiares} familiar${familiares === 1 ? '' : 'es'}` : ''),
    }]);
    return 'registrada';
  });

  if (!cliente.correo) {
    console.warn(`[alta] ${referencia} sin correo: no se envió bienvenida`);
    return;
  }
  await unaVez(`correo-bienvenida/${clave}`, async () => {
    const enviado = await enviarAlCliente({
      para: cliente.correo,
      ...plantillas.bienvenida({ nombre: cliente.nombre, modalidad, vigenteHasta, pagoId: titularNombre ? '' : pagoId, titularNombre, familiares }),
    }, `bienvenida-${clave}`, `Alta ${modalidad} de ${cliente.nombre} ${cliente.apellidoPaterno} (${referencia}).`);
    if (!enviado) await anotarEnAlta(referencia, `Correo inválido: no se envió la bienvenida (${cliente.correo})`);
    return enviado;
  });
}

async function anotarEnAlta(referencia, nota) {
  const alta = (await leerTabla('Movimientos')).find((f) => f.movimiento === 'Alta' && f.referencia === referencia);
  if (alta) await actualizarFila('Movimientos', alta._fila, { notas: agregarNota(alta.notas, nota) });
  return alta;
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

  // El cobro del plazo mínimo no comisiona: sólo se paga comisión por meses de servicio dado.
  if (c.sinComision) return;

  await unaVez(`comisiones/${c.clave}`, async () => {
    const vendedores = await leerTabla('Vendedores');
    const { filas, notas } = calcularComisiones({
      vendedor: c.vendedor, vendedores,
      cobro: { tipo: c.tipo, modalidad: c.modalidad, cantidad: c.cantidad, familiares: c.familiares || 0 },
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
  if (inv.metadata?.tipo === TIPO_MINIMO) return minimoPagado(inv);
  const subId = suscripcionDeFactura(inv);
  if (!subId) return { estado: 'Factura sin suscripción: ignorada' };
  if (!(inv.amount_paid > 0)) return { estado: 'Factura en $0: sin cobro ni comisión' };

  const sub = await stripe().subscriptions.retrieve(subId);
  if (!esSuscripcionDeMembresia(sub)) return { estado: `Suscripción ${subId} de otro producto: ignorada` };
  const { empresa, vendedor } = await atribucionDeSuscripcion(sub);
  const tipo = inv.billing_reason === 'subscription_create' ? 'cierre' : 'mensual';
  const pagoId = await pagoDeFactura(inv);

  await registrarCobroYComisiones({
    familiares: familiaresDeSuscripcion(sub),
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
  if (inv.metadata?.tipo === TIPO_MINIMO) {
    if (inv.next_payment_attempt) return { estado: 'Cobro del plazo mínimo fallido; Stripe reintentará' };
    await unaVez(`minimo-fallido/${inv.id}`, () => alertaAdmin('No se pudo cobrar el plazo mínimo', [
      `Factura ${inv.id} de ${inv.customer_email || idDe(inv.customer)} por $${(inv.amount_due || 0) / 100}: el cargo falló y Stripe ya no reintentará.`,
      'Contacta al cliente para cobrarlo por otro medio o anula la factura en Stripe.',
    ], `minimo-fallido-${inv.id}`).then(() => true));
    return { estado: 'Cobro del plazo mínimo fallido sin más reintentos: aviso enviado' };
  }
  const subId = suscripcionDeFactura(inv);
  if (!subId) return { estado: 'Factura sin suscripción: ignorada' };
  if (inv.next_payment_attempt) {
    return { estado: `Pago fallido; Stripe reintentará el ${new Date(inv.next_payment_attempt * 1000).toISOString()}` };
  }
  return bajaConFamiliares({ referencia: subId, motivo: MOTIVOS.payment_failed });
}

/** Baja del titular y de los familiares de su paquete (referencias "<titular>#fN"). */
async function bajaConFamiliares({ referencia, motivo }) {
  const r = await registrarBaja({ referencia, motivo });
  const familiares = (await leerTabla('Movimientos')).filter((f) => f.movimiento === 'Alta'
    && normalizar(f.estado) === 'activo' && String(f.referencia || '').startsWith(`${referencia}#f`));
  for (const alta of familiares) {
    await registrarBaja({ referencia: alta.referencia, alta, motivo: `${motivo} (familiar del titular)` });
  }
  if (familiares.length) r.familiaresDeBaja = familiares.length;
  return r;
}

async function suscripcionCancelada(sub) {
  const razon = sub.cancellation_details?.reason;
  const motivo = MOTIVOS[razon] || 'Suscripción cancelada';
  const r = await bajaConFamiliares({ referencia: sub.id, motivo });
  if (r.registrada || r.yaEstabaDeBaja) {
    // Sólo si el cliente pidió cancelar se cobra lo que falta del plazo mínimo.
    // Si se canceló por pago fallido o disputa, sólo se avisa a administración.
    r.minimo = await plazoMinimo(sub, { cobrar: razon === 'cancellation_requested' });
  }
  return r;
}

const TIPO_MINIMO = 'minimo';

/** Cobros mensuales pagados de la suscripción (sin contar el cobro del plazo mínimo). */
async function cobrosPagados(subId) {
  const facturas = await stripe().invoices.list({ subscription: subId, status: 'paid', limit: 24 });
  return facturas.data.filter((f) => f.amount_paid > 0 && f.metadata?.tipo !== TIPO_MINIMO).length;
}

/** Monto mensual de la membresía en la suscripción (centavos) y su moneda. */
function mensualidad(sub) {
  const items = (sub.items?.data || []).filter((i) => i.price?.recurring);
  const centavos = items.reduce((t, i) => t + (i.price.unit_amount || 0) * (i.quantity || 1), 0);
  return { centavos, moneda: items[0]?.price?.currency || 'mxn' };
}

/**
 * Plazo mínimo (MINIMO_MESES, 3 por defecto): si el cliente cancela antes de completar
 * los cobros mínimos, se le cobra en una sola factura lo que falta. Esa factura no
 * genera comisión (sólo se comisiona el servicio que efectivamente se dio).
 */
async function plazoMinimo(sub, { cobrar }) {
  return unaVez(`minimo/${sub.id}`, async () => {
    const s = stripe();
    const minimo = numero('MINIMO_MESES', 3);
    const cobros = await cobrosPagados(sub.id);
    const faltan = minimo - cobros;
    if (faltan <= 0) return { cobros, faltan: 0 };

    const { centavos, moneda } = mensualidad(sub);
    const monto = centavos * faltan;
    const alta = (await leerTabla('Movimientos')).find((f) => f.movimiento === 'Alta' && f.referencia === sub.id);
    const quien = alta
      ? `${alta.nombre} ${alta.apellidoPaterno || ''} ${alta.apellidoMaterno || ''}`.replace(/\s+/g, ' ').trim()
      : idDe(sub.customer);
    const nota = `Canceló con ${cobros} de ${minimo} meses mínimos`;

    if (!cobrar || !(monto > 0)) {
      if (alta) await anotarEnAlta(sub.id, `${nota}; no se cobró el resto (${sub.cancellation_details?.reason || 'sin motivo'})`);
      await alertaAdmin('Cancelación antes del plazo mínimo', [
        `${quien} <${alta?.correo || ''}>: suscripción ${sub.id} cancelada (${sub.cancellation_details?.reason || 'sin motivo'}).`,
        `${nota}. No se cobró automáticamente porque la cancelación no la pidió el cliente.`,
      ], `minimo-${sub.id}`);
      return { cobros, faltan, cobrado: false };
    }

    const cliente = idDe(sub.customer);
    const metodo = idDe(sub.default_payment_method)
      || idDe((await s.customers.retrieve(cliente)).invoice_settings?.default_payment_method)
      || undefined;
    const descripcion = `${PRODUCTO.membresia}: ${faltan} ${faltan === 1 ? 'mes restante' : 'meses restantes'} del plazo mínimo de ${minimo} meses`;
    const factura = await s.invoices.create({
      customer: cliente,
      collection_method: 'charge_automatically',
      auto_advance: true,
      pending_invoice_items_behavior: 'exclude',
      default_payment_method: metodo,
      description: descripcion,
      metadata: {
        tipo: TIPO_MINIMO, suscripcion: sub.id, meses: String(faltan),
        empresa: sub.metadata?.empresa || alta?.empresa || '', vendedor: sub.metadata?.vendedor || alta?.vendedor || '',
      },
    }, { idempotencyKey: `minimo-factura-${sub.id}` });
    await s.invoiceItems.create({
      customer: cliente, invoice: factura.id, amount: monto, currency: moneda, description: descripcion,
    }, { idempotencyKey: `minimo-concepto-${sub.id}` });

    let actual = await s.invoices.retrieve(factura.id);
    if (actual.status === 'draft') actual = await s.invoices.finalizeInvoice(factura.id);
    let cobrado = actual.status === 'paid';
    if (actual.status === 'open') {
      try {
        cobrado = (await s.invoices.pay(factura.id)).status === 'paid';
      } catch (e) {
        console.warn(`[minimo] Cargo de ${factura.id} rechazado: ${e.message}. Stripe reintentará.`);
      }
    }

    const pesosTexto = `$${(monto / 100).toFixed(2)}`;
    await anotarEnAlta(sub.id, `${nota}; se cobró el resto: ${pesosTexto} (${factura.id})${cobrado ? '' : ' — cargo pendiente'}`);
    await alertaAdmin('Cobro del plazo mínimo', [
      `${quien} canceló la suscripción ${sub.id} con ${cobros} de ${minimo} meses pagados.`,
      `Se emitió la factura ${factura.id} por ${pesosTexto} (${faltan} ${faltan === 1 ? 'mes' : 'meses'}): ${cobrado ? 'cobrada' : 'cargo rechazado; Stripe reintentará'}.`,
      'Este cobro no genera comisión.',
    ], `minimo-${sub.id}`);
    if (alta?.correo) {
      await enviarAlCliente({
        para: alta.correo,
        ...plantillas.cargoMinimo({ nombre: alta.nombre, meses: faltan, cobros, minimo, monto: monto / 100 }),
      }, `minimo-cliente-${sub.id}`, `Aviso de cobro del plazo mínimo (${sub.id}).`);
    }
    return { cobros, faltan, factura: factura.id, monto: monto / 100, cobrado };
  });
}

/** invoice.paid de la factura del plazo mínimo: se registra el cobro, sin comisión. */
async function minimoPagado(inv) {
  const pagoId = await pagoDeFactura(inv);
  await registrarCobroYComisiones({
    clave: inv.id, tipo: TIPO_MINIMO, modalidad: 'mensual', cantidad: Number(inv.metadata?.meses) || 1,
    monto: inv.amount_paid / 100,
    correo: String(inv.customer_email || '').toLowerCase(), nombre: inv.customer_name || '',
    clienteStripe: idDe(inv.customer), pagoId, referencia: inv.id, numero: inv.number || '',
    empresa: inv.metadata?.empresa || '', vendedor: inv.metadata?.vendedor || '',
    sinComision: true,
  });
  return { estado: 'Cobro del plazo mínimo registrado (sin comisión)', factura: inv.id };
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
      apellidoPaterno: alta.apellidoPaterno,
      apellidoMaterno: alta.apellidoMaterno,
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
