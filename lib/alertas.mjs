// Avisos internos a ADMIN_EMAIL.
import { lista } from './config.mjs';
import { enviarCorreo } from './correo.mjs';
import { alerta } from './plantillas.mjs';

export async function alertaAdmin(titulo, lineas, clave) {
  const { asunto, html, texto } = alerta(titulo, [].concat(lineas));
  console.log(`[alerta] ${titulo}: ${[].concat(lineas).join(' | ')}`);
  return enviarCorreo({ para: lista('ADMIN_EMAIL'), asunto, html, texto }, clave);
}
