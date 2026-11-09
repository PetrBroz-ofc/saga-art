const Stripe = require('stripe');
const { releaseForOrder } = require('./_vouchers');
const { getDb, SITE_URL, noStore, clientIp, fail, guard, limitOrReject } = require('./_utils');
const {
  SHIPPING, PAYMENTS, GIFT_WRAP, clean, validateCustomer, priceCart, createOrder, sendOrderEmails, bankInfo, afterPaid,
} = require('./_shop');

// POST /api/order — vytvoří objednávku. Ceny, doprava, balení, sleva z poukazu i číslo objednávky
// určuje VÝHRADNĚ server.
export default async function handler(req, res) {
  noStore(res);
  if (!guard(req, res, ['POST'])) return;

  // max. 5 objednávek / 10 min z jedné IP (proti spamu a zahlcení)
  if (!(await limitOrReject(res, 'order_ip', clientIp(req), 5, 10 * 60 * 1000))) return;

  const { items, shipping, payment, customer, website, giftWrap, giftMessage, voucherCode } = req.body;

  // Honeypot — skryté pole, které vyplní jen bot. Tváříme se, že je vše OK.
  if (website) return res.status(200).json({ ok: true });

  if (payment !== 'card' && payment !== 'transfer') return fail(res, 400, 'Neplatný způsob platby');
  const cust = validateCustomer(customer, shipping);
  if (cust.error) return fail(res, 400, cust.error);
  if (voucherCode !== undefined && voucherCode !== '' && typeof voucherCode !== 'string') return fail(res, 400, 'Neplatný kód poukazu');
  // kód poukazu zkouší útočník hádat → přísnější limit, jen když je vyplněný
  if (voucherCode && !(await limitOrReject(res, 'voucher_ip', clientIp(req), 10, 15 * 60 * 1000))) return;

  let number = '';
  try {
    const cart = await priceCart(items);
    if (cart.error) return fail(res, 400, cart.error);

    // samotné poukazy jdou jen e-mailem, šperky jen přes dopravce
    const ship = SHIPPING[shipping];
    if (cart.onlyVouchers !== !!ship.voucherOnly) {
      return fail(res, 400, cart.onlyVouchers ? 'Dárkový poukaz posílám e-mailem, zvolte prosím tuto možnost.' : 'Zvolte prosím dopravu pro šperky.');
    }

    const wrap = giftWrap === true && !cart.onlyVouchers;
    const wrapPrice = wrap ? GIFT_WRAP.price : 0;
    const message = wrap ? clean(giftMessage, 200, true) : '';
    const shippingPrice = ship.price;
    const total = cart.subtotal + shippingPrice + wrapPrice;

    const order = {
      status: payment === 'card' ? 'awaiting_payment' : 'awaiting_transfer',
      payment, shipping, shippingPrice,
      customer: cust.data,
      lines: cart.lines,
      subtotal: cart.subtotal,
      giftWrap: wrap, giftWrapPrice: wrapPrice, giftMessage: message,
      discount: 0,
      total,
      emailsSent: false,
    };
    // poukazem jde platit šperky, dopravu a balení, ne další poukazy
    const created = await createOrder(order, voucherCode ? voucherCode : '', cart.goods + shippingPrice + wrapPrice);
    if (created.error) return fail(res, 400, created.error);
    number = created.number;
    Object.assign(order, created.order);

    // ── Celé zaplaceno poukazem ──
    if (order.status === 'paid') {
      const sent = await sendOrderEmails(order);
      await getDb().collection('orders').doc(number).update({ emailsSent: sent });
      await afterPaid(number);
      return res.status(200).json({ orderNumber: number, total: 0, paidByVoucher: true });
    }

    // ── Bankovní převod: potvrzení e-mailem hned ──
    if (payment === 'transfer') {
      const sent = await sendOrderEmails(order);
      await getDb().collection('orders').doc(number).update({ emailsSent: sent });
      return res.status(200).json({ orderNumber: number, total: order.total, bank: bankInfo() });
    }

    // ── Karta: Stripe Checkout. E-maily pošle až webhook po ověřené platbě. ──
    // Se slevou z poukazu jde do Stripe jedna souhrnná položka (Stripe nemá záporné řádky).
    const lineItems = order.discount
      ? [{ price_data: { currency: 'czk', product_data: { name: `Objednávka ${number} (po odečtení poukazu)` }, unit_amount: order.total * 100 }, quantity: 1 }]
      : [
          ...cart.lines.map(l => ({
            price_data: { currency: 'czk', product_data: { name: l.name }, unit_amount: l.price * 100 },
            quantity: l.qty,
          })),
          ...(shippingPrice ? [{ price_data: { currency: 'czk', product_data: { name: 'Doprava: ' + ship.name }, unit_amount: shippingPrice * 100 }, quantity: 1 }] : []),
          ...(wrapPrice ? [{ price_data: { currency: 'czk', product_data: { name: GIFT_WRAP.name }, unit_amount: wrapPrice * 100 }, quantity: 1 }] : []),
        ];

    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      locale: 'cs',
      customer_email: cust.data.email,
      client_reference_id: number,
      metadata: { orderNumber: number },
      payment_intent_data: { metadata: { orderNumber: number } },
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      line_items: lineItems,
      success_url: `${SITE_URL}/?order=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/?order=cancel`,
    }, { idempotencyKey: 'order-' + number });

    await getDb().collection('orders').doc(number).update({ stripeSessionId: session.id });
    return res.status(200).json({ url: session.url });

  } catch (err) {
    console.error('order error:', err.message);
    // platbu nejde založit → objednávku zrušit a vrátit případně stržený poukaz
    if (number) {
      await getDb().collection('orders').doc(number).update({ status: 'cancelled', cancelledAt: new Date(), cancelReason: 'payment_init_failed' }).catch(() => {});
      await releaseForOrder(number).catch(e => console.error('release voucher:', e.message));
    }
    return fail(res, 500, 'Objednávku se nepodařilo vytvořit. Zkuste to prosím znovu.');
  }
}
