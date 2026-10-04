export type EntityRecord = Record<string, unknown> & { id: number | string };
export type Operation = 'list' | 'read' | 'create' | 'update' | 'delete';
export interface CallOptions { signal?: AbortSignal; }
export interface ListOptions extends CallOptions { page?: number; pageSize?: number; }
export interface EntityRequest {
  entity: string;
  operation: Operation;
  id?: number | string;
  payload?: Record<string, unknown>;
  page?: number;
  pageSize?: number;
}
export interface EntityResult { body: unknown; total: number; }
export interface EntityTransport {
  execute(request: EntityRequest, options?: CallOptions): Promise<EntityResult>;
}
export interface EntityClient {
  list(entity: string, options?: ListOptions): Promise<{ records: EntityRecord[]; total: number }>;
  read(entity: string, id: number | string, options?: CallOptions): Promise<EntityRecord>;
  create(entity: string, payload: Record<string, unknown>, options?: CallOptions): Promise<EntityRecord>;
  update(entity: string, id: number | string, payload: Record<string, unknown>, options?: CallOptions): Promise<EntityRecord>;
  delete(entity: string, id: number | string, options?: CallOptions): Promise<void>;
}
export class EntityClientError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'EntityClientError';
  }
}
function record(value: unknown): EntityRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('id' in value)
      || (typeof value.id !== 'number' && typeof value.id !== 'string')) {
    throw new EntityClientError('Invalid entity response', 'invalid_response');
  }
  return value as EntityRecord;
}
export function createEntityClient(transport: EntityTransport): EntityClient {
  return {
    async list(entity, options = {}) {
      const response = await transport.execute({ entity, operation: 'list', page: options.page ?? 1, pageSize: options.pageSize ?? 25 }, options);
      if (!Array.isArray(response.body)) throw new EntityClientError('Invalid list response', 'invalid_response');
      return { records: response.body.map(record), total: response.total };
    },
    async read(entity, id, options) {
      return record((await transport.execute({ entity, operation: 'read', id }, options)).body);
    },
    async create(entity, payload, options) {
      return record((await transport.execute({ entity, operation: 'create', payload }, options)).body);
    },
    async update(entity, id, payload, options) {
      return record((await transport.execute({ entity, operation: 'update', id, payload }, options)).body);
    },
    async delete(entity, id, options) {
      await transport.execute({ entity, operation: 'delete', id }, options);
    },
  };
}