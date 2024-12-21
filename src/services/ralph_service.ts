export class RalphService {
  async executeSmartContract(
    contractAddress: string,
    functionName: string,
    parameters: any
  ): Promise<any> {
    const payload = {
      contractAddress,
      functionName,
      parameters,
    };

    const response = await fetch(
      "https://node.testnet.alephium.org/contracts/call",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      throw new Error(
        `Failed to execute smart contract: ${await response.text()}`
      );
    }

    return response.json();
  }
}
