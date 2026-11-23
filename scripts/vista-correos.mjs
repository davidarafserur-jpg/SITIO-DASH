// Genera vistas previas de los correos en dist/_correos/ (no se publican: dist se regenera en cada build).
// Uso:  npm run build && node scripts/vista-correos.mjs   → abre http://localhost:8888/_correos/
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { raiz } from './env.mjs';

process.env.SITE_URL ||= 'http://localhost:8888';
const p = await import(pathToFileURL(path.join(raiz, 'lib', 'plantillas.mjs')).href);

const ejemplos = {
  'bienvenida-mensual': p.bienvenida({ nombre: 'Ana María', modalidad: 'mensual', pagoId: 'pi_3UbPktGnDOk4iQu61WFke9oD' }),
  'bienvenida-trimestral': p.bienvenida({ nombre: 'Ana María', modalidad: 'trimestral', vigenteHasta: '2027-02-21', pagoId: 'pi_3UbPktGnDOk4iQu61WFke9oD' }),
  'bienvenida-titular-familia': p.bienvenida({ nombre: 'Ana María', modalidad: 'mensual', pagoId: '', familiares: 3 }),
  'bienvenida-familiar': p.bienvenida({ nombre: 'Lucía', modalidad: 'mensual', titularNombre: 'Ana María López', familiares: 0 }),
  'renovacion-confirmada': p.renovacionConfirmada({ nombre: 'Ana María', modalidad: 'anual', vigenteHasta: '2028-02-21', pagoId: 'pi_3Ub' }),
  'aviso-renovacion': p.avisoRenovacion({ nombre: 'Ana María', modalidad: 'trimestral', vigenteHasta: '2027-02-21', dias: 10, link: 'https://buy.stripe.com/test_ejemplo', precio: p.PRECIOS.trimestral }),
  'cargo-minimo': p.cargoMinimo({ nombre: 'Ana María', meses: 2, cobros: 1, minimo: 3, monto: 1273.68 }),
  'lote-everhealth': p.loteEverHealth({ fecha: '2026-11-22', altas: 3, bajas: 1 }),
  alerta: p.alerta('Cobro del plazo mínimo', ['Ana María canceló con 1 de 3 meses pagados.', 'Se emitió la factura in_123 por $1,273.68.', 'Este cobro no genera comisión.']),
};

const dir = path.join(raiz, 'dist', '_correos');
mkdirSync(dir, { recursive: true });
for (const [nombre, c] of Object.entries(ejemplos)) writeFileSync(path.join(dir, `${nombre}.html`), c.html);
writeFileSync(path.join(dir, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Correos</title>
<body style="font:15px system-ui;padding:24px"><h1>Vista previa de correos</h1><ul>${
  Object.entries(ejemplos).map(([n, c]) => `<li><a href="${n}.html">${n}</a> — <i>${c.asunto}</i></li>`).join('')}</ul></body>`);
console.log(`✔ ${Object.keys(ejemplos).length} correos en ${dir}`);
