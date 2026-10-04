import { EntityClientError, type EntityTransport } from '../core/client';
import type { EntityDefinition } from '../core/schema';

export interface RestOptions {
  baseUrl: string;
  entities: EntityDefinition[];
  headers?: () => HeadersInit;
  fetch?: typeof fetch;
}
export function createRestTransport(options: RestOptions): EntityTransport {
  const requestFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  return {
    async execute(request, call) {
      const entity = options.entities.find(candidate => candidate.name === request.entity);
      if (!entity) throw new EntityClientError('Unknown entity', 'not_found');
      const methods = { list: 'GET', read: 'GET', create: 'POST', update: 'PUT', delete: 'DELETE' };
      const url = new URL(`${options.baseUrl.replace(/\/$/, '')}${entity.path}`);
      if (request.id !== undefined) url.pathname += `/${encodeURIComponent(request.id)}`;
      if (request.operation === 'list') {
        url.searchParams.set('page', String(request.page ?? 1));
        url.searchParams.set('page_size', String(request.pageSize ?? 25));
      }
      const headers = new Headers(options.headers?.());
      headers.set('content-type', 'application/json');
      const response = await requestFetch(url, {
        method: methods[request.operation], headers, signal: call?.signal, credentials: 'same-origin',
        body: request.payload === undefined ? undefined : JSON.stringify(request.payload),
      });
      if (!response.ok) throw new EntityClientError(await response.text() || response.statusText, String(response.status));
      const text = await response.text();
      const body: unknown = text ? JSON.parse(text) : null;
      const total = Number(response.headers.get('content-range')?.split('/').pop() ?? 0);
      return { body, total };
    },
  };
}