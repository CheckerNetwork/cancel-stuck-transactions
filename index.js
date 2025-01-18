import assert from 'node:assert'
import ms from 'ms'
import pSettle from 'p-settle'

export const cancelTx = ({
  tx,
  recentGasLimit,
  recentGasFeeCap,
  log,
  sendTransaction
}) => {
  // Increase by 25% + 1 attoFIL (easier: 25.2%) and round up
  const maxPriorityFeePerGas = (tx.maxPriorityFeePerGas * 1252n + 1000n) / 1000n
  const gasLimit = BigInt(
    Math.min(
      Math.ceil(Math.max(Number(tx.gasLimit), recentGasLimit) * 1.1),
      1e10 // block gas limit
    )
  )

  log(`Replacing ${tx.hash}...`)
  log(`- maxPriorityFeePerGas: ${tx.maxPriorityFeePerGas} -> ${maxPriorityFeePerGas}`)
  log(`- gasLimit: ${tx.gasLimit} -> ${gasLimit}`)
  return sendTransaction({
    from: tx.from,
    to: tx.from,
    value: 0,
    nonce: tx.nonce,
    gasLimit,
    maxFeePerGas: maxPriorityFeePerGas > recentGasFeeCap
      ? maxPriorityFeePerGas
      : recentGasFeeCap,
    maxPriorityFeePerGas
  })
}

export const getRecentSendMessage = async () => {
  let res = await fetch('https://filfox.info/api/v1/message/list?method=Send')
  if (!res.ok) {
    const err = new Error(`Filfox request failed with ${res.status}: ${(await res.text()).trimEnd()}`)
    err.code = 'FILFOX_REQUEST_FAILED'
    throw err
  }
  const body = await res.json()
  assert(body.messages.length > 0, '/message/list returned an empty list')
  const sendMsg = body.messages.find(m => m.method === 'Send')
  assert(sendMsg, 'No Send message found in the recent committed messages')
  const cid = sendMsg.cid

  res = await fetch(`https://filfox.info/api/v1/message/${cid}`)
  if (!res.ok) {
    throw new Error(`Filfox request failed with ${res.status}: ${(await res.text()).trimEnd()}`)
  }

  return await res.json()
}

export class StuckTransactionsCanceller {
  #store
  #log
  #sendTransaction
  constructor ({ store, log, sendTransaction }) {
    assert(store, '.store required')
    assert(store.set, '.store.set required')
    assert(store.list, '.store.list required')
    assert(store.remove, '.store.remove required')
    assert(log, '.log required')
    assert(sendTransaction, '.sendTransaction required')
    this.#store = store
    this.#log = log
    this.#sendTransaction = sendTransaction
  }

  async addPending (tx) {
    assert.strictEqual(typeof tx.hash, 'string')
    assert.strictEqual(typeof tx.from, 'string')
    assert.strictEqual(typeof tx.maxPriorityFeePerGas, 'bigint')
    assert.strictEqual(typeof tx.gasLimit, 'bigint')
    assert.strictEqual(typeof tx.nonce, 'number')
    await this.#store.set({
      ...tx,
      timestamp: new Date().toISOString()
    })
  }

  async removeConfirmed (tx) {
    assert.strictEqual(typeof tx.hash, 'string')
    this.#log(`Removing ${tx.hash} and other tx with the same nonce...`)
    const txs = await this.#store.list()
    for (const _tx of txs) {
      if (_tx.nonce === tx.nonce) {
        await this.#store.remove(_tx.hash)
        this.#log(`Removed ${_tx.hash}`)
      }
    }
    this.#log(`Removed ${tx.hash} and other tx with the same nonce`)
  }

  async cancelOlderThan (ageMs, { concurrency = 50 } = {}) {
    assert.strictEqual(typeof ageMs, 'number')

    this.#log('Checking for stuck transactions...')
    const txs = await this.#store.list()
    const txsToCancel = txs
      .filter(tx => new Date() - new Date(tx.timestamp) > ageMs)
      // Ignore transactions that are already being replaced
      .filter(tx => !txs.some(_tx => _tx.nonce === tx.nonce && _tx.gasLimit > tx.gasLimit))
    if (txsToCancel.length === 0) {
      this.#log('No transactions to cancel')
      return
    }

    this.#log('Transactions to cancel:')
    for (const tx of txsToCancel) {
      this.#log(
        `- ${tx.hash} (nonce=${tx.nonce} age=${ms(new Date() - new Date(tx.timestamp))})`
      )
    }

    const recentSendMessage = await getRecentSendMessage()
    this.#log(
      'Calculating gas fees from the recent Send message ' +
      recentSendMessage.cid +
      ' (created at ' +
      new Date(recentSendMessage.timestamp * 1000).toISOString() +
      ')'
    )

    return pSettle(
      txsToCancel.map(tx => async () => this.#cancelTx({
        tx,
        recentGasLimit: recentSendMessage.gasLimit,
        recentGasFeeCap: Number(recentSendMessage.gasFeeCap)
      })),
      { concurrency }
    )
  }

  async #cancelTx ({ tx, recentGasLimit, recentGasFeeCap }) {
    let replacementTx
    try {
      replacementTx = await cancelTx({
        tx,
        recentGasLimit,
        recentGasFeeCap,
        log: str => this.#log(str),
        sendTransaction: tx => this.#sendTransaction(tx)
      })
      await this.addPending(replacementTx)
    } catch (err) {
      if (err.code === 'NONCE_EXPIRED') {
        this.#log(`${tx.hash} has already been confirmed`)
        await this.removeConfirmed(tx)
        return
      } else {
        throw err
      }
    }
    this.#log(
      `Waiting for receipt of replacing ${tx.hash} with ${replacementTx.hash}...`
    )
    await replacementTx.wait()
    await this.removeConfirmed(tx)
    this.#log(`Replaced ${tx.hash} with ${replacementTx.hash}`)
  }
}
