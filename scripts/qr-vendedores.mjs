// Genera el código QR de cada vendedor (y, si se indica, de una empresa) para imprimir.
// El QR abre membresias.html?e=<empresa>&v=<código>: la venta queda atribuida al vendedor
// (client_reference_id) y, si la empresa tiene precio especial (lib/empresas.mjs), se muestra ese precio.
//
// Uso:
//   npm run qr                                   → todos los vendedores activos de la pestaña Vendedores
//   npm run qr -- --empresa cosmopolitana        → QR con el precio de La Cosmopolitana
//   npm run qr -- --codigos PAULO,V012           → sólo esos códigos (sin leer la hoja)
//   npm run qr -- --sitio https://dash-pruebas.netlify.app
// Para leer la hoja: SHEET_ID y GOOGLE_SERVICE_ACCOUNT_JSON en .env, o --llave <archivo.json> --hoja <SHEET_ID>.
// Resultado: qr-vendedores/<empresa|general>/  (un PNG por vendedor + hoja imprimible index.html)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import QRCode from 'qrcode';
import { cargarEnv, raiz } from './env.mjs';

cargarEnv();
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const sitio = (args.sitio || process.env.SITE_URL_PUBLICO || 'https://dashmediccare.com').replace(/\/$/, '');
const empresa = String(args.empresa || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
const { EMPRESAS } = await import(pathToFileURL(path.join(raiz, 'lib', 'empresas.mjs')).href);
const { escaparHtml: e } = await import(pathToFileURL(path.join(raiz, 'lib', 'texto.mjs')).href);
const nombreEmpresa = EMPRESAS[empresa]?.nombre || (empresa ? empresa : '');

async function vendedores() {
  if (args.codigos) return args.codigos.split(',').map((c) => ({ codigo: c.trim().toUpperCase(), nombre: c.trim().toUpperCase() })).filter((v) => v.codigo);
  if (args.llave) {
    const c = JSON.parse(readFileSync(args.llave, 'utf8'));
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: c.client_email, private_key: c.private_key });
  }
  if (args.hoja) process.env.SHEET_ID = args.hoja;
  if (!process.env.SHEET_ID || !process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    console.error('✖ Indica --codigos PAULO,V012 o la hoja (SHEET_ID + llave) para leer la pestaña Vendedores.');
    process.exit(1);
  }
  const { leerTabla } = await import(pathToFileURL(path.join(raiz, 'lib', 'sheets.mjs')).href);
  const { esSi } = await import(pathToFileURL(path.join(raiz, 'lib', 'texto.mjs')).href);
  return (await leerTabla('Vendedores'))
    .filter((v) => v.codigo && esSi(v.activo, true))
    .map((v) => ({ codigo: String(v.codigo).trim().toUpperCase(), nombre: v.nombre || v.codigo }));
}

const lista = await vendedores();
if (!lista.length) { console.error('✖ No hay vendedores activos.'); process.exit(1); }

const dir = path.join(raiz, 'qr-vendedores', empresa || 'general');
mkdirSync(dir, { recursive: true });
const tarjetas = [];
for (const v of lista) {
  const url = `${sitio}/membresias.html?${empresa ? `e=${encodeURIComponent(empresa)}&` : ''}v=${encodeURIComponent(v.codigo)}`;
  const opciones = { errorCorrectionLevel: 'M', margin: 2, color: { dark: '#1E2461', light: '#FFFFFF' } };
  await QRCode.toFile(path.join(dir, `${v.codigo}.png`), url, { ...opciones, width: 1024 });
  const dataUrl = await QRCode.toDataURL(url, { ...opciones, width: 600 });
  tarjetas.push({ ...v, url, dataUrl });
  console.log(`${v.codigo.padEnd(10)} ${url}`);
}

const logo = `data:image/png;base64,${readFileSync(path.join(raiz, 'img', 'logo-dash.png')).toString('base64')}`;
writeFileSync(path.join(dir, 'index.html'), `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>QR vendedores${nombreEmpresa ? ` · ${e(nombreEmpresa)}` : ''} · DASH MEDIC CARE</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
<style>
  @page { size: letter; margin: 12mm; }
  body { font-family: Inter, Arial, sans-serif; color: #1E2461; margin: 0; background: #F4F8FF; }
  .barra { padding: 14px 20px; background: #1E2461; color: #fff; display: flex; justify-content: space-between; align-items: center; }
  .barra button { font: inherit; font-weight: 700; background: #47C6E8; color: #1E2461; border: 0; border-radius: 8px; padding: 8px 16px; cursor: pointer; }
  .hoja { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10mm; padding: 10mm; }
  .tarjeta { background: #fff; border: 2px solid #47C6E8; border-radius: 16px; padding: 16px; text-align: center; break-inside: avoid; }
  .tarjeta img.logo { width: 90px; }
  .tarjeta h2 { margin: 6px 0 2px; font-size: 18px; font-weight: 800; }
  .tarjeta .sub { font-size: 12px; color: #1565C0; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; }
  .tarjeta img.qr { width: 62%; max-width: 240px; margin: 8px auto 4px; display: block; }
  .tarjeta .nombre { font-size: 16px; font-weight: 800; }
  .tarjeta .codigo { font-size: 13px; color: #6B7280; }
  .tarjeta .url { font-size: 9.5px; color: #6B7280; word-break: break-all; margin-top: 6px; }
  @media print { body { background: #fff; } .barra { display: none; } .hoja { padding: 0; } }
</style></head><body>
<div class="barra"><span><b>QR de vendedores</b>${nombreEmpresa ? ` · ${e(nombreEmpresa)}` : ''} · ${tarjetas.length} vendedores</span><button onclick="print()">Imprimir</button></div>
<div class="hoja">${tarjetas.map((t) => `
  <div class="tarjeta">
    <img class="logo" src="${logo}" alt="DASH MEDIC CARE">
    <div class="sub">${nombreEmpresa ? `Colaboradores ${e(nombreEmpresa)}` : 'Salud Digital'}</div>
    <h2>Escanea y contrata tu membresía</h2>
    <img class="qr" src="${t.dataUrl}" alt="QR ${e(t.codigo)}">
    <div class="nombre">Te atiende: ${e(t.nombre)}</div>
    <div class="codigo">Código de asesor: ${e(t.codigo)}</div>
    <div class="url">${e(t.url)}</div>
  </div>`).join('')}
</div></body></html>`);
console.log(`\n✔ ${tarjetas.length} QR en ${dir}  (abre index.html para imprimir)`);
