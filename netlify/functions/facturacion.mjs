// Solicitud de CFDI desde /facturacion.html → POST /api/facturacion
import { PRODUCTO } from '../../lib/config.mjs';
import { solicitarFactura, validarSolicitud } from '../../lib/facturacion.mjs';

const respuesta = (status, cuerpo) => new Response(JSON.stringify(cuerpo), {
  status, headers: { 'Content-Type': 'application/json' },
});

export default async (req) => {
  if (req.method !== 'POST') return respuesta(405, { ok: false, mensaje: 'Método no permitido' });

  let datos;
  try {
    const tipo = req.headers.get('content-type') || '';
    datos = tipo.includes('application/json')
      ? await req.json()
      : Object.fromEntries(new URLSearchParams(await req.text()));
  } catch {
    return respuesta(400, { ok: false, mensaje: 'Solicitud inválida.' });
  }

  // Campo trampa para bots: si viene lleno, fingimos éxito y no hacemos nada.
  if (datos.sitio_web) return respuesta(200, { ok: true, mensaje: 'Recibimos tu solicitud.' });

  const { error, datos: limpios } = validarSolicitud(datos);
  if (error) return respuesta(400, { ok: false, mensaje: error });

  try {
    const r = await solicitarFactura(limpios);
    return respuesta(r.ok ? 200 : 400, r);
  } catch (e) {
    console.error('[facturacion] ERROR:', e?.stack || e);
    return respuesta(500, {
      ok: false,
      mensaje: `No pudimos procesar tu solicitud. Intenta más tarde o escríbenos al ${PRODUCTO.telefono}.`,
    });
  }
};

export const config = { path: '/api/facturacion' };
