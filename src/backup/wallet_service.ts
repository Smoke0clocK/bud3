import * as crypto from 'crypto';

export class WalletService {
  private wallets: Map<string, string> = new Map();

  createWallet(): { address: string; privateKey: string } {
    const privateKey = crypto.randomBytes(32).toString('hex');
    const address = crypto.createHash('sha256').update(privateKey).digest('hex').slice(0, 40);
    this.wallets.set(address, privateKey);
    return { address, privateKey };
  }

  getPrivateKey(address: string): string | undefined {
    return this.wallets.get(address);
  }
}
