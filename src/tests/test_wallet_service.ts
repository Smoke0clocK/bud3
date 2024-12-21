import { WalletService } from "./wallet_service";

async function testWalletService() {
    const walletService = new WalletService();

    // Create a new wallet
    const wallet = walletService.createWallet();
    console.log("New Wallet Address:", wallet.address);
    console.log("New Wallet Private Key:", wallet.privateKey);
    console.log("New Wallet Public Key:", wallet.publicKey);

    // Use an existing recipient address
    const recipientAddress = "1G6zLwzvQWYgsjnCA2xRpJ6JmptbgyAasEvRjRYK763YB"; // Replace with a valid recipient
    const amountToSend = "1000000000000000000"; // 1 ALPH in atto ALPH

    try {
        const transactionHash = await walletService.sendTransaction(wallet, recipientAddress, amountToSend);
        console.log("Transaction Successful. Hash:", transactionHash);
    } catch (error) {
        console.error("Transaction failed:", error.message);
    }
}

testWalletService();
