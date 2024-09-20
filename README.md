# cancel-stuck-transactions

Cancel stuck transactions on the Filecoin network.

## Usage

```js
import { CancelStuckTransactions } from 'cancel-stuck-transactions'
import timers from 'node:timers/promises'
import fs from 'node:fs/promises'

const cancelStuckTransactions = new CancelStuckTransactions({
  // Pass a storage adapter, so that pending cancellations are persisted across
  // process restarts
  async store ({ hash, timestamp, from, gasPremium, nonce }) {
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
  async resolve (hash) {
    await fs.unlink(`transactions/${hash}`)
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
    await cancelStuckTransactions.olderThan(TEN_MINUTES)
    await timers.setTimeout(ONE_MINUTE)
  }
})()

// Create a transaction somehow
const tx = await ethers.createTransaction(/* ... */)

// After you create a transactions, set it as pending
cancelStuckTransactions.pending(tx)

// Start waiting for confirmations
await tx.wait()

// Once confirmed, set it as successful
await cancelStuckTransactions.successful(tx)
```

## Installation

```console
npm install cancel-stuck-transactions
```

## API

### `CancelStuckTransactions({ store, list, resolve, log, sendTransaction })`

Options:

- `store`: `({ hash: string, timestamp: string, from: string, maxPriorityFeePerGas: bigint, nonce: number }) -> Promise`
- `list`: `() -> Promise<{ hash, timestamp, from, gasPremium, nonce }[]>`
- `resolve`: `(hash) -> Promise`
- `log`: `str -> null`
- `sendTransactions`: `(tx) -> Promise<tx>`

### `#pending(tx) -> Promise`

Mark `tx` as pending.

`tx` should be a
[Transaction](https://docs.ethers.org/v6/api/transaction/#Transaction) object
from ethers.js.

### `#successful(tx) -> Promise`

Mark `tx` as successful.

### `#olderThan(ms) -> Promise`

Cancel transactions older than `ms`.
