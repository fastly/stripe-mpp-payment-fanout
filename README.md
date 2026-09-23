# Fastly Compute MPP Streaming Demo

Fastly Compute demo for metered machine-payment streams using MPP.

> **Support level:** Tier 2 Fastly open-source support. See [SUPPORT.md](SUPPORT.md).

The repo now demonstrates two related flows:

1. **Tempo native MPP session over Fanout**: opens one payment channel, meters finite unit requests through that channel, publishes each paid unit to Fanout, and settles when the session closes.
2. **Stripe SPT-funded stream**: creates one MPP `charge` with a Stripe Shared Payment Token, then streams multiple metered chunks inside the authorized budget without another payment handshake per chunk.

These flows share a streaming user experience, but they do not use the same MPP intent. Native `intent=session` support is provided by Tempo payment channels. Stripe SPT currently uses `intent=charge`, so its per-unit meter is implemented by the application after the initial authorization.

## What this demonstrates

- Fastly Compute as the payment enforcement and streaming delivery layer.
- Native MPP sessions over Tempo for pay-as-you-go crypto payments.
- Stripe SPT payment authorization for fiat-backed streaming access.
- Fastly Fanout or local Pushpin for the only long-lived SSE connection.
- A browser UI that displays the rail, units consumed, unit price, cumulative amount, and settlement event.
- Direct `402 Payment Required` inspection for both routes.

## Demo endpoints

- `/` - browser UI
- `/health` - configuration and route status
- `/protected-route` - original one-time Stripe SPT-protected route
- `/stripe-stream` - Stripe SPT-protected SSE stream
- `/tempo-stream` - finite Tempo MPP session endpoint for challenge, paid units, voucher management, and close
- `/api/stream-stripe` - local server-side Stripe payer helper used by the UI
- `/api/stream-tempo` - local server-side Tempo payer helper used by the UI
- `/api/tempo-rpc-test` - direct `eth_chainId` probe through the named `tempo_rpc` backend

## Payment behavior

### Tempo native session through Fanout

```text
Browser -> GET /fanout/tempo/:sessionId
Fastly -> hands the SSE connection to Fanout / Pushpin
Fanout -> holds the browser connection and subscribes it to the session channel

Payer helper -> GET /tempo-stream?unit=1
Fastly -> 402 Payment Required, method=tempo, intent=session
Payer helper -> retries with the opening session credential
Fastly -> verifies one paid unit and returns finite JSON
Payer helper -> publishes that unit to the Fanout channel

Payer helper -> repeats finite paid-unit requests on the same channel
Fastly -> verifies increasing cumulative authorization
Fanout -> delivers each published unit to the browser stream
Payer helper -> closes and settles the channel
```

Fanout is the only long-lived transport in this flow. The Tempo payer does not call
`session.sse()`. It uses one `SessionManager` across a sequence of finite `session.fetch()`
requests, preserving the payment channel while avoiding an internal SSE connection inside
Compute. Each successful unit is then published to the browser's Fanout channel.

### Stripe SPT-funded stream

```text
Agent -> GET /stripe-stream
Fastly -> 402 Payment Required, method=stripe, intent=charge
Agent -> retries with an SPT credential
Fastly -> creates and verifies the Stripe PaymentIntent
Fastly -> streams multiple metered chunks with no additional payment handshake
Fastly -> returns the MPP Payment-Receipt header
```

The Stripe flow authorizes the configured amount before streaming starts. The chunk meter is an application-level view of consumption inside that fixed authorization. Stopping early does not automatically refund unused budget in this demo.

## Prerequisites

- Node.js 20+
- Fastly CLI
- Stripe test secret key with Shared Payment Token test-helper access
- Two funded Tempo testnet accounts for the full native session demo
- Tempo testnet RPC access
- A named Fastly backend called `tempo_rpc` (configured automatically for local development and first deployment)

## Configure

```sh
cp .env.example .env
```

Generate the MPP challenge-signing secret:

```sh
openssl rand -hex 32
```

### Stripe configuration

```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PROFILE_ID=internal
STRIPE_PAYMENT_METHOD=pm_card_visa
STRIPE_PAYMENT_METHOD_TYPES=card,link
MPP_AMOUNT=0.50
MPP_CURRENCY=usd
MPP_STREAM_UNITS=10
```

Stripe SPT card payments have a practical minimum charge, so the default demo authorizes `$0.50` and divides the visual meter across ten chunks.

### Tempo session configuration

```env
TEMPO_SERVER_PRIVATE_KEY=0x...
TEMPO_PAYER_PRIVATE_KEY=0x...
TEMPO_RPC_URL=https://rpc.moderato.tempo.xyz
TEMPO_CURRENCY=0x20c0000000000000000000000000000000000000
TEMPO_UNIT_AMOUNT=0.0001
TEMPO_SUGGESTED_DEPOSIT=0.01
TEMPO_MAX_DEPOSIT=0.01
```

