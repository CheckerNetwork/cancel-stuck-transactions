import test from 'node:test'
import assert from 'node:assert'
import timers from 'node:timers/promises'
import {
  StuckTransactionsCanceller,
  cancelTx,
  getRecentSendMessage
} from './index.js'
import createDebug from 'debug'
import pDefer from 'p-defer'

const debug = createDebug('test')

test('StuckTransactionsCanceller', async t => {
  await t.test('#addPending()', async () => {
    const tx = {
      hash: 'hash',
      maxPriorityFeePerGas: 10n,
      gasLimit: 1n,
      nonce: 20,
      from: '0x0'
    }
    const storage = new Map()
    const stuckTransactionsCanceller = new StuckTransactionsCanceller({
      store: {
        set ({ hash, timestamp, from, maxPriorityFeePerGas, gasLimit, nonce }) {
          assert(!storage.has(hash))
          assert.strictEqual(typeof hash, 'string')
          assert.strictEqual(typeof timestamp, 'string')
          assert.strictEqual(typeof from, 'string')
          assert.strictEqual(typeof maxPriorityFeePerGas, 'bigint')
          assert.strictEqual(typeof gasLimit, 'bigint')
          assert.strictEqual(typeof nonce, 'number')
          storage.set(hash, {
            hash,
            timestamp,
            from,
            maxPriorityFeePerGas,
            gasLimit,
            nonce
          })
        },
        list () {
          throw new Error('Should not be called')
        },
        remove (hash) {
          throw new Error('Should not be called')
        }
      },
      log: str => {
        // TODO: Test logs
        debug(str)
      },
      sendTransaction () {
        throw new Error('Should not be called')
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
      gasLimit: tx.gasLimit,
      nonce: tx.nonce
    })
  })
  await t.test('#cancelOlderThan', async t => {
    await t.test('nothing to cancel', async t => {
      const tx = {
        hash: 'hash',
        maxPriorityFeePerGas: 10n,
        gasLimit: 1n,
        nonce: 20,
        from: '0x0'
      }
      const storage = new Map()
      const sentTransactions = []
      const stuckTransactionsCanceller = new StuckTransactionsCanceller({
        store: {
          set ({ hash, timestamp, from, maxPriorityFeePerGas, gasLimit, nonce }) {
            assert(!storage.has(hash))
            storage.set(hash, {
              hash,
              timestamp,
              from,
              maxPriorityFeePerGas,
              gasLimit,
              nonce
            })
          },
          list () {
            return [...storage.values()]
          },
          remove (hash) {
            throw new Error('Should not be called')
          }
        },
        log: str => {
          // TODO: Test logs
          debug(str)
        },
        sendTransaction (tx) {
          throw new Error('Should not be called')
        }
      })
      await stuckTransactionsCanceller.addPending(tx)
      const status = await stuckTransactionsCanceller.cancelOlderThan(1e10)
      assert.strictEqual(status, undefined)
      assert.deepStrictEqual(sentTransactions, [])
      assert(storage.has(tx.hash))
    })
    await t.test('cancel old transactions', async t => {
      const tx = {
        hash: 'hash',
        maxPriorityFeePerGas: 10n,
        gasLimit: 1n,
        nonce: 20,
        from: '0x0'
      }
      const storage = new Map()
      const sentTransactions = []
      const stuckTransactionsCanceller = new StuckTransactionsCanceller({
        store: {
          set ({ hash, timestamp, from, maxPriorityFeePerGas, gasLimit, nonce }) {
            assert(!storage.has(hash))
            storage.set(hash, {
              hash,
              timestamp,
              from,
              maxPriorityFeePerGas,
              gasLimit,
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
        log: str => {
          // TODO: Test logs
          debug(str)
        },
        sendTransaction (tx) {
          sentTransactions.push(tx)
          return {
            ...tx,
            hash: 'replacementTxHash',
            wait: () => {}
          }
        }
      })
      await stuckTransactionsCanceller.addPending(tx)
      await timers.setImmediate()
      const status = await stuckTransactionsCanceller.cancelOlderThan(0)
      assert.deepStrictEqual(status, [{
        status: 'fulfilled',
        value: undefined,
        isFulfilled: true,
        isRejected: false
      }])
      assert.strictEqual(sentTransactions.length, 1)
      const sentTransactionClone = { ...sentTransactions[0] }
      assert(sentTransactionClone.maxFeePerGas)
      assert(sentTransactionClone.gasLimit)
      delete sentTransactionClone.maxFeePerGas
      delete sentTransactionClone.gasLimit
      assert.deepStrictEqual(sentTransactionClone, {
        maxPriorityFeePerGas: 13n,
        nonce: tx.nonce,
        from: tx.from,
        to: tx.from,
        value: 0
      })
      assert.deepStrictEqual(storage, new Map())
    })
    await t.test('cancel stuck replacement transactions', async t => {
      const tx = {
        hash: 'hash',
        maxPriorityFeePerGas: 10n,
        gasLimit: 1n,
        nonce: 20,
        from: '0x0'
      }
      const storage = new Map()
      const sentTransactions = []
      const replacementTxs = [
        {
          hash: 'replacementTxHash1',
          deferred: pDefer()
        }, {
          hash: 'replacementTxHash2',
          deferred: pDefer()
        }
      ]
      let replacementTxIndex = 0
      const stuckTransactionsCanceller = new StuckTransactionsCanceller({
        store: {
          set ({ hash, timestamp, from, maxPriorityFeePerGas, gasLimit, nonce }) {
            assert(!storage.has(hash))
            storage.set(hash, {
              hash,
              timestamp,
              from,
              maxPriorityFeePerGas,
              gasLimit,
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
        log: str => {
          // TODO: Test logs
          debug(str)
        },
        sendTransaction (tx) {
          sentTransactions.push(tx)
          const { hash, deferred } = replacementTxs[replacementTxIndex++]
          return {
            ...tx,
            hash,
            wait: deferred.promise
          }
        }
      })
      await stuckTransactionsCanceller.addPending(tx)
      await timers.setTimeout()
      await Promise.all([
        stuckTransactionsCanceller.cancelOlderThan(0),
        (async () => {
          // The replacement transaction is "stuck" now
          while (!storage.has(replacementTxs[0].hash)) {
            await timers.setTimeout()
          }
          await timers.setTimeout()
          await Promise.all([
            stuckTransactionsCanceller.cancelOlderThan(0),
            (async () => {
              // The replacement of the replacement transaction is "stuck" now
              while (!storage.has(replacementTxs[1].hash)) {
                await timers.setTimeout()
              }
              // Finally, the replacement's replacement is the one that succeeds
              replacementTxs[1].deferred.resolve()
            })()
          ])
        })()
      ])
      assert.strictEqual(sentTransactions.length, 2)
      while (Object.keys(storage).length > 0) {
        await timers.setTimeout()
      }
    })
  })
  await t.test('#removeConfirmed()', async t => {
    const tx = {
      hash: 'hash',
      maxPriorityFeePerGas: 10n,
      gasLimit: 1n,
      nonce: 20,
      from: '0x0'
    }
    const storage = new Map()
    const stuckTransactionsCanceller = new StuckTransactionsCanceller({
      store: {
        set ({ hash, timestamp, from, maxPriorityFeePerGas, gasLimit, nonce }) {
          assert(!storage.has(hash))
          storage.set(hash, {
            hash,
            timestamp,
            from,
            maxPriorityFeePerGas,
            gasLimit,
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
      log: str => {
        // TODO: Test logs
        debug(str)
      },
      sendTransaction (tx) {
        throw new Error('Should not be called')
      }
    })

    await stuckTransactionsCanceller.addPending(tx)
    await stuckTransactionsCanceller.addPending({ ...tx, hash: 'replacementTxHash' })
    await stuckTransactionsCanceller.addPending({ ...tx, hash: 'replacementTxHash2', nonce: 21 })
    await stuckTransactionsCanceller.removeConfirmed(tx)
    assert(!storage.has(tx.hash))
    assert(!storage.has('replacementTxHash'))
    assert(storage.has('replacementTxHash2'))
  })
})

test('cancelTx()', async () => {
  const sentTransactions = []
  const replacementTx = {}
  const replacementTxReturn = await cancelTx({
    tx: {
      hash: 'hash',
      maxPriorityFeePerGas: 10n,
      gasLimit: 1n,
      nonce: 20,
      from: '0x0'
    },
    recentGasLimit: 1,
    recentGasFeeCap: 11n,
    log: () => {},
    sendTransaction (tx) {
      sentTransactions.push(tx)
      return replacementTx
    }
  })
  assert.strictEqual(replacementTxReturn, replacementTx)
  assert.deepStrictEqual(sentTransactions, [{
    gasLimit: 2n,
    maxFeePerGas: 13n,
    maxPriorityFeePerGas: 13n,
    nonce: 20,
    from: '0x0',
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
