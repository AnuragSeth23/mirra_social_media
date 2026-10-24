import { hash, verify } from '@node-rs/argon2';

// OWASP-recommended argon2id parameters (19 MiB, 2 iterations, 1 lane). Algorithm 2 = argon2id.
const OPTIONS = { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export const hashPassword = (password) => hash(password, OPTIONS);

export async function verifyPassword(stored, password) {
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}

// Used when no account matches, so a failed sign-in takes the same time either way
// and response timing doesn't reveal which accounts exist.
let dummyHash = null;
export async function burnPasswordCheck(password) {
  dummyHash ??= hashPassword('socialambak-timing-equaliser');
  await verifyPassword(await dummyHash, password);
}
