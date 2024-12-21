import requests

class TransactionService:
    BASE_URL = "https://node.testnet.alephium.org"

    def build_transaction(self, from_address, to_address, amount, fee):
        payload = {
            "fromAddress": from_address,
            "destinations": [{"address": to_address, "attoAlphAmount": amount}],
            "fee": fee
        }
        try:
            response = requests.post(f"{self.BASE_URL}/transactions/build", json=payload)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            print(f"Error building transaction: {e}")
            return None

    def submit_transaction(self, signed_transaction):
        payload = {"signedTransaction": signed_transaction}
        try:
            response = requests.post(f"{self.BASE_URL}/transactions", json=payload)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            print(f"Error submitting transaction: {e}")
            return None
