'use strict';

const { StripeWebhookEvent } = require('../models');
const { getStripe } = require('./stripe.client');
const env = require('../config/env');
const HttpError = require('../utils/httpError');
const {
  syncSubscriptionFromStripe,
  syncInvoiceFromStripe,
  syncCustomerFromStripe,
} = require('./stripe-sync.service');

const HANDLED_TYPES = new Set([
  'customer.created',
  'customer.updated',
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.trial_will_end',
  'invoice.created',
  'invoice.updated',
  'invoice.finalized',
  'invoice.paid',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
  'invoice.voided',
  'invoiceitem.created',
]);

function constructEvent(rawBody, signature) {
  const stripe = getStripe();
  if (!env.stripeWebhookSecret) {
    // Local/dev fallback: parse without verification when secret missing.
    // Production must set STRIPE_WEBHOOK_SECRET.
    if (env.nodeEnv === 'production') {
      throw new HttpError(500, 'STRIPE_WEBHOOK_SECRET is required');
    }
    const payload = typeof rawBody === 'string' ? JSON.parse(rawBody) : JSON.parse(rawBody.toString('utf8'));
    return payload;
  }
  return stripe.webhooks.constructEvent(rawBody, signature, env.stripeWebhookSecret);
}

async function markEvent(stripeEventId, type, livemode, status, errorMessage = '') {
  try {
    await StripeWebhookEvent.create({
      stripeEventId,
      type,
      livemode: Boolean(livemode),
      status,
      errorMessage: errorMessage || '',
      processedAt: new Date(),
    });
    return true;
  } catch (error) {
    if (error?.code === 11000) {
      return false; // duplicate — already processed
    }
    throw error;
  }
}

async function handleStripeEvent(event) {
  const claimed = await markEvent(event.id, event.type, event.livemode, 'processed');
  if (!claimed) {
    return { duplicate: true, type: event.type };
  }

  if (!HANDLED_TYPES.has(event.type)) {
    await StripeWebhookEvent.findOneAndUpdate(
      { stripeEventId: event.id },
      { status: 'ignored' }
    );
    return { ignored: true, type: event.type };
  }

  try {
    const stripe = getStripe();
    const object = event.data.object;

    switch (event.type) {
      case 'customer.created':
      case 'customer.updated':
        await syncCustomerFromStripe(object);
        break;

      case 'checkout.session.completed': {
        if (object.mode === 'subscription' && object.subscription) {
          const subId =
            typeof object.subscription === 'string' ? object.subscription : object.subscription.id;
          const stripeSub = await stripe.subscriptions.retrieve(subId, {
            expand: ['items.data.price', 'default_payment_method', 'latest_invoice'],
          });
          // Carry checkout metadata onto subscription if missing
          if ((!stripeSub.metadata || !stripeSub.metadata.companyId) && object.metadata) {
            await stripe.subscriptions.update(subId, {
              metadata: {
                ...(stripeSub.metadata || {}),
                ...object.metadata,
              },
            });
            const refreshed = await stripe.subscriptions.retrieve(subId, {
              expand: ['items.data.price', 'default_payment_method', 'latest_invoice'],
            });
            await syncSubscriptionFromStripe(refreshed);
            const latest = refreshed.latest_invoice;
            if (latest) {
              const invoiceObj =
                typeof latest === 'string' ? await stripe.invoices.retrieve(latest) : latest;
              await syncInvoiceFromStripe(invoiceObj);
            }
          } else {
            await syncSubscriptionFromStripe(stripeSub);
            const latest = stripeSub.latest_invoice;
            if (latest) {
              const invoiceObj =
                typeof latest === 'string' ? await stripe.invoices.retrieve(latest) : latest;
              await syncInvoiceFromStripe(invoiceObj);
            }
          }
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
      case 'customer.subscription.trial_will_end': {
        const stripeSub = await stripe.subscriptions.retrieve(object.id, {
          expand: ['items.data.price', 'default_payment_method'],
        });
        await syncSubscriptionFromStripe(stripeSub);
        break;
      }

      case 'invoice.created':
      case 'invoice.updated':
      case 'invoice.finalized':
      case 'invoice.paid':
      case 'invoice.payment_succeeded':
      case 'invoice.payment_failed':
      case 'invoice.voided': {
        await syncInvoiceFromStripe(object);
        // Keep subscription status in sync after payment outcomes / renewals
        if (object.subscription) {
          const subId =
            typeof object.subscription === 'string' ? object.subscription : object.subscription.id;
          const stripeSub = await stripe.subscriptions.retrieve(subId, {
            expand: ['items.data.price', 'default_payment_method'],
          });
          await syncSubscriptionFromStripe(stripeSub);
        }
        break;
      }

      case 'invoiceitem.created':
        // Renewal line items arrive before the invoice is finalized; no DB write needed.
        break;

      default:
        break;
    }

    return { ok: true, type: event.type };
  } catch (error) {
    await StripeWebhookEvent.findOneAndUpdate(
      { stripeEventId: event.id },
      {
        status: 'failed',
        errorMessage: error.message || 'Webhook handler failed',
      }
    );
    throw error;
  }
}

module.exports = {
  constructEvent,
  handleStripeEvent,
  HANDLED_TYPES,
};
