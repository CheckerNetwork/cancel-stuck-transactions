import test from 'node:test'
import assert from 'node:assert'
import timers from 'node:timers/promises'
import {
  StuckTransactionsCanceller,
  cancelTx,
  getRecentSendMessage
} from './index.js'

test('StuckTransactionsCanceller', async () => {
  const tx = {
    hash: 'hash',
    maxPriorityFeePerGas: 10n,
    nonce: 20,
    from: '0x0'
  }
  const storage = new Map()
  const sentTransactions = []
  const stuckTransactionsCanceller = new StuckTransactionsCanceller({
    store: {
      add ({ hash, timestamp, from, maxPriorityFeePerGas, nonce }) {
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
      remove (hash) {
        assert(storage.has(hash))
        assert.strictEqual(typeof hash, 'string')
        storage.delete(hash)
      }
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
  await stuckTransactionsCanceller.addPending(tx)
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

  await stuckTransactionsCanceller.cancelOlderThan(1e10)
  assert.deepStrictEqual(sentTransactions, [])
  assert(storage.has(tx.hash))

  await timers.setImmediate()
  await stuckTransactionsCanceller.cancelOlderThan(0)
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

  await stuckTransactionsCanceller.addPending(tx)
  await stuckTransactionsCanceller.removeSuccessful(tx)
  assert.deepStrictEqual(storage, new Map())
})

test('cancelTx()', async () => {
  const sentTransactions = []
  const replacementTx = {}
  const replacementTxReturn = await cancelTx({
    tx: {
      hash: 'hash',
      maxPriorityFeePerGas: 10n,
      nonce: 20,
      from: '0x0'
    },
    recentGasUsed: 1,
    recentGasFeeCap: 11n,
    log: () => {},
    sendTransaction (tx) {
      sentTransactions.push(tx)
      return replacementTx
    }
  })
  assert.strictEqual(replacementTxReturn, replacementTx)
  assert.deepStrictEqual(sentTransactions, [{
    gasLimit: 2,
    maxFeePerGas: 13n,
    maxPriorityFeePerGas: 13n,
    nonce: 20,
    to: '0x0',
    value: 0
  }])
})

test('getRecentSendMessage()', async () => {
  const sendMessage = await getRecentSendMessage()
  assert.strictEqual(typeof sendMessage.cid, 'string')
  assert.strictEqual(typeof sendMessage.timestamp, 'number')
  assert(
    typeof sendMessage.receipt === 'object' && sendMessage.receipt !== null
  )
  assert.strictEqual(typeof sendMessage.receipt.gasUsed, 'number')
  assert.strictEqual(typeof sendMessage.gasFeeCap, 'string')
})