`TEMPO_SERVER_PRIVATE_KEY` is the payee account used to verify and settle channels. `TEMPO_PAYER_PRIVATE_KEY` is only for the local browser demo helper. Do not expose a server-held payer wallet in a public production service.

Fund both testnet accounts before running the Tempo flow. The payer needs pathUSD for the channel deposit. The server account needs the testnet gas asset required to settle the channel.

## Run locally

```sh
set -a
source .env
set +a

npm install --registry=https://registry.npmjs.org/
fastly compute build
mkdir -p local
test -f local/tempo-sessions.json || printf '{}\n' > local/tempo-sessions.json
fastly compute serve
```

Open:

```text
http://127.0.0.1:7676
```

Use **Start Tempo Session** to run the payment-channel flow. Use **Start Stripe Stream** to create one SPT charge and stream the metered response. The **Show 402** buttons display the payment challenge for each route.

## Verify configuration

```sh
curl -sS http://127.0.0.1:7676/health | jq
```

The health response separately reports:

- Stripe SPT configuration
- Tempo server configuration
- Tempo payer-helper configuration
- The named `tempo_rpc` backend used by viem
- Route and pricing details

Before testing a payment session, verify the RPC backend directly:

```sh
curl -sS http://127.0.0.1:7676/api/tempo-rpc-test | jq
```

Expected:

```json
{
  "ok": true,
  "backend": "tempo_rpc",
  "expectedChainId": 42431,
  "chainIdHex": "0xa5bf",
  "chainId": 42431
}
```

## Production notes

This remains a demonstration, not a production payment proxy.

- Move private keys and Stripe secrets to Fastly Secret Store.
- Move pricing and rail configuration to Config Store.
- Remove both server-side payer helpers from public deployments.
- Replace the included sequential KV adapter with an atomic session-state implementation before allowing concurrent voucher writers or broad multi-POP use.
- Add replay controls, request binding, budgets, timeouts, rate limits, observability, and origin routing.
- Decide how unused Stripe-authorized budget should be handled when a stream ends early.

Tempo channel state is stored in the `tempo_sessions` Fastly KV Store so finite unit and management requests can observe the same session state. The included adapter is suitable for this sequential single-payer demo, but it is not a cross-instance atomic compare-and-set implementation.

## Build compatibility note

`mppx` imports `isDeepStrictEqual` from `node:util` in its server path. Fastly Compute does not expose Node built-ins as runtime modules. This repo pre-bundles with esbuild and aliases `node:util` to `src/shims-node-util.ts` before `js-compute-runtime` creates `bin/main.wasm`.

### `response.clone is not a function`

Fastly Compute does not currently expose `Response.clone()`, while `mppx` uses it to create payment-event snapshots. This repo routes Stripe and Tempo payer requests through `src/fetch-compat.ts`, which supplies a metadata-only clone. The Tempo path now uses finite responses; the Stripe path still avoids buffering its live SSE body. Keep that wrapper in place when changing either payer implementation.

### `Tempo RPC chain-id request timed out`

The official Tempo Moderato URL remains `https://rpc.moderato.tempo.xyz`. This repo does not rely on
an implicit dynamic backend for viem RPC traffic. Every JSON-RPC request uses the named
`tempo_rpc` backend declared in `fastly.toml`.

Run this first:

```sh
curl -sS http://127.0.0.1:7676/api/tempo-rpc-test | jq
```

If that route fails, confirm the `local_server.backends.tempo_rpc` section is present, then stop and
restart `fastly compute serve`. Backend changes are only loaded when the local server starts.

### Tempo publishes `opening-channel` and then only keepalives

The Fanout connection is healthy, but the first Tempo payment request has not completed. This
revision publishes additional diagnostic events in this order:

```text
opening-channel
rpc-ready
wallets-ready
authorizing-unit
protocol-request
protocol-response
```

The first `protocol-response` should be a `402`, followed by the paid retry. Internal MPP requests
are routed explicitly through the `self` backend, and the Tempo server's own SSE transport is
disabled because Fanout is the only long-lived transport. Each protocol request has a 20-second
timeout and each paid unit has a 45-second timeout, so failures now produce an `error` event instead
of hanging indefinitely.

If the flow stops after `rpc-ready`, check the payer and server pathUSD balances. If it stops after a
`402` protocol response, the client is preparing the open-channel credential or waiting on Tempo RPC.
Stop the local server, remove `bin`, `dist`, and `pkg`, rebuild, and restart after updating the source.

## Fastly RPC compatibility

The demo uses a custom EIP-1193 transport instead of viem's standard HTTP transport. This avoids passing an `AbortSignal` into Fastly `fetch`, which is not currently supported by the Fastly JavaScript runtime.

## Security

Report suspected vulnerabilities privately using the process in [SECURITY.md](SECURITY.md). Do not include secrets, private keys, tokens, or customer data in public issues.

## License

Licensed under the MIT License. See [LICENSE](LICENSE).

Project attribution is provided in [NOTICE](NOTICE). Third-party software licenses and notices are provided in [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).
