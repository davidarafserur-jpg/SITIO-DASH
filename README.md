# DASH MEDIC CARE — sitio y automatización de pagos

Sitio estático (HTML) en Netlify + Netlify Functions (Node 20) que automatizan la venta de la
membresía **Salud Digital**: Stripe → Google Sheets → correos → lote diario a Ever Health.

> Regla de oro: **nunca** se piden ni se guardan datos de salud. Sólo contacto, pago y datos fiscales.

## Qué hace

| Pieza | Archivo | Qué hace |
|---|---|---|
| Webhook de Stripe | `netlify/functions/stripe-webhook.mjs` → `/api/stripe-webhook` | Verifica la firma, ignora eventos repetidos y registra altas, cobros, comisiones, bajas y reembolsos. Si falla Sheets o el correo, responde 500 para que Stripe reintente. |
| Tarea diaria 18:00 CDMX | `netlify/functions/tarea-diaria.mjs` | Bajas por vencimiento de prepago → lote CSV a Ever Health → avisos de renovación → alerta de la bolsa Basic (> 450) → factura global (si está activa). |
| Facturación | `netlify/functions/facturacion.mjs` → `/api/facturacion` + `facturacion.html` | El cliente pide su CFDI con su RFC y el ID de su pago. **Apagada** (`FACTURACION_ACTIVA=false`): guarda la solicitud y avisa a administración. |
| Mi cuenta | `mi-cuenta.html` | Botón al portal de clientes de Stripe (cambiar tarjeta, recibos, cancelar). |
| Lógica | `lib/` | `pagos.mjs` (eventos), `comisiones.mjs` (reglas), `sheets.mjs`, `correo.mjs` (Resend), `facturapi.mjs`, `tareas.mjs`. |

Flujo de un cliente:

1. Llega a `membresias.html?e=cosmopolitana&v=V012` y paga con el Payment Link. La página manda `client_reference_id=cosmopolitana__V012` (sin parámetros: `web__directo`).
2. `checkout.session.completed` (en OXXO/SPEI se espera a `checkout.session.async_payment_succeeded`) → fila **Alta** en `Movimientos` con `enviado_a_EverHealth = no` + correo de bienvenida.
3. `invoice.paid` (mensual) o el mismo checkout (prepago) → fila en `Cobros` + filas en `Comisiones`.
4. A las 18:00 se envía el lote CSV a Ever Health y esas filas pasan a `sí`. Ever Health manda el acceso en máximo 48 h.
5. Cancelación, pago fallido sin más reintentos o vencimiento de un prepago sin renovar → fila **Baja**, que entra en el siguiente lote.

---

## 1. Despliegue: repositorio en GitHub conectado a Netlify

Arrastrar la carpeta a Netlify **no publica las Functions**. A partir de ahora el sitio se despliega desde GitHub.

