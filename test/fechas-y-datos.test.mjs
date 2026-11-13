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
  assert.deepEqual(datosCliente(s), { nombre: 'Ana María', apellidos: 'López Pérez', correo: 'ana@example.com', celular: '+525512345678' });
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

test('Validación de solicitud de factura', () => {
  const base = { correo: 'a@b.mx', rfc: 'lopa800101ab1', razon_social: 'Ana López', regimen_fiscal: '605', cp: '06600', uso_cfdi: 'G03', id_pago: 'pi_123456' };
  const ok = validarSolicitud(base);
  assert.equal(ok.error, undefined);
  assert.equal(ok.datos.rfc, 'LOPA800101AB1');
  assert.match(validarSolicitud({ ...base, rfc: 'XAXX010101000' }).error, /público en general/);
  assert.match(validarSolicitud({ ...base, cp: '123' }).error, /código postal/);
});
