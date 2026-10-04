# Provider contract recheck — 2026-10-04

The former Bitget `/api-doc/spot/...` links currently extract a unified-account
overview. The Classic v2 documentation is available under `/api-doc/classic/`.
This is a documentation-path change, not proof that Classic endpoints stopped
serving or that this account has upgraded to UTA.

Official references inspected:

- https://www.bitget.com/api-doc/classic/spot/trade/Place-Order
- https://www.bitget.com/api-doc/classic/spot/trade/Cancel-Order
- https://www.bitget.com/api-doc/classic/quickStart/intro
- https://www.bitget.com/api-doc/classic/uta-api-upgrade-guide
- https://www.bitget.com/api-doc/uta/trade/Place-Order
- https://www.bitget.com/api-doc/uta/trade/Cancel-Order
- https://www.bitget.com/api-doc/uta/trade/Get-Order-Details

Classic spot submission remains documented as POST
`/api/v2/spot/trade/place-order`, with base-sized limit/market-sell and quote-sized
market-buy `size`, and `force` for limit orders. Standard UID ceiling is 10/sec;
copy-trading trader submission is limited to 1/sec. Cancellation is POST
`/api/v2/spot/trade/cancel-order`, with symbol and a provider/client order ID,
10/sec per UID. The actual account type must be checked before choosing a ceiling.

UTA uses v3 endpoints and `category=SPOT`, `qty`, `timeInForce`, and distinct
order-detail status/quantity fields. Spot auto-borrow must remain disabled.
The official upgrade guide states signature headers/mechanism are unchanged but
explicitly warns that v2/v3 error-code semantics need not be identical. Do not
switch paths in the existing Classic adapter or reuse its code catalog as a UTA
execution certification. An ACK is not an actual fill or terminal cancellation;
read-only lookup/private-stream evidence must confirm order status.

These are public documentation findings. No authenticated provider certification,
account-mode check, live order or cancellation was performed. Existing local
fixture evidence remains local and does not establish account activation.

BTCC's official notice https://www.btcc.com/en-US/detail/176811 and support centre
were rechecked. Extracted content does not provide a current REST mutation
specification or authoritative restoration confirmation. Targeted official-site
searches did not establish one. Search absence does not prove the API remains
suspended; its current authoritative contract remains unverified. Historical
2023 attachments and guessed legacy Python endpoints cannot clear that blocker.
