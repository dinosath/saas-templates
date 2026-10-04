import { describe, expect, it, vi } from 'vitest';
import { createEntityClient, EntityClientError, type EntityTransport } from './client';
import { parseField, writableFields } from './schema';
import { createRestTransport } from '../adapters/rest';

describe('vendor-neutral entity client', () => {
  it('delegates CRUD and cancellation to the injected transport', async () => {
    const execute = vi.fn<EntityTransport['execute']>().mockResolvedValue({ body: { id: 7, name: 'Document' }, total: 1 });
    const client = createEntityClient({ execute });
    const signal = new AbortController().signal;
    await client.read('Document', 7, { signal });
    await client.create('Document', { name: 'New' });
    await client.update('Document', 7, { name: 'Updated' });
    await client.delete('Document', 7);
    expect(execute.mock.calls.map(([request]) => request.operation)).toEqual(['read', 'create', 'update', 'delete']);
    expect(execute.mock.calls[0][1]?.signal).toBe(signal);
  });
  it('returns records and total without exposing transport details', async () => {
    const execute = vi.fn<EntityTransport['execute']>().mockResolvedValue({ body: [{ id: 1 }], total: 31 });
    expect(await createEntityClient({ execute }).list('Document', { page: 2 })).toEqual({ records: [{ id: 1 }], total: 31 });
    expect(execute.mock.calls[0][0]).toMatchObject({ page: 2, pageSize: 25 });
  });
  it('rejects malformed backend records', async () => {
    const client = createEntityClient({ execute: async () => ({ body: { name: 'No ID' }, total: 0 }) });
    await expect(client.read('Document', 1)).rejects.toBeInstanceOf(EntityClientError);
    await expect(client.list('Document')).rejects.toBeInstanceOf(EntityClientError);
  });
  it('supports injected REST fetch, headers, and pagination', async () => {
    const requestFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response('[{"id":1}]', { headers: { 'content-range': 'items 0-0/12' } }));
    const transport = createRestTransport({ baseUrl: 'https://example.test', entities: [{ name: 'Document', label: 'Document', path: '/api/documents', attributes: {} }],
      headers: () => ({ authorization: 'Bearer test', 'x-tenant-id': 'tenant-a' }), fetch: requestFetch });
    expect(await createEntityClient(transport).list('Document', { page: 2 })).toEqual({ records: [{ id: 1 }], total: 12 });
    expect(String(requestFetch.mock.calls[0][0])).toBe('https://example.test/api/documents?page=2&page_size=25');
    expect(new Headers(requestFetch.mock.calls[0][1]?.headers).get('x-tenant-id')).toBe('tenant-a');
    await expect(transport.execute({ entity: 'Unknown', operation: 'list' })).rejects.toThrow('Unknown entity');
  });
});

describe('structured field editing', () => {
  const jsonSchema = { type: 'object', required: ['name'], properties: { name: { type: 'string' } }, additionalProperties: false };
  it('validates JSON and preserves the structured value', () => {
    expect(parseField('{"name":"Example"}', { type: 'json', jsonSchema })).toEqual({ name: 'Example' });
    expect(() => parseField('{"name":7}', { type: 'json', jsonSchema })).toThrow();
    expect(() => parseField('{invalid', { type: 'json' })).toThrow();
  });
  it('validates YAML using the same JSON Schema', () => {
    expect(parseField('name: Example', { type: 'yaml', jsonSchema })).toBe('name: Example\n');
    expect(() => parseField('name: 7', { type: 'yaml', jsonSchema })).toThrow();
    expect(() => parseField('name: [', { type: 'yaml' })).toThrow();
  });
  it('handles required, numeric and optional values', () => {
    expect(() => parseField('', { type: 'json', required: true })).toThrow('required');
    expect(parseField('', { type: 'json' })).toBeNull();
    expect(parseField('3', { type: 'integer', min: 1 })).toBe(3);
    expect(() => parseField('1.5', { type: 'integer' })).toThrow();
    expect(() => parseField('0', { type: 'integer', min: 1 })).toThrow();
  });
  it('omits server-controlled and collection relationship fields', () => {
    expect(writableFields({ name: 'Document', label: 'Document', path: '/api/documents', attributes: {
      name: { type: 'string' }, total: { type: 'integer', computed: true }, secret: { type: 'string', private: true },
      children: { type: 'relation', relation: 'oneToMany' },
    } }).map(([name]) => name)).toEqual(['name']);
  });
});