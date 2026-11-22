// Prueba la conexión con Google Sheets y prepara las variables para Netlify.
// Uso:  node scripts/google-prueba.mjs <archivo-llave.json> <SHEET_ID>
// - Recorta la llave a client_email + private_key (cabe en las variables de Netlify)
// - Crea las pestañas y encabezados en la hoja (si faltan) y lee la pestaña Vendedores
// - Escribe .env.netlify con SHEET_ID y GOOGLE_SERVICE_ACCOUNT_JSON para importarlas
// No imprime la llave.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { raiz } from './env.mjs';

const [archivo, sheetId] = process.argv.slice(2);
if (!archivo || !sheetId) { console.error('Uso: node scripts/google-prueba.mjs <llave.json> <SHEET_ID>'); process.exit(1); }
const c = JSON.parse(readFileSync(archivo, 'utf8'));
const recortada = JSON.stringify({ client_email: c.client_email, private_key: c.private_key });

process.env.GOOGLE_SERVICE_ACCOUNT_JSON = recortada;
process.env.SHEET_ID = sheetId;
delete process.env.MODO_LOCAL;

const { asegurarPestanas, leerTabla } = await import(pathToFileURL(path.join(raiz, 'lib', 'sheets.mjs')).href);
await asegurarPestanas();
const vendedores = await leerTabla('Vendedores');
console.log(`✔ Conexión correcta como ${c.client_email}`);
console.log(`  Vendedores en la hoja: ${vendedores.map((v) => v.codigo).join(', ') || '(ninguno)'}`);

writeFileSync(path.join(raiz, '.env.netlify'), [
  '# Copia TODO y pégalo en Netlify → Environment variables → Add a variable → Import from a .env file',
  '# Este archivo NO se sube a GitHub. Se borra cuando termines.',
  `SHEET_ID=${sheetId}`,
  `GOOGLE_SERVICE_ACCOUNT_JSON=${recortada}`,
  '',
].join('\n'));
console.log('✔ Variables listas en .env.netlify');
