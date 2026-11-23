// Salud Digital familiar → https://<tu-sitio>/api/checkout
// La página manda la modalidad (mensual/anual), los familiares y el client_reference_id;
// aquí se crea la sesión de pago de Stripe (titular + N familiares) y se devuelve su URL.
// Sin familiares, la página sigue usando los Payment Links de siempre.
import { opcional, requerida, urlSitio } from '../../lib/config.mjs';
import { familiaresAMetadata, validarFamiliares } from '../../lib/familia.mjs';
import { atribucionDeReferencia, precioFamiliar, stripe } from '../../lib/stripe.mjs';

const json = (status, cuerpo) => new Response(JSON.stringify(cuerpo), {
  status, headers: { 'Content-Type': 'application/json' },
});

const CAMPOS = [
  { key: 'nombre', label: { type: 'custom', custom: 'Nombre(s) del titular' }, type: 'text' },
  { key: 'apellidopaterno', label: { type: 'custom', custom: 'Apellido paterno' }, type: 'text' },
  { key: 'apellidomaterno', label: { type: 'custom', custom: 'Apellido materno' }, type: 'text', optional: true },
];

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Método no permitido' });
  let datos;
  try { datos = await req.json(); } catch { return json(400, { error: 'Solicitud inválida.' }); }

  const modalidad = datos?.modalidad === 'anual' ? 'anual' : 'mensual';
  const { familiares, error } = validarFamiliares(datos?.familiares || []);
  if (error) return json(400, { error });
  if (!familiares.length) return json(400, { error: 'Agrega al menos un familiar.' });

  let precioTitular; let precioDeFamiliar;
  try {
    precioTitular = requerida(modalidad === 'anual' ? 'STRIPE_PRICE_ANUAL' : 'STRIPE_PRICE_MENSUAL');
    precioDeFamiliar = await precioFamiliar(modalidad);
  } catch (e) {
    console.error('[checkout] Configuración incompleta:', e.message);
    return json(500, { error: 'La contratación familiar no está disponible por el momento.' });
  }

  const ref = String(datos?.ref || '').slice(0, 120);
  const { empresa, vendedor } = atribucionDeReferencia(ref);
  const sitio = urlSitio() || new URL(req.url).origin;
  const metadata = { ...familiaresAMetadata(familiares), empresa, vendedor, paquete: 'salud_digital_familiar' };

  const sesion = {
    line_items: [
      { price: precioTitular, quantity: 1 },
      { price: precioDeFamiliar, quantity: familiares.length },
    ],
    client_reference_id: `${empresa}__${vendedor}`,
    custom_fields: CAMPOS,
    phone_number_collection: { enabled: true },
    locale: 'es',
    metadata,
    success_url: `${sitio}/gracias-membresia.html?familia=${familiares.length}`,
    cancel_url: `${sitio}/membresias.html#planes`,
  };
  if (modalidad === 'mensual') {
    sesion.mode = 'subscription';
    sesion.payment_method_types = ['card'];
    sesion.subscription_data = { metadata: { empresa, vendedor, paquete: 'salud_digital_familiar', familiares: String(familiares.length) } };
  } else {
    sesion.mode = 'payment';
    sesion.customer_creation = 'always';
    sesion.payment_method_types = opcional('CHECKOUT_SIN_OXXO') ? ['card'] : ['card', 'oxxo'];
  }

  try {
    const s = await stripe().checkout.sessions.create(sesion);
    return json(200, { url: s.url });
  } catch (e) {
    console.error('[checkout] Stripe:', e.message);
    return json(502, { error: 'No pudimos abrir el pago. Intenta de nuevo en unos minutos.' });
  }
};

export const config = { path: '/api/checkout' };
