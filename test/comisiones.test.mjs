// Pruebas del cálculo de comisiones:  npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularComisiones, reglasComisiones, unidadesDelCobro } from '../lib/comisiones.mjs';

const VENDEDORES = [
  { codigo: 'PAULO', nombre: 'Paulo', lider: 'PAULO', activo: 'sí' },
  { codigo: 'V012', nombre: 'Vendedora 12', lider: 'PAULO', activo: 'sí' },
  { codigo: 'V099', nombre: 'Inactivo', lider: 'PAULO', activo: 'no' },
];
const calc = (vendedor, cobro) => calcularComisiones({ vendedor, vendedores: VENDEDORES, cobro, lider: 'PAULO' });
const montos = (r) => Object.fromEntries(r.filas.map((f) => [f.codigo, f.monto]));

test('Líder vende: $149 en el primer cobro', () => {
  assert.deepEqual(montos(calc('PAULO', { tipo: 'cierre', modalidad: 'mensual' })), { PAULO: 149 });
});

test('Líder vende: $50 en cada cobro mensual siguiente', () => {
  assert.deepEqual(montos(calc('PAULO', { tipo: 'mensual', modalidad: 'mensual' })), { PAULO: 50 });
});

test('Otro vendedor: $120 vendedor + $29 líder en el primer cobro', () => {
  assert.deepEqual(montos(calc('V012', { tipo: 'cierre', modalidad: 'mensual' })), { V012: 120, PAULO: 29 });
});

test('Otro vendedor: $30 vendedor + $20 líder mensual', () => {
  assert.deepEqual(montos(calc('V012', { tipo: 'mensual', modalidad: 'mensual' })), { V012: 30, PAULO: 20 });
});

test('El código no distingue mayúsculas', () => {
  assert.deepEqual(montos(calc('v012', { tipo: 'cierre', modalidad: 'mensual' })), { V012: 120, PAULO: 29 });
});

test('Venta directa o vendedor desconocido: sin comisión', () => {
  assert.equal(calc('directo', { tipo: 'cierre', modalidad: 'mensual' }).filas.length, 0);
  assert.equal(calc('', { tipo: 'cierre', modalidad: 'mensual' }).filas.length, 0);
  const r = calc('V777', { tipo: 'cierre', modalidad: 'mensual' });
  assert.equal(r.filas.length, 0);
  assert.match(r.notas[0], /no está en la pestaña Vendedores/);
});

test('Vendedor inactivo: no cobra él, el líder sí', () => {
  assert.deepEqual(montos(calc('V099', { tipo: 'mensual', modalidad: 'mensual' })), { PAULO: 20 });
});

test('El líder por defecto cobra aunque no esté en la tabla', () => {
  const r = calcularComisiones({ vendedor: 'PAULO', vendedores: [], cobro: { tipo: 'cierre', modalidad: 'mensual' }, lider: 'PAULO' });
  assert.deepEqual(montos(r), { PAULO: 149 });
});

test('Prepago trimestral (supuesto): 1 cierre + 2 mensuales', () => {
  assert.deepEqual(montos(calc('V012', { tipo: 'prepago', modalidad: 'trimestral' })), { V012: 120 + 2 * 30, PAULO: 29 + 2 * 20 });
  assert.deepEqual(montos(calc('PAULO', { tipo: 'prepago', modalidad: 'trimestral' })), { PAULO: 149 + 2 * 50 });
});

test('Prepago anual (supuesto): 1 cierre + 11 mensuales', () => {
  assert.deepEqual(montos(calc('V012', { tipo: 'prepago', modalidad: 'anual' })), { V012: 120 + 11 * 30, PAULO: 29 + 11 * 20 });
});

test('Renovación de prepago (supuesto): todos los meses como mensual', () => {
  assert.deepEqual(montos(calc('V012', { tipo: 'renovacion', modalidad: 'trimestral' })), { V012: 90, PAULO: 60 });
});

test('Cantidad > 1 multiplica por membresía', () => {
  assert.deepEqual(montos(calc('V012', { tipo: 'cierre', modalidad: 'mensual', cantidad: 2 })), { V012: 240, PAULO: 58 });
});

test('COMISIONES_JSON cambia las reglas de prepago', () => {
  const reglas = reglasComisiones('{"prepago":{"mesesComisionables":{"anual":10}}}');
  assert.deepEqual(unidadesDelCobro({ tipo: 'prepago', modalidad: 'anual' }, reglas), { cierres: 1, mensuales: 9 });
  assert.equal(reglas.vendedor.cierre, 120);
  assert.equal(reglas.prepago.mesesComisionables.trimestral, 3);
});
