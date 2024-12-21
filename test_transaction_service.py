from services.transaction_service import TransactionService

transaction_service = TransactionService()

# Test building a transaction
from_address = "1G6zLwzvQWYgsjnCA2xRpJ6JmptbgyAasEvRjRYK763YB"  # Replace with sender's address
to_address = "1GyPThufLLMrEjw3fAjLweMFUbSQKiUe5BKh8G2Sx1a9x"  # Replace with recipient's address
amount = "1000000000000000000"  # 1 ALPH in atto ALPH
fee = "10000000"  # Example fee

transaction = transaction_service.build_transaction(from_address, to_address, amount, fee)
print(f"Transaction: {transaction}")
