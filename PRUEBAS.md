# Plan de pruebas — automatización de pagos

Todo en **modo de prueba** de Stripe (`sk_test_…`) y con una **hoja de Google de pruebas**.
Usa tu propio correo en `EVERHEALTH_EMAIL` y `ADMIN_EMAIL` para no mandarle pruebas a Ever Health.
Los comandos son para **PowerShell**.

## Prueba rápida en tu computadora (sin publicar nada)

No necesita Netlify, Google Sheets ni Resend: la hoja y los correos se guardan en la carpeta `.local/`
y se ven en un panel.

1. En Stripe activa **Test mode / Sandbox**, copia la *Secret key* (`sk_test_…`) y pégala en el archivo `.env`, en `STRIPE_SECRET_KEY=`.
2. Crea el producto, los 3 precios y los 3 Payment Links de prueba (sólo la primera vez):
   ```bash
   npm run stripe:prueba
   ```
3. Arranca la vista previa (deja la ventana abierta; se detiene con Ctrl + C):
   ```bash
   npm run local
   ```
4. Abre `http://localhost:8888/membresias.html?e=prueba&v=V012`, elige un plan y paga con la tarjeta `4242 4242 4242 4242` (cualquier fecha futura y CVC).
5. Abre `http://localhost:8888/_local`: verás la fila de Alta, el cobro, las comisiones (V012 + PAULO) y el correo de bienvenida.
6. En el mismo panel, **Correr tarea diaria** con una fecha simulada para ver el lote a Ever Health, los avisos de renovación y los vencimientos.

**Reiniciar datos locales** borra la hoja, los correos y el registro de eventos de `.local/`; no toca nada en Stripe.

## 0. Preparación (una vez)

1. Instala Node 20 y Netlify CLI:
   ```bash
   npm install -g netlify-cli
   ```
