import { expect, test } from 'bun:test'
import { EXTRACTION, confirmedClaim, testApi } from '../testing/harness.ts'

test('material selection persists, rejects stale references and serializes owner writes', async () => {
  const { app, store } = await testApi({ scripted: [EXTRACTION] })
  try {
    const claimId = await confirmedClaim(app)
    expect((await app.inject('/preparation')).json().selection).toBeNull()
    const saved = await app.inject({
      method: 'POST',
      url: '/preparation',
      payload: { claimIds: [claimId] },
    })
    expect(saved.statusCode).toBe(200)
    expect((await app.inject('/preparation')).json().selection.claimIds).toEqual([claimId])
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/preparation',
          payload: { claimIds: ['missing'] },
        })
      ).statusCode,
    ).toBe(400)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/preparation',
          payload: { claimIds: [claimId], snapshotId: 'deleted' },
        })
      ).statusCode,
    ).toBe(400)
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        app.inject({ method: 'POST', url: '/preparation', payload: { claimIds: [] } }),
      ),
    )
    expect(results.map((response) => response.statusCode)).toEqual([200, 200, 200, 200])
    expect((await store.read('_preparation')).map((event) => event.seq)).toEqual([0, 1, 2, 3, 4])
    expect((await app.inject('/preparation')).json().selection.claimIds).toEqual([])
  } finally {
    await app.close()
  }
})
