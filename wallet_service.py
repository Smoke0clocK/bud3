import requests

class WalletService:
    BASE_URL = "https://node.testnet.alephium.org"

    def create_wallet(self):
        # Placeholder for wallet creation logic
        return {
            "address": "generated-wallet-address",
            "private_key": "generated-private-key"
        }

    def get_balance(self, address):
        try:
            response = requests.get(f"{self.BASE_URL}/addresses/{address}/balance")
            response.raise_for_status()
            return response.json().get("balance")
        except requests.exceptions.RequestException as e:
            print(f"Error fetching balance for {address}: {e}")
            return None