2. Instala Stripe CLI (Windows: descarga el `.zip` de https://github.com/stripe/stripe-cli/releases, descomprime `stripe.exe` y agrégalo al PATH) e inicia sesión:
   ```bash
   stripe login
   ```
3. En esta carpeta:
   ```bash
   npm install
   ```
   ```bash
   npm test
   ```
   Las pruebas unitarias deben pasar todas: comisiones de líder y vendedor, prepagos, renovaciones, fechas y validaciones.
4. Copia `.env.example` a `.env` y llénalo con las llaves de prueba. En `.env` pon `SITE_URL=http://localhost:8888`.
5. Ten listos en Stripe (modo prueba) el producto, los 3 precios y los 3 Payment Links (README §3), y pega los links en `membresias.html`.
6. En la pestaña `Vendedores` deben existir:

   | Código | Nombre | Líder | Activo |
   |---|---|---|---|
   | PAULO | Paulo | PAULO | sí |
   | V012 | Vendedor prueba | PAULO | sí |

7. Levanta el sitio y las funciones (terminal 1):
   ```bash
   netlify dev
   ```
8. Reenvía los eventos de Stripe a tu máquina (terminal 2):
   ```bash
   stripe listen --forward-to localhost:8888/api/stripe-webhook --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,invoice.paid,invoice.payment_failed,customer.subscription.deleted,charge.refunded
   ```
   Copia el `whsec_…` que imprime a `STRIPE_WEBHOOK_SECRET` en `.env` y reinicia `netlify dev`.

En la terminal de `stripe listen` cada evento debe mostrar `[200]`. En la de `netlify dev` aparece el log `[webhook] … →` con el resultado.

---

## P0. Humo con `stripe trigger` (sin datos reales de membresía)

```bash
stripe trigger checkout.session.completed
```
```bash
stripe trigger invoice.payment_failed
```
```bash
stripe trigger customer.subscription.deleted
```
**Esperado:** `[200]` en todos. El log dice "no es de Salud Digital: ignorada" o "Sin alta registrada". La hoja no cambia. Así se confirma que la firma funciona y que los eventos de otros productos no ensucian la hoja.

Firma inválida:
```bash
curl.exe -s -X POST http://localhost:8888/api/stripe-webhook -d "{}"
```
**Esperado:** `400 Firma inválida`.

## P1. Alta mensual + comisión de cierre (vendedor y líder)

1. Abre `http://localhost:8888/membresias.html?e=cosmopolitana&v=V012`, deja "Mensual" y da clic en **Contratar Salud Digital**.
2. Paga con la tarjeta `4242 4242 4242 4242`, fecha futura, CVC `123`. Llena nombre, apellidos, celular y un correo tuyo.

**Esperado:**
- `Movimientos`: 1 fila **Alta**, modalidad `mensual`, grupo `DASH Individual – cosmopolitana`, vendedor `V012`, `enviado_a_EverHealth = no`, Estado `activo`, Referencia `sub_…`.
- `Cobros`: 1 fila `cierre` por $636.84, forma de pago `04`.
- `Comisiones`: **V012 $120** (vendedor) y **PAULO $29** (líder).
- Correo de bienvenida con el texto de 48 h y el (55) 8120-2122.
- En Stripe la suscripción tiene metadata `empresa=cosmopolitana`, `vendedor=V012`.

## P2. Comisión cuando vende el líder

Repite P1 con `?e=hipick&v=PAULO` (otro correo). **Esperado:** en `Comisiones` una sola fila: **PAULO $149**.
Repite sin parámetros (`membresias.html`): grupo `DASH Individual – web`, vendedor `directo`, cobro registrado y **sin** comisiones.

## P3. Cobro mensual (residual) con reloj de prueba

Los relojes de prueba (*test clocks*) adelantan el tiempo de un cliente. Sustituye `price_MENSUAL` por tu `STRIPE_PRICE_MENSUAL`.

```powershell
$ahora = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
stripe test_helpers test_clocks create -d frozen_time=$ahora -d name="P3 mensual"
# → copia el id clock_…
stripe customers create -d email="tu-correo+p3@ejemplo.com" -d name="Ana Prueba Uno" -d test_clock=clock_XXX
# → copia el id cus_…
stripe checkout sessions create -d mode=subscription -d customer=cus_XXX -d "line_items[0][price]=price_MENSUAL" -d "line_items[0][quantity]=1" -d client_reference_id=cosmopolitana__V012 -d success_url=http://localhost:8888/gracias-membresia.html
# → abre la "url" que devuelve y paga con 4242 4242 4242 4242
```
Verifica el Alta y el cierre (como en P1). Luego adelanta un mes:
```powershell
$mes = [DateTimeOffset]::UtcNow.AddDays(32).ToUnixTimeSeconds()
stripe test_helpers test_clocks advance clock_XXX -d frozen_time=$mes
```
**Esperado:** `invoice.paid` con `billing_reason=subscription_cycle` → `Cobros` fila `mensual` $636.84 → `Comisiones`: **V012 $30** y **PAULO $20**. No hay Alta nueva.

## P4. Pago fallido → baja cuando ya no hay reintentos

Con el cliente de P3 (configura antes los reintentos con "cancelar suscripción" al final, README §3.3):
```powershell
stripe payment_methods attach pm_card_chargeCustomerFail --customer=cus_XXX
# → copia el id pm_…
stripe subscriptions update sub_XXX -d default_payment_method=pm_XXX
$mes2 = [DateTimeOffset]::UtcNow.AddDays(63).ToUnixTimeSeconds()
stripe test_helpers test_clocks advance clock_XXX -d frozen_time=$mes2
```
**Esperado (1er fallo):** `invoice.payment_failed` → log "Stripe reintentará el …". **No** hay baja ni comisión.

Adelanta más allá del último reintento (por ejemplo, +3 semanas):
```powershell
$fin = [DateTimeOffset]::UtcNow.AddDays(85).ToUnixTimeSeconds()
stripe test_helpers test_clocks advance clock_XXX -d frozen_time=$fin
```
**Esperado:** el último `invoice.payment_failed` (sin `next_payment_attempt`) registra **Baja** ("Pago fallido sin más reintentos"). El `customer.subscription.deleted` posterior responde "Ya estaba dada de baja", sin fila duplicada. La Alta queda en Estado `baja`. Como hubo 2 cobros, llega la alerta **"Cancelación antes del plazo mínimo"** y la nota en la Alta.

## P5. Cancelación

Con la suscripción de P1 (`sub_…` en `Movimientos`):
```bash
stripe subscriptions cancel sub_XXX
```
**Esperado:** `customer.subscription.deleted` → **Baja** "Cancelación solicitada por el cliente" (o "Suscripción cancelada"), `enviado_a_EverHealth = no`, `vigente_hasta` = hoy, Alta en `baja` y alerta de mínimo de 3 meses (1 cobro).
Opcional: prueba el portal desde `mi-cuenta.html` (con el enlace de prueba pegado): la cancelación al fin de periodo llega como `customer.subscription.deleted` cuando termina el periodo; adelántalo con un reloj de prueba.

## P6. Prepago OXXO

1. `http://localhost:8888/membresias.html?e=cosmopolitana&v=V012` → "Paga 3 meses en OXXO o transferencia".
2. Elige **OXXO** y usa un correo que termine en `succeed_immediately@ejemplo.com` (por ejemplo, `tu-correo+succeed_immediately@ejemplo.com`): en modo prueba el voucher se paga solo en unos segundos.

**Esperado:**
- `checkout.session.completed` con `payment_status=unpaid` → log "Pago pendiente (OXXO/SPEI)". **Sin filas.**
- `checkout.session.async_payment_succeeded` → **Alta** `trimestral` con `vigente_hasta` = hoy + 3 meses − 1 día (ej. 2026-11-13 → 2027-02-12). Bienvenida con la fecha de vigencia y el ID de pago `pi_…`.
- `Cobros`: `prepago` $1,910.52, forma de pago `01`.
- `Comisiones` (supuesto 1 cierre + 2 mensuales): **V012 $180** (120 + 2×30) y **PAULO $69** (29 + 2×20).

Variantes:
- Correo con `expire_immediately@…` → `async_payment_failed`, sin alta.
- SPEI: elige transferencia y luego, en el Dashboard de prueba, en el cliente usa **"Enviar fondos"** (o `stripe test_helpers customers fund_cash_balance cus_XXX -d amount=191052 -d currency=mxn`).
- Anual con `?v=PAULO`: **PAULO $699** (149 + 11×50).

## P7. Aviso de renovación y vencimiento del prepago

Con el prepago de P6 (`vigente_hasta` = 2027-02-12, por ejemplo):

1. En `.env` pon `HOY_SIMULADO=2027-02-03` (9 días antes), reinicia `netlify dev` y corre la tarea:
   ```bash
   netlify functions:invoke tarea-diaria
   ```
   **Esperado:** correo "Tu membresía DASH MEDIC CARE vence el 2027-02-12" con botón al Payment Link trimestral (correo y `client_reference_id` ya llenados). Columna **Aviso renovación** = 2027-02-03. Si la corres otra vez, no se repite.
2. `HOY_SIMULADO=2027-02-13` → corre la tarea. **Esperado:** **Baja** "Prepago vencido el 2027-02-12 sin renovación", Alta en `baja`, y la baja sale en el lote de ese mismo día.

## P8. Renovación de prepago (no debe darse de baja)

Antes del paso 7.2, paga de nuevo el link trimestral **con el mismo correo**. **Esperado:**
- No hay Alta nueva. La Alta existente cambia `vigente_hasta` a 2027-05-12 y en Notas dice "Renovó trimestral…". Aviso renovación se limpia.
- Correo "Renovamos tu membresía".
- `Cobros`: `renovacion`. `Comisiones` (supuesto, todo mensual): **V012 $90**, **PAULO $60**.
- Con `HOY_SIMULADO=2027-02-13` la tarea ya **no** da de baja.

## P9. Reembolso

```bash
stripe refunds create --payment-intent=pi_XXX
```
(usa el `pi_…` del prepago de P6). **Esperado:** `Cobros` → Monto reembolsado $1,910.52. `Comisiones` → filas `reverso` de **−$180** (V012) y **−$69** (PAULO). Alerta "Reembolso registrado". Un reembolso parcial (`--amount=95526`) revierte el 50%; si se reembolsa el resto, se revierte sólo lo que falta.

## P10. Lote diario a Ever Health

Con filas `enviado_a_EverHealth = no` (de las pruebas anteriores):
```bash
netlify functions:invoke tarea-diaria
```
**Esperado:** a `EVERHEALTH_EMAIL` (tu correo) llega "lote de altas y bajas" con `DASH_altas_bajas_AAAA-MM-DD.csv`. El CSV abre en Excel con acentos correctos; columnas Fecha, Movimiento, Nombre, Apellidos, Correo, Celular, Plan Ever Health (Basic), Membresía (Salud Digital), Modalidad, Grupo, vigente_hasta. En la hoja, esas filas quedan en `sí` con fecha de envío. Si la corres otra vez sin filas nuevas, no se envía nada.

## P11. Alerta de la bolsa de 450

Cuenta las Altas activas en `Movimientos` (por ejemplo, 3). En `.env` pon `CORPORATIVOS_ACTIVOS=448`, reinicia y corre la tarea.
**Esperado:** 448 + 3 = 451 > 450 → correo a `ADMIN_EMAIL` "Bolsa Basic en 451 afiliados (tope 450)". El log muestra `bolsaBasic: {… alerta: true}`. Regresa la variable a `201` → sin alerta.

## P12. Idempotencia y reintentos

1. Reenvía un evento ya procesado:
   ```bash
   stripe events resend evt_XXX
   ```
   **Esperado:** `[200]` con `duplicado: true`. La hoja no cambia.
2. Falla de Sheets: cambia `SHEET_ID` en `.env` por uno inválido, reinicia y repite P1 con otro correo. **Esperado:** `[500]` en `stripe listen` y el error en el log. Corrige `SHEET_ID`, reinicia y reenvía el evento (`stripe events resend evt_XXX`). **Esperado:** `[200]` y un solo registro, sin duplicados.
3. Falla de correo: pon una `RESEND_API_KEY` inválida. **Esperado:** `[500]`. Al corregir y reenviar, la fila de Alta no se duplica y el correo sale una vez.

## P13. Facturación (apagada)

1. Abre `http://localhost:8888/facturacion.html` y captura el `pi_…` de P6, su correo y un RFC de prueba (ej. `EKU9003173C9`, CP `42501`, régimen 601).
   **Esperado:** "Recibimos tu solicitud…", fila **pendiente** en `Facturacion` y alerta a administración.
2. Con otro correo o un ID inexistente → mensaje "No encontramos un pago…".
3. *(Opcional, cuando el contador lo valide)* `FACTURACION_ACTIVA=true` con `FACTURAPI_KEY` de prueba → se emite el CFDI de prueba y se envía al correo.

## P14. En Netlify (después del deploy)

1. Registra el endpoint de prueba en Stripe (README §3.5) con la URL de producción y su `whsec_…`.
2. Repite P1 y P6 desde el sitio publicado.
3. Netlify → Functions → `tarea-diaria` → **Run now** y revisa el log.
4. Revisa al día siguiente a las 18:00 que la tarea corrió sola.

Cuando todo pase: cambia las llaves y los Price IDs a **modo real**, crea el webhook real, apunta `SHEET_ID` a la hoja de producción y quita `HOY_SIMULADO`.
