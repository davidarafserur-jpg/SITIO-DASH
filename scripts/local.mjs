// Vista previa local en modo prueba (no publica nada):  npm run local  →  http://localhost:8888
// - Sirve las páginas de dist/ y manda /api/* a las funciones, igual que Netlify.
// - Si hay STRIPE_SECRET_KEY (sk_test_) en .env, arranca `stripe listen` para que los pagos
//   de prueba lleguen al webhook local, y pone los Payment Links de prueba en membresias.html
//   (sólo en la copia que se sirve aquí; el archivo no se modifica).
// - Sin SHEET_ID / RESEND_API_KEY, la hoja y los correos se guardan en .local/ y se ven en
//   http://localhost:8888/_local
import http from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cargarEnv, raiz } from './env.mjs';

cargarEnv();
process.env.MODO_LOCAL = '1';
process.env.SITE_URL ||= 'http://localhost:8888';
process.env.EVERHEALTH_EMAIL ||= 'everhealth@prueba.local';
process.env.ADMIN_EMAIL ||= 'admin@prueba.local';
process.env.EMAIL_FROM ||= 'DASH MEDIC CARE <pruebas@prueba.local>';
process.env.CARPETA_LOCAL = path.join(raiz, '.local');

const llave = process.env.STRIPE_SECRET_KEY || '';
if (llave && !/^(sk|rk)_test_/.test(llave)) {
  console.error('✖ La vista previa local sólo funciona con llaves de PRUEBA (sk_test_). Revisa .env.');
  process.exit(1);
}

const dist = path.join(raiz, 'dist');
const puerto = Number(process.env.PORT || 8888);
const local = await import(pathToFileURL(path.join(raiz, 'lib', 'local.mjs')).href);
const { escaparHtml } = await import(pathToFileURL(path.join(raiz, 'lib', 'texto.mjs')).href);
const { PESTANAS } = await import(pathToFileURL(path.join(raiz, 'lib', 'esquema.mjs')).href);

// ---------- stripe listen ----------
let estadoStripe = llave ? 'iniciando…' : 'sin llave: agrega STRIPE_SECRET_KEY=sk_test_… en .env';
function rutaStripe() {
  const winget = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
  const candidatos = [path.join(winget, 'Stripe.StripeCli_Microsoft.Winget.Source_8wekyb3d8bbwe', 'stripe.exe')];
  return candidatos.find((c) => existsSync(c)) || 'stripe';
}
if (llave) {
  const EVENTOS = [
    'checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed',
    'invoice.paid', 'invoice.payment_failed', 'customer.subscription.deleted', 'charge.refunded',
  ].join(',');
  const cli = spawn(rutaStripe(), ['listen', '--api-key', llave, '--events', EVENTOS, '--forward-to', `localhost:${puerto}/api/stripe-webhook`], { stdio: ['ignore', 'pipe', 'pipe'] });
  const leer = (d) => {
    const t = d.toString();
    const m = t.match(/(whsec_[A-Za-z0-9]+)/);
    if (m) {
      process.env.STRIPE_WEBHOOK_SECRET = m[1];
      estadoStripe = 'conectado: los pagos de prueba llegan aquí';
      console.log('[local] Stripe conectado. Los eventos de prueba se reenvían al webhook local.');
    }
    for (const linea of t.split(/\r?\n/)) if (/-->|<--|error|must/i.test(linea)) console.log(`[stripe] ${linea.trim()}`);
  };
  cli.stdout.on('data', leer);
  cli.stderr.on('data', leer);
  cli.on('error', (e) => { estadoStripe = `no se pudo iniciar Stripe CLI: ${e.message}`; console.error('[local]', estadoStripe); });
  cli.on('exit', (c) => { if (!estadoStripe.startsWith('no se')) estadoStripe = `Stripe CLI se detuvo (código ${c})`; });
  const salir = () => { cli.kill(); process.exit(0); };
  process.on('SIGINT', salir);
  process.on('SIGTERM', salir);
}

// ---------- funciones ----------
const RUTAS = {
  '/api/stripe-webhook': 'stripe-webhook.mjs',
  '/api/facturacion': 'facturacion.mjs',
  '/_local/tarea-diaria': 'tarea-diaria.mjs',
};
const TIPOS = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon' };

const cuerpoDe = (req) => new Promise((ok) => { const p = []; req.on('data', (c) => p.push(c)); req.on('end', () => ok(Buffer.concat(p))); });

