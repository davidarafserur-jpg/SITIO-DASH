// Pestañas de la hoja de Google y sus columnas: [clave interna, encabezado en la hoja].
// El código busca las columnas por su encabezado, así que puedes reordenarlas,
// pero NO cambies el texto de los encabezados.

export const PESTANAS = {
  Movimientos: [
    ['fecha', 'Fecha'],
    ['movimiento', 'Movimiento'],              // Alta / Baja
    ['nombre', 'Nombre'],
    ['apellidos', 'Apellidos'],
    ['correo', 'Correo'],
    ['celular', 'Celular'],
    ['plan', 'Plan Ever Health'],              // Basic
    ['membresia', 'Membresía'],                // Salud Digital
    ['modalidad', 'Modalidad'],                // mensual / trimestral / anual
    ['grupo', 'Grupo'],                        // DASH Individual – <empresa>
    ['vendedor', 'Vendedor'],
    ['clienteStripe', 'ID cliente Stripe'],
    ['vigenteHasta', 'vigente_hasta'],
    ['enviado', 'enviado_a_EverHealth'],       // sí / no
    // --- Columnas de control que usa la automatización ---
    ['estado', 'Estado'],                      // activo / baja (sólo en filas de Alta)
    ['empresa', 'Empresa'],
    ['referencia', 'Referencia Stripe'],       // sub_… (mensual) o cs_… (prepago)
    ['pagoId', 'ID pago'],
    ['avisoRenovacion', 'Aviso renovación'],
    ['fechaEnvio', 'Fecha envío Ever Health'],
    ['notas', 'Notas'],
  ],
  Comisiones: [
    ['fecha', 'Fecha'],
    ['pagoId', 'ID pago'],
    ['referencia', 'Referencia Stripe'],
    ['tipo', 'Tipo'],                          // cierre / mensual / prepago / renovacion / reverso
    ['modalidad', 'Modalidad'],
    ['correo', 'Correo cliente'],
    ['clienteStripe', 'ID cliente Stripe'],
    ['empresa', 'Empresa'],
    ['vendedorVenta', 'Vendedor de la venta'],
    ['beneficiario', 'Beneficiario'],
    ['nombreBeneficiario', 'Nombre beneficiario'],
    ['rol', 'Rol'],                            // líder / vendedor
    ['cantidad', 'Membresías'],
    ['monto', 'Monto'],
    ['detalle', 'Detalle'],
    ['pagada', 'Pagada'],                      // para que administración marque lo pagado
  ],
  Vendedores: [
    ['codigo', 'Código'],
    ['nombre', 'Nombre'],
    ['lider', 'Líder'],
    ['activo', 'Activo'],
  ],
  Cobros: [
    ['fecha', 'Fecha'],
    ['tipo', 'Tipo'],
    ['modalidad', 'Modalidad'],
    ['correo', 'Correo'],
    ['nombre', 'Nombre completo'],
    ['clienteStripe', 'ID cliente Stripe'],
    ['montoCobrado', 'Monto cobrado'],
    ['montoReembolsado', 'Monto reembolsado'],
    ['pagoId', 'ID pago'],
    ['referencia', 'Referencia Stripe'],
    ['numero', 'Número de factura Stripe'],
    ['formaPago', 'Forma de pago SAT'],
    ['empresa', 'Empresa'],
    ['vendedor', 'Vendedor'],
    ['cfdi', 'CFDI'],
  ],
  Facturacion: [
    ['fecha', 'Fecha'],
    ['correo', 'Correo'],
    ['rfc', 'RFC'],
    ['razonSocial', 'Razón social'],
    ['regimen', 'Régimen fiscal'],
    ['cp', 'Código postal'],
    ['uso', 'Uso CFDI'],
    ['pagoId', 'ID pago'],
    ['monto', 'Monto'],
    ['estado', 'Estado'],                      // pendiente / emitida / error
    ['cfdiId', 'ID CFDI Facturapi'],
    ['notas', 'Notas'],
  ],
};

// Filas iniciales cuando la pestaña se crea vacía
export const SEMILLAS = {
  Vendedores: [{ codigo: 'PAULO', nombre: 'Paulo', lider: 'PAULO', activo: 'sí' }],
};
