// Pasos de la tarea diaria (18:00 CDMX).
import { bandera, esPrepago, lista, numero, opcional } from './config.mjs';
import { ahoraCDMX, diasEntre, hoyCDMX, normalizarFecha, sumarMeses } from './fechas.mjs';
import { actualizarFilas, leerTabla } from './sheets.mjs';
import { registrarBaja } from './pagos.mjs';
import { enviarCorreo } from './correo.mjs';
import * as plantillas from './plantillas.mjs';
import { alertaAdmin } from './alertas.mjs';
import { unaVez } from './idempotencia.mjs';
import { aCsv, normalizar } from './texto.mjs';
import { emitirFacturaGlobal } from './facturacion.mjs';

const altasActivas = (movs) => movs.filter((f) => f.movimiento === 'Alta' && normalizar(f.estado) === 'activo');

/** 1) Prepagos vencidos sin renovación → BAJA. */
export async function procesarVencimientos() {
  const hoy = hoyCDMX();
  const movs = await leerTabla('Movimientos');
  const vencidas = altasActivas(movs).filter((f) => {
    const fin = normalizarFecha(f.vigenteHasta);
    return esPrepago(f.modalidad) && fin && fin < hoy;
  });
  for (const alta of vencidas) {
    await registrarBaja({
      referencia: alta.referencia,
      alta,
      motivo: `Prepago vencido el ${normalizarFecha(alta.vigenteHasta)} sin renovación`,
    });
  }
  return { bajasPorVencimiento: vencidas.length };
}

// Columnas que recibe Ever Health (sin datos internos de DASH)
const COLUMNAS_LOTE = [
  ['fecha', 'Fecha'], ['movimiento', 'Movimiento'], ['nombre', 'Nombre'], ['apellidos', 'Apellidos'],
  ['correo', 'Correo'], ['celular', 'Celular'], ['plan', 'Plan Ever Health'], ['membresia', 'Membresía'],
  ['modalidad', 'Modalidad'], ['grupo', 'Grupo'], ['vigenteHasta', 'vigente_hasta'],
];

/** 2) Lote de altas/bajas pendientes → EVERHEALTH_EMAIL con CSV; se marcan como enviadas. */
export async function enviarLoteEverHealth() {
  const movs = await leerTabla('Movimientos');
  const pendientes = movs.filter((f) => normalizar(f.enviado) === 'no');
  if (!pendientes.length) return { enviados: 0 };

  const hoy = hoyCDMX();
  const filas = pendientes.map((f) => ({ ...f, vigenteHasta: normalizarFecha(f.vigenteHasta) }));
  const csv = `﻿${aCsv(COLUMNAS_LOTE, filas)}`; // BOM para que Excel respete acentos
  const altas = pendientes.filter((f) => f.movimiento === 'Alta').length;
  const { asunto, html, texto } = plantillas.loteEverHealth({ fecha: hoy, altas, bajas: pendientes.length - altas });
  const cc = opcional('ADMIN_EMAIL') ? lista('ADMIN_EMAIL') : [];

  await enviarCorreo({
    para: lista('EVERHEALTH_EMAIL'), cc, asunto, html, texto,
    adjuntos: [{ filename: `DASH_altas_bajas_${hoy}.csv`, content: Buffer.from(csv, 'utf8').toString('base64') }],
  });
  const ahora = ahoraCDMX();
  await actualizarFilas('Movimientos', pendientes.map((f) => ({
    fila: f._fila, cambios: { enviado: 'sí', fechaEnvio: ahora },
  })));
  return { enviados: pendientes.length, altas, bajas: pendientes.length - altas };
}

/** 3) Aviso de renovación 10 días antes del vencimiento de un prepago. */
export async function avisosDeRenovacion() {
  const hoy = hoyCDMX();
  const movs = await leerTabla('Movimientos');
  const porAvisar = altasActivas(movs).filter((f) => {
    const fin = normalizarFecha(f.vigenteHasta);
    if (!esPrepago(f.modalidad) || !fin || f.avisoRenovacion || !f.correo) return false;
    const dias = diasEntre(hoy, fin);
    return dias >= 0 && dias <= 10;
  });

  const marcar = [];
  for (const f of porAvisar) {
    const modalidad = normalizar(f.modalidad);
    const fin = normalizarFecha(f.vigenteHasta);
    const base = opcional(modalidad === 'anual' ? 'STRIPE_LINK_ANUAL' : 'STRIPE_LINK_TRIMESTRAL');
    let link = '';
    if (base) {
      const url = new URL(base);
      url.searchParams.set('prefilled_email', f.correo);
      url.searchParams.set('client_reference_id', `${f.empresa || 'web'}__${f.vendedor || 'directo'}`);
      link = url.toString();
    }
    await unaVez(`aviso-renovacion/${f.referencia}/${fin}`, async () => {
      await enviarCorreo({
        para: f.correo,
        ...plantillas.avisoRenovacion({
          nombre: f.nombre, modalidad, vigenteHasta: fin, dias: diasEntre(hoy, fin),
          link, precio: plantillas.PRECIOS[modalidad],
        }),
      }, `aviso-${f.referencia}-${fin}`);
      return true;
    });
    marcar.push({ fila: f._fila, cambios: { avisoRenovacion: hoy } });
  }
  await actualizarFilas('Movimientos', marcar);
  return { avisos: marcar.length };
}

/** 4) Bolsa Basic: corporativos + individuales activos; alerta si pasa del umbral. */
export async function revisarBolsaBasic() {
  const movs = await leerTabla('Movimientos');
  const individuales = altasActivas(movs).length;
  const corporativos = numero('CORPORATIVOS_ACTIVOS', 0);
  const umbral = numero('UMBRAL_BOLSA', 450);
  const total = corporativos + individuales;
  if (total > umbral) {
    await alertaAdmin(`Bolsa Basic en ${total} afiliados (tope ${umbral})`, [
      `Corporativos activos: ${corporativos}. Individuales activos: ${individuales}. Total: ${total}.`,
      `Se pasó del tope de ${umbral}. Revisa la capacidad contratada con Ever Health.`,
    ], `bolsa-${hoyCDMX()}`);
  }
  return { corporativos, individuales, total, umbral, alerta: total > umbral };
}

/** 5) Factura global del mes anterior (sólo con FACTURACION_ACTIVA=true, el día 1). */
export async function facturaGlobalSiToca() {
  if (!bandera('FACTURACION_ACTIVA')) return { estado: 'Facturación apagada' };
  const hoy = hoyCDMX();
  if (!hoy.endsWith('-01')) return { estado: 'Hoy no toca factura global' };
  const periodo = sumarMeses(hoy, -1).slice(0, 7); // AAAA-MM
  return unaVez(`factura-global/${periodo}`, () => emitirFacturaGlobal(periodo));
}
