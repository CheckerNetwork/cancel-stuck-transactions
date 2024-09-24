import assert from 'node:assert'
import ms from 'ms'

export const cancelTx = ({
  tx,
  recentGasUsed,
  recentGasFeeCap,
  log,
  sendTransaction
}) => {
  // Increase by 25% + 1 attoFIL (easier: 25.2%) and round up
  const maxPriorityFeePerGas = (tx.maxPriorityFeePerGas * 1252n + 1000n) / 1000n
  const gasLimit = Math.ceil(recentGasUsed * 1.1)

  log(`Replacing ${tx.hash}...`)
  log(`- maxPriorityFeePerGas: ${tx.maxPriorityFeePerGas} -> ${maxPriorityFeePerGas}`)
  log(`- gasLimit: ${recentGasUsed} -> ${gasLimit}`)
  return sendTransaction({
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
    throw new Error(`Filfox request failed with ${res.status}: ${(await res.text()).trimEnd()}`)
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
    assert(store.add, '.store.add required')
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
    assert.strictEqual(typeof tx.nonce, 'number')
    await this.#store.add({
      ...tx,
      timestamp: new Date().toISOString()
    })
  }

  async removeSuccessful (tx) {
    assert.strictEqual(typeof tx.hash, 'string')
    await this.#store.remove(tx.hash)
  }

  async cancelOlderThan (ageMs) {
    assert.strictEqual(typeof ageMs, 'number')

    this.#log('Checking for stuck transactions...')
    const txs = await this.#store.list()
    const txsToCancel = txs.filter(tx => {
      return new Date() - new Date(tx.timestamp) > ageMs
    })
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

    return Promise.allSettled(txsToCancel.map(tx => this.#cancelTx({
      tx,
      recentGasUsed: recentSendMessage.receipt.gasUsed,
      recentGasFeeCap: Number(recentSendMessage.gasFeeCap)
    })))
  }

  async #cancelTx ({ tx, recentGasUsed, recentGasFeeCap }) {
    let replacementTx
    try {
      replacementTx = await cancelTx({
        tx,
        recentGasUsed,
        recentGasFeeCap,
        log: str => this.#log(str),
        sendTransaction: tx => this.#sendTransaction(tx)
      })
    } catch (err) {
      if (err.code === 'NONCE_EXPIRED') {
        this.#log(`${tx.hash} has already been confirmed`)
        await this.#store.remove(tx.hash)
        return
      } else {
        throw err
      }
    }
    this.#log(`
      Waiting for receipt of replacing ${tx.hash} with ${replacementTx.hash}...`
    )
    await replacementTx.wait()
    await this.#store.remove(tx.hash)
    this.#log(`Replaced ${tx.hash} with ${replacementTx.hash}`)
  }
}