async function funcion(archivo, req, url) {
  const mod = await import(pathToFileURL(path.join(raiz, 'netlify', 'functions', archivo)).href);
  const cuerpo = await cuerpoDe(req);
  return mod.default(new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : cuerpo }), {});
}

// ---------- páginas ----------
const AVISO = '<div style="position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#f59e0b;color:#111;font:600 13px/1.4 system-ui;padding:6px 12px;text-align:center">MODO PRUEBA LOCAL — nada se cobra de verdad · tarjeta 4242 4242 4242 4242 · <a href="/_local" style="color:#111">ver hoja y correos</a></div>';

function prepararMembresias(html) {
  const links = { digital_mensual: process.env.STRIPE_LINK_MENSUAL, digital_trimestral: process.env.STRIPE_LINK_TRIMESTRAL, digital_anual: process.env.STRIPE_LINK_ANUAL };
  for (const [k, v] of Object.entries(links)) {
    if (v && /^https:\/\/buy\.stripe\.com\/test_/.test(v)) html = html.replace(new RegExp(`(${k}\\s*:\\s*)''`), `$1'${v}'`);
  }
  return html;
}

async function estatico(ruta) {
  let archivo = path.join(dist, decodeURIComponent(ruta));
  if (!archivo.startsWith(dist)) return null;
  try { if ((await stat(archivo)).isDirectory()) archivo = path.join(archivo, 'index.html'); } catch { if (!path.extname(archivo)) archivo += '.html'; }
  let datos;
  try { datos = await readFile(archivo); } catch { return null; }
  const ext = path.extname(archivo).toLowerCase();
  if (ext === '.html') {
    let html = datos.toString('utf8');
    if (path.basename(archivo) === 'membresias.html') html = prepararMembresias(html);
    html = html.includes('</body>') ? html.replace('</body>', `${AVISO}</body>`) : html + AVISO;
    datos = Buffer.from(html);
  }
  return { datos, tipo: TIPOS[ext] || 'application/octet-stream' };
}

