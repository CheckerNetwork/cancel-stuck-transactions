import test from 'node:test'
import assert from 'node:assert'
import timers from 'node:timers/promises'
import { CancelStuckTransactions } from './index.js'

test('CancelStuckTransactions', async () => {
  const tx = {
    hash: 'hash',
    maxPriorityFeePerGas: 10n,
    nonce: 20,
    from: '0x0'
  }
  const storage = new Map()
  const sentTransactions = []
  const cancelStuckTransactions = new CancelStuckTransactions({
    store ({ hash, timestamp, from, maxPriorityFeePerGas, nonce }) {
      assert(!storage.has(hash))
      assert.strictEqual(typeof hash, 'string')
      assert.strictEqual(typeof timestamp, 'string')
      assert.strictEqual(typeof from, 'string')
      assert.strictEqual(typeof maxPriorityFeePerGas, 'bigint')
      assert.strictEqual(typeof nonce, 'number')
      storage.set(hash, {
        hash,
        timestamp,
        from,
        maxPriorityFeePerGas,
        nonce
      })
    },
    list () {
      return [...storage.values()]
    },
    resolve (hash) {
      assert(storage.has(hash))
      assert.strictEqual(typeof hash, 'string')
      storage.delete(hash)
    },
    log: () => {
      // TODO: Test logs
    },
    sendTransaction (tx) {
      sentTransactions.push(tx)
      return {
        hash: 'replacementTxHash',
        wait: () => {}
      }
    }
  })
  await cancelStuckTransactions.pending(tx)
  assert(storage.has(tx.hash))
  const storedTxClone = { ...storage.get(tx.hash) }
  assert(storedTxClone.timestamp)
  delete storedTxClone.timestamp
  assert.deepStrictEqual(storedTxClone, {
    hash: tx.hash,
    from: tx.from,
    maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
    nonce: tx.nonce
  })

  await cancelStuckTransactions.olderThan(1e10)
  assert.deepStrictEqual(sentTransactions, [])
  assert(storage.has(tx.hash))

  await timers.setImmediate()
  await cancelStuckTransactions.olderThan(0)
  assert.strictEqual(sentTransactions.length, 1)
  const sentTransactionClone = { ...sentTransactions[0] }
  assert(sentTransactionClone.gasLimit)
  assert(sentTransactionClone.maxFeePerGas)
  delete sentTransactionClone.gasLimit
  delete sentTransactionClone.maxFeePerGas
  assert.deepStrictEqual(sentTransactionClone, {
    maxPriorityFeePerGas: 13n,
    nonce: tx.nonce,
    to: tx.from,
    value: 0
  })
  assert.deepStrictEqual(storage, new Map())

  await cancelStuckTransactions.pending(tx)
  await cancelStuckTransactions.successful(tx)
  assert.deepStrictEqual(storage, new Map())
})
