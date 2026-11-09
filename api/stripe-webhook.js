const Stripe = require('stripe');
const { getDb } = require('./_utils');
const { sendOrderEmails, afterPaid } = require('./_shop');
const { releaseForOrder } = require('./_vouchers');

// Stripe podpis se ověřuje nad RAW tělem — vypnout automatický parser.
export const config = { api: { bodyParser: false } };

const MAX_BODY = 512 * 1024;

function rawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('Body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Označí objednávku jako zaplacenou — jen když sedí částka i měna. Idempotentní.
async function markPaid(session) {
  const number = session.metadata?.orderNumber || session.client_reference_id;
  if (!number || !/^\d{10}$/.test(number)) {
    console.error('Webhook: session bez čísla objednávky', session.id);
    return;
  }
  const db = getDb();
  const ref = db.collection('orders').doc(number);

  const result = await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { state: 'missing' };
    const order = snap.data();
    if (order.status === 'paid') return { state: 'already' };
    if (order.stripeSessionId && order.stripeSessionId !== session.id) return { state: 'session_mismatch' };
    if (session.currency !== 'czk' || session.amount_total !== order.total * 100) {
      tx.update(ref, { status: 'amount_mismatch', stripeAmount: session.amount_total, updatedAt: new Date() });
      return { state: 'amount_mismatch' };
    }
    tx.update(ref, {
      status: 'paid',
      paidAt: new Date(),
      stripePaymentIntent: typeof session.payment_intent === 'string' ? session.payment_intent : '',
    });
    return { state: 'paid', order: { ...order, number } };
  });

  if (result.state !== 'paid') {
    if (result.state !== 'already') console.error('Webhook: objednávka', number, result.state);
    return;
  }
  const sent = await sendOrderEmails(result.order);
  await ref.update({ emailsSent: sent });
  await afterPaid(number);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !process.env.STRIPE_SECRET_KEY) {
    console.error('Stripe webhook není nakonfigurován');
    return res.status(500).end();
  }
  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

  let event;
  try {
    const buf = await rawBody(req);
    // constructEvent ověří podpis i stáří (tolerance 5 min = ochrana proti replay)
    event = stripe.webhooks.constructEvent(buf, req.headers['stripe-signature'], secret);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).end();
  }

  try {
    const session = event.data.object;
    switch (event.type) {
      case 'checkout.session.completed':
        if (session.payment_status === 'paid') await markPaid(session);
        break;
      case 'checkout.session.async_payment_succeeded':
        await markPaid(session);
        break;
      case 'checkout.session.expired':
      case 'checkout.session.async_payment_failed': {
        const number = session.metadata?.orderNumber;
        if (number && /^\d{10}$/.test(number)) {
          const ref = getDb().collection('orders').doc(number);
          const changed = await getDb().runTransaction(async tx => {
            const snap = await tx.get(ref);
            if (snap.exists && snap.data().status === 'awaiting_payment') {
              tx.update(ref, { status: event.type.endsWith('expired') ? 'expired' : 'payment_failed', updatedAt: new Date() });
              return true;
            }
            return false;
          });
          // nezaplaceno → stržený poukaz se vrací zpět
          if (changed) await releaseForOrder(number);
        }
        break;
      }
    }
    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook processing error:', err.message);
    res.status(500).end(); // Stripe to zkusí znovu
  }
}
