import { CancelStuckTransactions } from './index.js'
import { ethers } from 'ethers'
import assert from 'node:assert'

const { WALLET_SEED } = process.env

assert(WALLET_SEED, 'WALLET_SEED required')

const provider = new ethers.JsonRpcProvider(
  'https://api.calibration.node.glif.io/'
)
const signer = ethers.Wallet.fromPhrase(WALLET_SEED).connect(provider)

const storage = new Map()
const cancelStuckTransactions = new CancelStuckTransactions({
  store ({ hash, timestamp, from, maxPriorityFeePerGas, nonce }) {
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
    storage.delete(hash)
  },
  log (str) {
    console.log(str)
  },
  async sendTransaction (tx) {
    return signer.sendTransaction(tx)
  }
})

const tx = await signer.sendTransaction({
  to: '0x000000000000000000000000000000000000dEaD',
  value: 1
})
console.log({
  hash: tx.hash,
  nonce: tx.nonce,
  gasLimit: tx.gasLimit,
  maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
  maxFeePerGas: tx.maxFeePerGas
})
await cancelStuckTransactions.pending(tx)
await cancelStuckTransactions.olderThan(0)
await cancelStuckTransactions.olderThan(0)
