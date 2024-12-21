import fetch from 'node-fetch';

export class TransactionService {
  async buildTransaction(payload: any): Promise<any> {
    const response = await fetch('https://node.testnet.alephium.org/transactions/build', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Failed to build transaction: ${await response.text()}`);
    }

    return response.json();
  }

  async sendTransaction(signedTransaction: string): Promise<any> {
    const response = await fetch('https://node.testnet.alephium.org/transactions/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signedTransaction }),
    });

    if (!response.ok) {
      throw new Error(`Failed to send transaction: ${await response.text()}`);
    }

    return response.json();
  }
}