1. Instala **Git** (https://git-scm.com/download/win) y **Node.js 20 LTS** (https://nodejs.org). Si prefieres no usar la terminal, sirve **GitHub Desktop**.
2. En GitHub crea un repositorio **privado** vacío (por ejemplo `sitio-dash`).
3. En una terminal dentro de esta carpeta:
   ```bash
   git init
   git add .
   git commit -m "Sitio + automatización de pagos"
   git branch -M main
   git remote add origin https://github.com/<tu-usuario>/sitio-dash.git
   git push -u origin main
   ```
   `.gitignore` deja fuera `node_modules`, `.env` y los respaldos `index.respaldo-*.html`.
4. En Netlify, abre el sitio actual → **Site configuration → Build & deploy → Continuous deployment → Link repository** y elige el repo. El build (`npm run build`, publicar `dist`) se lee de `netlify.toml`.
5. Carga las variables (sección 2) **antes** del primer deploy desde GitHub, o vuelve a desplegar después: **Deploys → Trigger deploy**.
6. Desde entonces, cada `git push` a `main` publica el sitio. Los formularios de Netlify (`preregistro`, `solicitud-demo`) siguen funcionando igual.

> Nota: la carpeta está en OneDrive. `node_modules` (que se crea al hacer `npm install` para probar en local) tiene miles de archivos; si OneDrive se pone lento, pausa la sincronización mientras pruebas o excluye esa carpeta.

## 2. Variables de entorno en Netlify

**Site configuration → Environment variables → Add a variable.** Todas vienen explicadas en `.env.example`.
Para pruebas locales, copia `.env.example` a `.env` (nunca lo subas a GitHub).

| Variable | Para qué |
|---|---|
| `STRIPE_SECRET_KEY` | Llave secreta. **Empieza con `sk_test_`**; cámbiala a `sk_live_` sólo cuando todo esté probado. |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` del endpoint (sección 3.5). |
| `STRIPE_PRICE_MENSUAL` / `_TRIMESTRAL` / `_ANUAL` | Price IDs (`price_…`). Sirven para reconocer la modalidad e ignorar otros productos. |
| `STRIPE_LINK_TRIMESTRAL` / `_ANUAL` | Payment Links de prepago, para el aviso de renovación. |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Credencial de la cuenta de servicio (sección 4). |
| `SHEET_ID` | ID de la hoja de Google. **Usa una hoja distinta para pruebas y para producción.** |
| `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO` | Correo (sección 5). |
| `EVERHEALTH_EMAIL` | A quién va el lote diario (varios separados por coma). En pruebas pon tu propio correo. |
| `ADMIN_EMAIL` | Alertas: errores, bolsa > 450, cancelaciones antes de 3 meses, reembolsos, solicitudes de factura. |
| `LIDER_CODIGO` | `PAULO`. |
| `CORPORATIVOS_ACTIVOS` | Afiliados corporativos en la bolsa Basic (hoy `201`: Kruger + HiPICK). Actualízala a mano cuando cambie. |
| `UMBRAL_BOLSA` | `450`. |
| `COMISIONES_JSON` | Opcional: cambia reglas de comisión sin tocar código (sección 7). |
| `FACTURACION_ACTIVA` | `false` hasta que el contador valide la configuración. |
| `FACTURAPI_KEY`, `SAT_CLAVE_PRODUCTO`, `SAT_CLAVE_UNIDAD`, `LUGAR_EXPEDICION_CP`, `FACTURACION_SOLO_MES_EN_CURSO` | Facturación (sección 8). |
| `HOY_SIMULADO` | **Sólo pruebas**: simula la fecha de hoy. Se ignora con llaves `sk_live_`. No la pongas en producción. |

> **Límite de 4 KB:** las Functions de Netlify reciben como máximo 4 KB de variables en total. El JSON completo de Google pesa unos 2.4 KB; recórtalo a sólo `{"client_email":"…","private_key":"…"}`. Si una variable sólo se usa en las Functions, en Netlify márcala con el alcance **Functions**.

## 3. Stripe

Trabaja primero en **modo de prueba** (interruptor "Modo de prueba" del Dashboard). Al pasar a producción hay que repetir los pasos 3.1 a 3.5 en modo real (los IDs cambian).

### 3.1 Producto y precios
Producto **Salud Digital** con tres precios en MXN, **IVA incluido** (Precios → "Incluir impuestos en el precio": sí):

| Modalidad | Precio | Tipo |
|---|---|---|
| Mensual | $636.84 | Recurrente, mensual |
| Prepago 3 meses | $1,910.52 | Pago único |
| Anual | $6,368.40 | Pago único |

Copia cada `price_…` a las variables `STRIPE_PRICE_*`.

### 3.2 Payment Links
Crea un Payment Link por precio:
- **Campos personalizados** (máx. 3): `Nombre(s)` y `Apellidos`, tipo texto, obligatorios. La automatización los reconoce por la palabra "nombre" / "apellido" en la etiqueta o la clave.
- **Recopilar número de teléfono**: activado.
- **Métodos de pago**: mensual → sólo tarjeta. Prepagos → tarjeta, OXXO y transferencia bancaria (SPEI). Actívalos antes en Configuración → Métodos de pago.
- **Después del pago** → redirigir a `https://<tu-dominio>/gracias-membresia.html`.
- Ni el Payment Link ni el código piden datos de salud.

Pega las URLs en `STRIPE_LINKS` de `membresias.html` (`digital_mensual`, `digital_trimestral`, `digital_anual`) y las dos de prepago también en `STRIPE_LINK_TRIMESTRAL` / `STRIPE_LINK_ANUAL`.

### 3.3 Reintentos y cancelación por falta de pago
Configuración → Facturación → **Recuperación de ingresos → Reintentos**: define los reintentos (por ejemplo, Smart Retries, 4 intentos en 2 semanas) y al final **"Cancelar la suscripción"**. Así el último fallo genera `invoice.payment_failed` sin más reintentos y luego `customer.subscription.deleted`. La baja se registra una sola vez.

### 3.4 Portal de clientes
Configuración → Facturación → **Portal de clientes**:
- Permitir actualizar método de pago y ver historial de facturas.
- Permitir cancelar suscripciones **al final del periodo de facturación**.
- Activa el **enlace de inicio de sesión** y pégalo en `STRIPE_PORTAL_LOGIN` de `mi-cuenta.html`.

> **Mínimo de 3 meses:** el portal deja cancelar en cualquier momento al final del periodo. La automatización registra la baja y, si hubo menos de 3 cobros, lo anota en `Notas` y avisa a `ADMIN_EMAIL` para que cobres los meses restantes según el contrato. No bloquea la cancelación.

### 3.5 Registrar el webhook
Desarrolladores → **Webhooks → Agregar endpoint**:
- URL: `https://<tu-dominio>/api/stripe-webhook`
- Eventos:
  - `checkout.session.completed`
  - `checkout.session.async_payment_succeeded`
  - `checkout.session.async_payment_failed`
  - `invoice.paid`
  - `invoice.payment_failed`
  - `customer.subscription.deleted`
  - `charge.refunded`
- Copia el **secreto de firma** (`whsec_…`) a `STRIPE_WEBHOOK_SECRET` y vuelve a desplegar.

El código lee los campos de las facturas tanto en versiones de API anteriores como posteriores a 2025-03 (los IDs de suscripción y pago cambiaron de lugar).

## 4. Google Sheets

1. En https://console.cloud.google.com crea un proyecto → **APIs y servicios → Habilitar APIs** → **Google Sheets API**.
2. **Credenciales → Crear credenciales → Cuenta de servicio**. En la cuenta, pestaña **Claves → Agregar clave → JSON**.
3. Del JSON descargado copia sólo `client_email` y `private_key` a `GOOGLE_SERVICE_ACCOUNT_JSON`:
   `{"client_email":"…@….iam.gserviceaccount.com","private_key":"-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----\n"}`
4. Crea la hoja de Google y **compártela con el `client_email` como Editor**.
5. Copia el ID de la URL (`/d/<ID>/edit`) a `SHEET_ID`.

La primera vez que corre, la automatización **crea las pestañas y los encabezados**:

| Pestaña | Contenido |
|---|---|
| `Movimientos` | Una fila por Alta y una por Baja. Columnas pedidas (fecha, movimiento, nombre, apellidos, correo, celular, plan Ever Health, membresía, modalidad, grupo, vendedor, ID cliente Stripe, vigente_hasta, enviado_a_EverHealth) **más columnas de control**: Estado (activo/baja, en las filas de Alta), Empresa, Referencia Stripe, ID pago, Aviso renovación, Fecha envío Ever Health, Notas. |
| `Comisiones` | Una fila por cobro y por beneficiario. Columna **Pagada** para que administración marque lo pagado. |
| `Vendedores` | Código, Nombre, Líder, Activo. Se crea con la fila de PAULO. |
| `Cobros` | *(de apoyo)* Una fila por pago: monto cobrado y reembolsado, forma de pago SAT, CFDI. Registra también los cobros sin vendedor y alimenta la facturación. |
| `Facturacion` | *(de apoyo)* Solicitudes de CFDI. |

Reglas para editar la hoja:
- **No cambies el texto de los encabezados.** Sí puedes reordenar columnas o agregar otras al final.
- No borres filas de `Movimientos`, `Cobros` ni `Comisiones` (son el historial). Para corregir, agrega una nota.
- Para reenviar una fila a Ever Health, cambia `enviado_a_EverHealth` a `no`.
- Para dar de baja a mano un prepago, cambia su `vigente_hasta` a una fecha pasada; la tarea diaria registra la baja.

## 5. Correo: Resend

Propongo **Resend** sobre SendGrid: API más simple, adjuntos en una sola llamada, claves de idempotencia (no duplica correos en reintentos) y 3,000 correos al mes gratis.

1. Crea la cuenta en https://resend.com → **Domains → Add domain** → `dashmediccare.com` y agrega en tu DNS los registros que te indique (SPF/DKIM). Espera a que diga *Verified*.
2. **API Keys → Create** (permiso *Sending access*) → `RESEND_API_KEY`.
3. `EMAIL_FROM` = `DASH MEDIC CARE <hola@dashmediccare.com>` (cualquier buzón del dominio verificado).

Correos que se envían:
- **Bienvenida** al darse de alta: "Tu acceso llega a tu correo en máximo 48 h desde DASH MEDIC CARE by Ever Health", condiciones, ID de pago para facturar y el contacto (55) 8120-2122.
- **Renovación confirmada** cuando un cliente con prepago vigente vuelve a pagar.
- **Aviso de renovación** 10 días antes del vencimiento de un prepago, con el Payment Link correspondiente (correo y vendedor ya llenados).
- **Lote diario** a Ever Health con el CSV adjunto (copia a `ADMIN_EMAIL`).
- **Alertas** a `ADMIN_EMAIL`.

## 6. Cómo agregar un vendedor

1. En la pestaña `Vendedores` agrega una fila: `Código` (ej. `V013`, sin espacios), `Nombre`, `Líder` = `PAULO`, `Activo` = `sí`.
2. Comparte su liga: `https://<tu-dominio>/membresias.html?v=V013&e=<empresa>` (ej. `&e=cosmopolitana`).
3. Para darlo de baja, pon `Activo` = `no`: deja de recibir comisiones (también residuales) y el líder conserva su parte. Para que los inactivos sigan cobrando residuales: `COMISIONES_JSON={"pagarAInactivos":true}`.

Un líder es quien tiene su propio código en `Líder` (o la columna vacía). Si alguien compra con un código que no está en la tabla, el cobro queda en `Cobros` sin comisión y se registra en el log.

## 7. Comisiones

En pesos, por membresía y sólo sobre lo cobrado:

| Venta de… | Primer cobro | Cada cobro mensual siguiente |
|---|---|---|
| Líder (PAULO) | Líder $149 | Líder $50 |
| Otro vendedor | Vendedor $120 + líder $29 | Vendedor $30 + líder $20 |

- El primer cobro es el `invoice.paid` con `billing_reason = subscription_create`; los demás son mensuales.
- Facturas en $0 no generan comisión. Un **reembolso** (`charge.refunded`) agrega filas de **reverso** con monto negativo, proporcionales a lo reembolsado. Un reembolso no da de baja automáticamente: se avisa a administración.

> **SUPUESTO — prepagos (pendiente de definir por DASH):** el pago de un prepago cuenta como **1 cierre + (meses − 1) mensualidades**, todo en el momento del cobro. Trimestral: 1 + 2. Anual: 1 + 11 (12 meses de vigencia). En una **renovación** de prepago todos los meses cuentan como mensualidad. Se cambia sin tocar código con `COMISIONES_JSON`, por ejemplo, para comisionar el anual como 10 meses:
> `COMISIONES_JSON={"prepago":{"mesesComisionables":{"anual":10}}}`
> Opciones: `lider`, `vendedor`, `liderSobreVendedor` (`{cierre, mensual}`), `prepago.mesesComisionables`, `prepago.cierreEnRenovacion`, `pagarAInactivos`. Las reglas viven en `lib/comisiones.mjs`.

## 8. Facturación CFDI 4.0 (Facturapi) — apagada

- Con `FACTURACION_ACTIVA=false`, `/facturacion.html` valida los datos, verifica que el ID de pago y el correo coincidan con un cobro, guarda la solicitud en `Facturacion` como **pendiente** y avisa a `ADMIN_EMAIL`. Emites el CFDI a mano y cambias el estado a `emitida`.
- Con `FACTURACION_ACTIVA=true`:
  - La solicitud emite el CFDI en Facturapi (PUE, IVA 16% incluido, forma de pago según el método real: 04/28 tarjeta, 01 OXXO, 03 SPEI) y lo envía al correo del cliente.
  - El **día 1 de cada mes** la tarea diaria emite la **factura global a público en general** (`XAXX010101000`, régimen 616, uso S01, periodicidad mensual) con los cobros del mes anterior que no tienen CFDI. Se emite una factura por forma de pago.
- El ID de pago que pide el formulario es el `pi_…` que llega en el correo de bienvenida/renovación o el número de factura de los recibos mensuales de Stripe.
- Con `FACTURACION_SOLO_MES_EN_CURSO=true` sólo se aceptan pagos del mes en curso, porque los anteriores ya van en la global.
- **Antes de activar**, valida con tu contador: `SAT_CLAVE_PRODUCTO` (por defecto `01010101`, provisional), `SAT_CLAVE_UNIDAD` (`E48`), `LUGAR_EXPEDICION_CP`, los usos de CFDI permitidos y la regla del mes en curso. Configura en Facturapi tu organización, CSD y serie, y prueba primero con la llave de prueba.

## 9. Tarea diaria

`0 0 * * *` en UTC = **18:00 en CDMX** (México no cambia de horario desde 2022). Pasos, en orden:

1. **Vencimientos:** prepagos con `vigente_hasta` anterior a hoy y sin renovar → Baja.
2. **Lote a Ever Health:** filas con `enviado_a_EverHealth = no` → CSV (UTF-8, abre bien en Excel) → se marcan `sí` con fecha. Si no hay pendientes, no se manda nada.
3. **Avisos de renovación:** prepagos que vencen en 10 días o menos y aún sin aviso.
4. **Bolsa Basic:** `CORPORATIVOS_ACTIVOS` + Altas individuales activas. Si pasa de `UMBRAL_BOLSA`, alerta (una por día).
5. **Factura global** (sólo si la facturación está activa y es día 1).

Cada paso es independiente: si uno falla, los demás corren y llega una alerta con el error. Para correrla a mano: Netlify → **Logs & metrics → Functions → tarea-diaria → Run now**. Las tareas programadas sólo corren en el deploy de producción, no en los *deploy previews*.

## 10. Errores, logs e idempotencia

- Los logs están en Netlify → **Logs & metrics → Functions**. Todos llevan prefijo (`[webhook]`, `[tarea-diaria]`, …).
- Si Sheets, Resend o Stripe fallan, el webhook responde **500** y Stripe reintenta durante ~3 días (en Stripe → Webhooks se ve cada intento).
- Cada evento procesado se guarda en **Netlify Blobs** (incluido en Netlify, no requiere configuración). Cada paso (fila, correo, comisión) también se marca, así que un reintento nunca duplica filas ni correos.

## 11. Cómo probar

- Pruebas unitarias del cálculo de comisiones, fechas y validaciones: `npm install` y luego `npm test`.
- Plan completo con Stripe CLI (alta mensual, cobro mensual, pago fallido, cancelación, prepago OXXO y vencimiento, comisiones, lote y alerta de 450): **[PRUEBAS.md](PRUEBAS.md)**.

## 12. Supuestos y pendientes por confirmar

1. **Comisiones de prepago** (sección 7): supuesto configurable.
2. **Mínimo de 3 meses:** se avisa, no se bloquea (sección 3.4).
3. **Vendedor inactivo:** deja de cobrar, también residuales; el líder conserva su parte.
4. **Reembolsos:** revierten la comisión proporcional; la baja es manual.
5. Un cliente con suscripción mensual que además compra un prepago genera una segunda Alta (no se fusionan).
6. **Facturación:** claves SAT, CP de expedición y regla del mes en curso, por validar con el contador.
7. `CORPORATIVOS_ACTIVOS` se actualiza a mano.
