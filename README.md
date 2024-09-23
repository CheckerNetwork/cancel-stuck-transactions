# cancel-stuck-transactions

Cancel stuck transactions on the Filecoin network.

## Usage

```js
import { StuckTransactionsCanceller } from 'cancel-stuck-transactions'
import timers from 'node:timers/promises'
import fs from 'node:fs/promises'

const stuckTransactionsCanceller = new StuckTransactionsCanceller({
  // Pass a storage adapter, so that pending cancellations are persisted across
  // process restarts
  store: {
    async add ({ hash, timestamp, from, gasPremium, nonce }) {
      await fs.writeFile(
        `transactions/${hash}`,
        JSON.stringify({ hash, timestamp, from, gasPremium, nonce })
      )
    },
    async list () {
      const cids = await fs.readdir('transactions')
      return Promise.all(cids.map(async cid => {
        return JSON.parse(await fs.readFile(`transactions/${cid}`))
      }))
    },
    async remove (hash) {
      await fs.unlink(`transactions/${hash}`)
    },
  },
  log (str) {
    console.log(str)
  },
  // Pass to an ethers signer for sending replacement transactions
  sendTransaction (tx) {
    return signer.sendTransaction(tx)
  }
})

// Start the cancel transactions loop
;(async () => {
  while (true) {
    await stuckTransactionsCanceller.cancelOlderThan(TEN_MINUTES)
    await timers.setTimeout(ONE_MINUTE)
  }
})()

// Create a transaction somehow
const tx = await ethers.createTransaction(/* ... */)

// After you create a transactions, add it as pending
stuckTransactionsCanceller.addPending(tx)

// Start waiting for confirmations
await tx.wait()

// Once confirmed, remove it
await stuckTransactionsCanceller.removeSuccessful(tx)
```

## Installation

```console
npm install cancel-stuck-transactions
```

## API

### `StuckTransactionsCanceller({ store, log, sendTransaction })`

```js
import { StuckTransactionsCanceller } from 'cancel-stuck-transactions'
```

Options:

- `store`:
  - `store.add`: `({ hash: string, timestamp: string, from: string, maxPriorityFeePerGas: bigint, nonce: number }) -> Promise`
  - `store.list`: `() -> Promise<{ hash: string, timestamp: string, from: string, maxPriorityFeePerGas: bigint, nonce: number }[]>`
  - `store.remove`: `(hash: string) -> Promise`
- `log`: `(string) -> null`
- `sendTransactions`: `(Transaction) -> Promise<Transaction>`

### `#addPending(tx) -> Promise`

Add `tx` as pending.

`tx` should be a
[Transaction](https://docs.ethers.org/v6/api/transaction/#Transaction) object
from ethers.js.

### `#removeSuccessful(tx) -> Promise`

Remove `tx` because it is successful.

### `#cancelOlderThan(ms) -> Promise`

Cancel transactions older than `ms`.

### `cancelTx({ tx, recentGasUsed, recentGasFeeCap, log, sendTransaction }) -> Promise<tx>`

```js
import { cancelTx } from 'cancel-stuck-transactions'
```

Helper method that manually cancels transaction `tx`.

Options:

- `tx`: `ethers.Transaction`
- `recentGasUsed`: `number`
- `recentGasFeeCap`: `bigint`
- `log`: `(str: string) -> null`
- `sendTransactions`: `(Transaction) -> Promise<Transaction>`

Throws:
- `err.code === 'NONCE_EXPIRED'`: The transaction can't be replaced because
it has already been confirmed
- _potentially more_

### `getRecentSendMessage() -> Promise<SendMessage>`

```js
import { getRecentSendMessage } from 'cancel-stuck-transactions'
```

Helper method that fetches a recent `SendMessage`.

`SendMessage` has keys (and more):
- `cid`: `string`
- `timestamp`: `number`
- `receipt`: `object`
  -  `gasUsed`: `number`
- `gasFeeCap`: `string`
