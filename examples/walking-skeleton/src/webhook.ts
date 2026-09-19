import Stripe from 'stripe';
import { db } from './db';

// Internal Phase 2 execution specimen, not a real-world evaluation repository.
const stripe = new Stripe('sk_test_phase2_placeholder');
interface Request { body: Buffer; headers: Record<string, string> }
interface Response { status(code: number): Response; json(body: unknown): Response }
interface LegacySubscription { id: string; current_period_end?: number }

export async function handler(req: Request, res: Response): Promise<Response> {
  const event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature']!, 'whsec_placeholder');
  // Explicit compatibility type: this specimen intentionally reads the old contract.
  const subscription = event.data.object as unknown as LegacySubscription;
  await db.subscription.update({
    where: { id: subscription.id },
    data: { renewalDate: subscription.current_period_end },
  });
  return res.status(200).json({ received: true });
}
