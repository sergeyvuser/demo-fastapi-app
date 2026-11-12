import { expect, request } from '@playwright/test'
import { connect, type ChannelModel, type ConfirmChannel } from 'amqplib'

import { AMQP_URL, EDGE_URL } from './stack.ts'

// The test plays the exchange. In this stack no ingestor runs — the upstream
// refuses US egress and a hosted runner is US — so the only Ticks the system
// ever sees are the ones published here. One Tick raises the price in the
// Symbols endpoint, the socket frame, the evaluation and the Notification at
// once, because all of them hang off the same exchange.
//
// A fixture, not a sidecar replaying a recording: a spec must be able to say
// "now the price is 65 000" precisely between two assertions.

// The exchange the ingestor publishes to and the evaluator binds its queues
// to (shared/src/shared/broker.py), with the Symbol as the routing key.
const EXCHANGE = 'ticks'

export class Ticks {
  private readonly connection: ChannelModel
  private readonly channel: ConfirmChannel

  private constructor(connection: ChannelModel, channel: ConfirmChannel) {
    this.connection = connection
    this.channel = channel
  }

  static async open(): Promise<Ticks> {
    const connection = await connect(AMQP_URL)
    // A confirm channel: `publish` resolves once the broker has taken the
    // message, so a Tick is never still in this process's buffer when the
    // spec moves on to its next assertion.
    const channel = await connection.createConfirmChannel()
    // Checked, not declared. The evaluator declares the exchange with its own
    // arguments; declaring it from here would either duplicate that knowledge
    // or, if the two ever disagreed, quietly create a twin nobody consumes.
    // A missing exchange means the evaluator is not up — say so.
    try {
      await channel.checkExchange(EXCHANGE)
    } catch (error) {
      await connection.close().catch(() => undefined)
      throw new Error(`exchange "${EXCHANGE}" does not exist — is the evaluator running?`, {
        cause: error,
      })
    }
    return new Ticks(connection, channel)
  }

  // Publish one Tick and wait until the system has taken it in: until the
  // Symbols endpoint — read from the price cache the evaluator writes —
  // reports this price. When this returns, "the price is now `price`" is a
  // fact every part of the system agrees on, not a message in flight.
  async setPrice(symbol: string, price: number): Promise<void> {
    // The TickEvent contract (shared/src/shared/events.py), as the ingestor
    // serialises it: Decimals as strings, the time as ISO 8601 in UTC.
    const tick = {
      symbol,
      price: String(price),
      ts: new Date().toISOString(),
      reference_price: null,
    }
    this.channel.publish(EXCHANGE, symbol, Buffer.from(JSON.stringify(tick)), {
      contentType: 'application/json',
    })
    await this.channel.waitForConfirms()

    const api = await request.newContext({ baseURL: EDGE_URL })
    try {
      await expect
        .poll(
          async () => {
            const response = await api.get('/api/v1/symbols')
            const { items } = (await response.json()) as {
              items: { symbol: string; price: string | null }[]
            }
            const item = items.find((candidate) => candidate.symbol === symbol)
            return item?.price == null ? null : Number(item.price)
          },
          { message: `${symbol} never reached ${price} in the Symbols endpoint`, timeout: 10_000 },
        )
        .toBe(price)
    } finally {
      await api.dispose()
    }
  }

  async close(): Promise<void> {
    await this.connection.close()
  }
}
