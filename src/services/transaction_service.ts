export class TransactionService {
  async fetchTransaction(transactionId: string): Promise<any> {
    const response = await fetch(
      `https://node.testnet.alephium.org/transactions/${transactionId}`
    );

    if (!response.ok) {
      throw new Error(
        `Failed to fetch transaction: ${await response.text()}`
      );
    }

    return response.json();
  }
}