// ---------- panel /_local ----------
function tabla(pestana, filas) {
  const cols = PESTANAS[pestana];
  const cab = cols.map(([, h]) => `<th>${escaparHtml(h)}</th>`).join('');
  const cuerpo = filas.length
    ? filas.map((f) => `<tr>${cols.map(([k]) => `<td>${escaparHtml(String(f[k] ?? ''))}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${cols.length}" class="vacio">Sin filas todavía</td></tr>`;
  return `<h2>${pestana} <small>${filas.length}</small></h2><div class="scroll"><table><thead><tr>${cab}</tr></thead><tbody>${cuerpo}</tbody></table></div>`;
}

async function panel() {
  const hoja = await local.hojaLocal.leer();
  const correos = await local.correosLocales();
  const modoHoja = local.sheetsLocal() ? 'archivo local (.local/hoja.json)' : 'Google Sheets real (SHEET_ID)';
  const modoCorreo = local.correoLocal() ? 'se guardan aquí, no se envían' : 'se envían de verdad con Resend';
  const listaCorreos = correos.slice().reverse().map((c) => `
    <details><summary><b>${escaparHtml(c.asunto)}</b> → ${escaparHtml([].concat(c.para).join(', '))} <small>${escaparHtml(c.en.replace('T', ' ').slice(0, 19))}${c.adjuntos?.length ? ` · ${c.adjuntos.length} adjunto(s)` : ''}</small></summary>
    <iframe srcdoc="${escaparHtml(c.html || '')}"></iframe>
    ${(c.adjuntos || []).map((a, i) => `<a href="/_local/adjunto?c=${encodeURIComponent(c.id)}&i=${i}">Descargar ${escaparHtml(a.filename)}</a>`).join(' ')}</details>`).join('') || '<p class="vacio">Sin correos todavía</p>';
  return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Panel de prueba local</title>
<style>body{font:14px/1.45 system-ui;margin:0;padding:16px 20px 60px;background:#f6f7fb;color:#111}h1{margin:0 0 4px}h2{margin:28px 0 8px;font-size:17px}h2 small{color:#666;font-weight:400}
.estado{background:#fff;border:1px solid #ddd;border-radius:8px;padding:10px 14px;margin:12px 0}.scroll{overflow:auto;background:#fff;border:1px solid #ddd;border-radius:8px}
table{border-collapse:collapse;font-size:12.5px;min-width:100%}th,td{border-bottom:1px solid #eee;padding:5px 8px;text-align:left;white-space:nowrap}th{background:#eef1f7;position:sticky;top:0}
.vacio{color:#888;font-style:italic}details{background:#fff;border:1px solid #ddd;border-radius:8px;margin:6px 0;padding:8px 12px}iframe{width:100%;height:420px;border:1px solid #eee;margin-top:8px;background:#fff}
button{font:inherit;padding:7px 14px;border-radius:6px;border:1px solid #1e3a8a;background:#1e3a8a;color:#fff;cursor:pointer}button.sec{background:#fff;color:#1e3a8a}input{font:inherit;padding:6px}#res{white-space:pre-wrap;font:12px monospace;background:#111;color:#cfc;padding:10px;border-radius:6px;display:none;max-height:300px;overflow:auto}</style>
<h1>Panel de prueba local</h1><a href="/membresias.html?e=prueba&v=V012">← Ir a membresías (como vendedor V012)</a> · <a href="/membresias.html">sin vendedor</a> · <a href="/_local">↻ actualizar</a>
<div class="estado">Stripe: <b>${escaparHtml(estadoStripe)}</b><br>Hoja: ${modoHoja}<br>Correos: ${modoCorreo}</div>
<div class="estado"><b>Tarea diaria (18:00)</b> — lote a Ever Health, vencimientos, avisos de renovación, alerta de bolsa.<br>
Simular fecha: <input id="hoy" type="date"> <button onclick="tarea()">Correr tarea diaria ahora</button>
<button class="sec" onclick="if(confirm('¿Borrar la hoja, los correos y el registro de eventos locales?'))fetch('/_local/reiniciar',{method:'POST'}).then(()=>location.reload())">Reiniciar datos locales</button><div id="res"></div></div>
<script>async function tarea(){const r=document.getElementById('res');r.style.display='block';r.textContent='Corriendo…';const h=document.getElementById('hoy').value;const x=await fetch('/_local/tarea-diaria'+(h?'?hoy='+h:''),{method:'POST'});r.textContent=x.status+' '+JSON.stringify(await x.json(),null,2);setTimeout(()=>location.reload(),2500)}</script>
${Object.keys(PESTANAS).map((p) => tabla(p, hoja[p] || [])).join('')}
<h2>Correos <small>${correos.length}</small></h2>${listaCorreos}</html>`;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${puerto}`);
  try {
    if (url.pathname === '/_local' || url.pathname === '/_local/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(await panel());
      return;
    }
    if (url.pathname === '/_local/reiniciar' && req.method === 'POST') {
      await rm(process.env.CARPETA_LOCAL, { recursive: true, force: true });
      res.writeHead(204); res.end();
      return;
    }
    if (url.pathname === '/_local/adjunto') {
      const c = (await local.correosLocales()).find((x) => x.id === url.searchParams.get('c'));
      const a = c?.adjuntos?.[Number(url.searchParams.get('i'))];
      if (!a) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${a.filename.replace(/"/g, '')}"` });
      res.end(Buffer.from(a.content, 'base64'));
      return;
    }
    if (RUTAS[url.pathname]) {
      const hoy = url.searchParams.get('hoy');
      const antes = process.env.HOY_SIMULADO;
      if (url.pathname === '/_local/tarea-diaria') {
        if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
        if (hoy && /^\d{4}-\d{2}-\d{2}$/.test(hoy)) process.env.HOY_SIMULADO = hoy; else delete process.env.HOY_SIMULADO;
      }
      let r;
      try { r = await funcion(RUTAS[url.pathname], req, url); } finally {
        if (url.pathname === '/_local/tarea-diaria') { if (antes === undefined) delete process.env.HOY_SIMULADO; else process.env.HOY_SIMULADO = antes; }
      }
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(Buffer.from(await r.arrayBuffer()));
      console.log(`[local] ${req.method} ${url.pathname} → ${r.status}`);
      return;
    }
    const f = await estatico(url.pathname);
    if (!f) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('No encontrado'); return; }
    res.writeHead(200, { 'content-type': f.tipo });
    res.end(f.datos);
  } catch (e) {
    console.error('[local] Error:', e);
    res.writeHead(500); res.end('Error');
  }
}).listen(puerto, () => {
  console.log(`[local] Vista previa en http://localhost:${puerto}  ·  panel: http://localhost:${puerto}/_local`);
});
