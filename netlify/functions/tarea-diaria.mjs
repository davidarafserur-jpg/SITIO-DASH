// Tarea programada diaria. Netlify usa UTC: "0 0 * * *" = 00:00 UTC = 18:00 en CDMX
// (México no tiene horario de verano desde 2022).
// Para probarla: Netlify → Functions → tarea-diaria → "Run now", o en local
// `netlify functions:invoke tarea-diaria`.
import { alertaAdmin } from '../../lib/alertas.mjs';
import {
  avisosDeRenovacion, enviarLoteEverHealth, facturaGlobalSiToca, procesarVencimientos, revisarBolsaBasic,
} from '../../lib/tareas.mjs';
import { hoyCDMX } from '../../lib/fechas.mjs';

// El orden importa: las bajas por vencimiento entran en el lote del mismo día.
const PASOS = [
  ['vencimientos', procesarVencimientos],
  ['loteEverHealth', enviarLoteEverHealth],
  ['avisosRenovacion', avisosDeRenovacion],
  ['bolsaBasic', revisarBolsaBasic],
  ['facturaGlobal', facturaGlobalSiToca],
];

export default async () => {
  const resultados = {};
  const errores = [];
  for (const [nombre, paso] of PASOS) {
    try {
      resultados[nombre] = await paso();
    } catch (e) {
      console.error(`[tarea-diaria] ERROR en ${nombre}:`, e?.stack || e);
      errores.push(`${nombre}: ${e.message}`);
    }
  }
  console.log(`[tarea-diaria] ${hoyCDMX()}`, JSON.stringify({ resultados, errores }));
  if (errores.length) {
    try {
      await alertaAdmin('Errores en la tarea diaria', errores);
    } catch (e) {
      console.error('[tarea-diaria] Tampoco se pudo avisar por correo:', e.message);
    }
  }
  return new Response(JSON.stringify({ resultados, errores }), {
    status: errores.length ? 500 : 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

export const config = { schedule: '0 0 * * *' };
