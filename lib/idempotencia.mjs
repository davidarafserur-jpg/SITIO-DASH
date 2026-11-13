// Idempotencia con Netlify Blobs (almacenamiento incluido en Netlify, sin credenciales extra).
// - Por evento: un evento de Stripe ya procesado con éxito no se vuelve a procesar.
// - Por paso: si un evento falla a la mitad y Stripe lo reintenta, los pasos que ya
//   terminaron (fila escrita, correo enviado…) no se repiten.
import { getStore } from '@netlify/blobs';
import { blobsLocal, esLocal } from './local.mjs';

let tienda;
function store() {
  if (esLocal()) return blobsLocal;
  if (!tienda) tienda = getStore({ name: 'automatizacion-pagos', consistency: 'strong' });
  return tienda;
}

export async function yaProcesado(eventoId) {
  return (await store().get(`eventos/${eventoId}`)) !== null;
}

export async function marcarProcesado(eventoId, tipo) {
  await store().set(`eventos/${eventoId}`, JSON.stringify({ tipo, en: new Date().toISOString() }));
}

/**
 * Ejecuta `fn` sólo una vez por `clave`. Guarda su resultado (JSON) y lo devuelve
 * en llamadas posteriores sin volver a ejecutar. Si `fn` lanza error, no se marca.
 */
export async function unaVez(clave, fn) {
  const k = `pasos/${clave}`;
  const previo = await store().get(k);
  if (previo !== null) {
    try { return JSON.parse(previo).resultado; } catch { return undefined; }
  }
  const resultado = await fn();
  await store().set(k, JSON.stringify({ resultado: resultado ?? null, en: new Date().toISOString() }));
  return resultado;
}
