import { WalletService } from "../services/wallet_service";

async function testWalletService() {
  const walletService = new WalletService();

  // Create a new wallet
  try {
    const wallet = walletService.createWallet();
    console.log("New Wallet Address:", wallet.address);
    console.log("New Wallet Private Key:", wallet.privateKey);
    console.log("New Wallet Public Key:", wallet.publicKey);

    // Use an existing recipient address
    const recipientAddress = "1G6zLwzvQWYgsjnCA2xRpJ6JmptbgyAasEvRjRYK763YB";
    const amountToSend = "1000000000000000000";

    // Send a transaction
    const transactionHash = await walletService.sendTransaction(wallet, recipientAddress, amountToSend);
    console.log("Transaction Successful. Hash:", transactionHash);
  } catch (error) {
    console.error("Transaction failed:", error instanceof Error ? error.message : error);
  }
}

testWalletService();
