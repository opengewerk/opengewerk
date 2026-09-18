import 'reflect-metadata'
import { Injectable, Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { describe, expect, it } from 'vitest'

// Nest finds constructor dependencies through the metadata that
// `emitDecoratorMetadata` writes. TypeScript 7 is the native rewrite of the
// compiler, so ADR 0009 asked for this to be checked instead of assumed.
//
// This covers the path the test runner takes: Vitest transforms the
// TypeScript here, tsc does not. The compiler itself was checked by hand on
// 18.09.2026 and gets covered for good once there is a build to run. Both
// paths have to keep the emit, and losing either one shows up the same way:
// a container that cannot resolve its own providers.

@Injectable()
class Clock {
  now(): Date {
    return new Date(0)
  }
}

@Injectable()
class Stamper {
  constructor(private readonly clock: Clock) {}

  stamp(): string {
    return this.clock.now().toISOString()
  }
}

@Module({ providers: [Clock, Stamper] })
class ProbeModule {}

describe('decorator metadata', () => {
  it('lets Nest resolve a constructor dependency', async () => {
    const context = await NestFactory.createApplicationContext(ProbeModule, { logger: false })

    expect(context.get(Stamper).stamp()).toBe('1970-01-01T00:00:00.000Z')

    await context.close()
  })
})
