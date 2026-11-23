// Pruebas de fechas de vigencia, atribución y datos del cliente:  npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diasEntre, finDeVigencia, normalizarFecha, sumarMeses } from '../lib/fechas.mjs';
import { atribucionDeReferencia } from '../lib/stripe.mjs';
import { datosCliente } from '../lib/pagos.mjs';
import { aCsv } from '../lib/texto.mjs';
import { validarSolicitud } from '../lib/facturacion.mjs';

test('Vigencia trimestral y anual', () => {
  assert.equal(finDeVigencia('2026-11-13', 3), '2027-02-12');
  assert.equal(finDeVigencia('2026-11-13', 12), '2027-11-12');
  assert.equal(sumarMeses('2026-11-30', 3), '2027-02-28'); // fin de mes
});

test('Días entre fechas (aviso de 10 días)', () => {
  assert.equal(diasEntre('2027-02-02', '2027-02-12'), 10);
  assert.equal(diasEntre('2027-02-12', '2027-02-12'), 0);
  assert.equal(diasEntre('2027-02-13', '2027-02-12'), -1);
});

test('Fechas que vienen de Sheets', () => {
  assert.equal(normalizarFecha('2027-02-12'), '2027-02-12');
  assert.equal(normalizarFecha('2026-11-13 18:05'), '2026-11-13');
  assert.equal(normalizarFecha('12/02/2027'), '2027-02-12');
  assert.equal(normalizarFecha(46430), '2027-02-12'); // número de serie de Sheets
  assert.equal(normalizarFecha(''), '');
});

test('client_reference_id → empresa y vendedor', () => {
  assert.deepEqual(atribucionDeReferencia('cosmopolitana__V012'), { empresa: 'cosmopolitana', vendedor: 'V012' });
  assert.deepEqual(atribucionDeReferencia('web__directo'), { empresa: 'web', vendedor: 'directo' });
  assert.deepEqual(atribucionDeReferencia(null), { empresa: 'web', vendedor: 'directo' });
});

test('Datos del cliente desde campos personalizados', () => {
  const s = {
    custom_fields: [
      { key: 'nombre', label: { custom: 'Nombre(s)' }, text: { value: ' Ana María ' } },
      { key: 'apellidos', label: { custom: 'Apellidos' }, text: { value: 'López Pérez' } },
    ],
    customer_details: { email: 'Ana@Example.com', phone: '+525512345678', name: 'Otro Nombre' },
  };
  assert.deepEqual(datosCliente(s), { nombre: 'Ana María', apellidos: 'López Pérez', apellidoPaterno: 'López', apellidoMaterno: 'Pérez', correo: 'ana@example.com', celular: '+525512345678' });
});

test('Campos de nombre, apellido paterno y materno (formato Ever Health)', () => {
  const s = {
    custom_fields: [
      { key: 'nombre', label: { custom: 'Nombre(s)' }, text: { value: 'Juan' } },
      { key: 'apellidopaterno', label: { custom: 'Apellido paterno' }, text: { value: 'Pérez' } },
      { key: 'apellidomaterno', label: { custom: 'Apellido materno' }, text: { value: 'de la Garza' } },
    ],
    customer_details: { email: 'j@p.mx' },
  };
  const d = datosCliente(s);
  assert.equal(d.nombre, 'Juan');
  assert.equal(d.apellidoPaterno, 'Pérez');
  assert.equal(d.apellidoMaterno, 'de la Garza');
  assert.equal(d.apellidos, 'Pérez de la Garza');
});

test('Sin campos personalizados se separa el nombre completo', () => {
  const s = { customer_details: { email: 'x@y.mx', name: 'Juan Carlos Ruiz Díaz' } };
  const d = datosCliente(s);
  assert.equal(d.nombre, 'Juan Carlos');
  assert.equal(d.apellidos, 'Ruiz Díaz');
});

test('CSV escapa comillas y comas', () => {
  const csv = aCsv([['a', 'A'], ['b', 'B']], [{ a: 'x,"y"', b: 1 }]);
  assert.equal(csv, '"A","B"\r\n"x,""y""","1"');
});

test('Familiares: validación y metadata de Stripe', async () => {
  const { validarFamiliares, familiaresAMetadata, familiaresDeMetadata, esReferenciaFamiliar, titularDeReferencia } = await import('../lib/familia.mjs');
  const ok = validarFamiliares([{ nombre: ' Lucía ', apellidoPaterno: 'Pérez', apellidoMaterno: '', correo: 'LU@x.mx' }]);
  assert.equal(ok.error, undefined);
  assert.equal(ok.familiares[0].correo, 'lu@x.mx');
  assert.match(validarFamiliares([{ nombre: 'A', apellidoPaterno: 'B', correo: 'malo' }]).error, /correo/);
  assert.match(validarFamiliares([{ nombre: 'A', apellidoPaterno: 'B', correo: 'a@x.mx' }, { nombre: 'C', apellidoPaterno: 'D', correo: 'A@x.mx' }]).error, /distinto/);
  assert.match(validarFamiliares(Array(7).fill({ nombre: 'A', apellidoPaterno: 'B', correo: 'a@x.mx' })).error, /hasta 6/);
  const m = familiaresAMetadata(ok.familiares);
  assert.deepEqual(familiaresDeMetadata(m).map((f) => f.nombre), ['Lucía']);
  assert.ok(esReferenciaFamiliar('sub_123#f2'));
  assert.equal(titularDeReferencia('sub_123#f2'), 'sub_123');
});

test('Claves de idempotencia seguras para URL (familiares con "#")', async () => {
  const { claveSegura } = await import('../lib/idempotencia.mjs');
  assert.notEqual(claveSegura('pasos/alta/sub_1#f1'), claveSegura('pasos/alta/sub_1'));
  assert.equal(claveSegura('pasos/alta/sub_1#f1'), 'pasos/alta/sub_1_23_f1');
  assert.equal(claveSegura('eventos/evt_123'), 'eventos/evt_123');
  assert.match(claveSegura('a b?c'), /^[A-Za-z0-9/_.\-]+$/);
});

test('Validación de solicitud de factura', () => {
  const base = { correo: 'a@b.mx', rfc: 'lopa800101ab1', razon_social: 'Ana López', regimen_fiscal: '605', cp: '06600', uso_cfdi: 'G03', id_pago: 'pi_123456' };
  const ok = validarSolicitud(base);
  assert.equal(ok.error, undefined);
  assert.equal(ok.datos.rfc, 'LOPA800101AB1');
  assert.match(validarSolicitud({ ...base, rfc: 'XAXX010101000' }).error, /público en general/);
  assert.match(validarSolicitud({ ...base, cp: '123' }).error, /código postal/);
});
