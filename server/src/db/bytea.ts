import { customType } from 'drizzle-orm/pg-core';

/**
 * A Postgres bytea column, read back as a Buffer from either driver: node-postgres returns a Buffer, PGlite a plain
 * Uint8Array, and Postgres writes bytea inside JSON (such as nested relational queries) as "\x<hex>" text.
 */
export const bytea = customType<{ data: Uint8Array; driverData: Uint8Array | string }>({
  dataType() {
    return 'bytea';
  },
  toDriver(value: Uint8Array): Uint8Array {
    return value;
  },
  fromDriver(value: Uint8Array | string): Buffer {
    if (typeof value === 'string') {
      if (!value.startsWith('\\x')) throw new Error('Unexpected bytea text format');
      return Buffer.from(value.slice(2), 'hex');
    }
    return Buffer.isBuffer(value) ? value : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  },
});
