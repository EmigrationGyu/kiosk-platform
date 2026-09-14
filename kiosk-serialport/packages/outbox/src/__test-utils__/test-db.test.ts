import { describe, expect, test } from 'bun:test';
import { outboxMutation } from '../db/schema';
import { createTestDb, FakeClock, makeFakeIdGen } from './test-db';

describe('test infrastructure smoke', () => {
  test('createTestDb returns empty schema-applied DB', () => {
    const { db, cleanup } = createTestDb();
    const rows = db.select().from(outboxMutation).all();
    expect(rows).toEqual([]);
    cleanup();
  });

  test('FakeClock advances deterministically', () => {
    const clock = new FakeClock(1000);
    expect(clock.now()).toBe(1000);
    clock.advance(500);
    expect(clock.now()).toBe(1500);
    clock.set(9999);
    expect(clock.now()).toBe(9999);
  });

  test('makeFakeIdGen produces sequential ids', () => {
    const gen = makeFakeIdGen();
    expect(gen()).toBe('id-1');
    expect(gen()).toBe('id-2');
    expect(gen()).toBe('id-3');
  });
});
