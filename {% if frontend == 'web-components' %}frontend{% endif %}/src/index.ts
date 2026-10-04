export { createEntityClient, EntityClientError } from './core/client';
export type { EntityClient, EntityTransport, EntityRecord, EntityRequest, EntityResult, CallOptions, ListOptions } from './core/client';
export type { EntityDefinition, FieldDefinition } from './core/schema';
export { createRestTransport } from './adapters/rest';
export { defineEntityEditor } from './web-component';
export type { EntityEditorElement, EntitySavedDetail, EntityDeletedDetail } from './web-component';