import { ec as EC } from "elliptic";

const ec = new EC("secp256k1");

export function derivePublicKey(privateKey: string): string {
  const keyPair = ec.keyFromPrivate(privateKey);
  return keyPair.getPublic().encode("hex", false);
}
