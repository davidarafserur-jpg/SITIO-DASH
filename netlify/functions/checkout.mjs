// Pago de Salud Digital desde la página → https://<tu-sitio>/api/checkout
// - Lista pública con familiares: titular + N familiares ($549 + $275 c/u, + IVA).
// - Empresa con precio especial (lib/empresas.mjs, p. ej. ?e=cosmopolitana): el paquete que alcance
//   para titular + familiares (Individual, Dúo, Familiar, Extendido) y, si aplica, el cupón Fundadores.
// Sin familiares y sin empresa especial, la página sigue usando los Payment Links de siempre.
// El precio SIEMPRE se decide aquí (no se confía en lo que muestra la página).
import { opcional, requerida, urlSitio } from '../../lib/config.mjs';
import { empresaConPrecio, paqueteParaPersonas } from '../../lib/empresas.mjs';
import { MAX_FAMILIARES, familiaresAMetadata, validarFamiliares } from '../../lib/familia.mjs';
import { atribucionDeReferencia, precioEmpresa, precioFamiliar, stripe } from '../../lib/stripe.mjs';

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

  const ref = String(datos?.ref || '').slice(0, 120);
  const { empresa, vendedor } = atribucionDeReferencia(ref);
  const especial = empresaConPrecio(empresa);
  if (!especial && !familiares.length) return json(400, { error: 'Agrega al menos un familiar.' });

  let lineas; let paquete = null; let cupon = '';
  try {
    if (especial) {
      paquete = paqueteParaPersonas(especial, familiares.length + 1);
      if (!paquete) return json(400, { error: `El paquete más grande es para ${especial.paquetes.at(-1).personas} personas.` });
      lineas = [{ price: await precioEmpresa(empresa, paquete.clave, modalidad), quantity: 1 }];
      if (modalidad === 'mensual' && especial.fundadores?.activo && !opcional('FUNDADORES_APAGADO')) cupon = especial.fundadores.cupon;
    } else {
      if (familiares.length > MAX_FAMILIARES) return json(400, { error: `Puedes sumar hasta ${MAX_FAMILIARES} familiares.` });
      lineas = [
        { price: requerida(modalidad === 'anual' ? 'STRIPE_PRICE_ANUAL' : 'STRIPE_PRICE_MENSUAL'), quantity: 1 },
        { price: await precioFamiliar(modalidad), quantity: familiares.length },
      ];
    }
  } catch (e) {
    console.error('[checkout] Configuración incompleta:', e.message);
    return json(500, { error: 'La contratación no está disponible por el momento. Escríbenos al (55) 8120-2122.' });
  }

  const sitio = urlSitio() || new URL(req.url).origin;
  const etiqueta = paquete ? `${empresa}_${paquete.clave}` : 'salud_digital_familiar';
  const metadata = { ...familiaresAMetadata(familiares), empresa, vendedor, paquete: etiqueta };

  const sesion = {
    line_items: lineas,
    client_reference_id: `${empresa}__${vendedor}`,
    custom_fields: CAMPOS,
    phone_number_collection: { enabled: true },
    locale: 'es',
    metadata,
    success_url: `${sitio}/gracias-membresia.html?familia=${familiares.length}`,
    cancel_url: `${sitio}/membresias.html?e=${encodeURIComponent(empresa)}&v=${encodeURIComponent(vendedor)}#planes`,
  };
  if (cupon) sesion.discounts = [{ coupon: cupon }];
  if (modalidad === 'mensual') {
    sesion.mode = 'subscription';
    sesion.payment_method_types = ['card'];
    sesion.subscription_data = { metadata: { empresa, vendedor, paquete: etiqueta, familiares: String(familiares.length) } };
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
