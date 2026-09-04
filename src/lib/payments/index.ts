import { paymentsLive } from '../env';
import { PayMongoGateway } from './paymongo';
import { SandboxGateway } from './sandbox';
import type { PaymentGateway } from './types';

let cached: PaymentGateway | null = null;

/** The active gateway: PayMongo when credentials exist, the sandbox otherwise. */
export function gateway(): PaymentGateway {
  if (!cached) cached = paymentsLive() ? new PayMongoGateway() : new SandboxGateway();
  return cached;
}

export * from './types';
export { signSandbox } from './sandbox';
