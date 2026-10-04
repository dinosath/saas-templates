import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { parse, stringify } from 'yaml';

export interface FieldDefinition {
  type: string;
  required?: boolean;
  readOnly?: boolean;
  computed?: boolean;
  private?: boolean;
  writeOnly?: boolean;
  relation?: string;
  enum?: string[];
  default?: unknown;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  jsonSchema?: Record<string, unknown>;
}
export interface EntityDefinition {
  name: string;
  label: string;
  path: string;
  attributes: Record<string, FieldDefinition>;
}
const validator = new Ajv2020({ allErrors: true, strict: false });
addFormats(validator);

export function writableFields(entity: EntityDefinition): [string, FieldDefinition][] {
  return Object.entries(entity.attributes).filter(([, field]) => !field.readOnly && !field.computed && !field.private
    && !['oneToMany', 'manyToMany'].includes(field.relation ?? ''));
}
export function apiField(name: string, field: FieldDefinition): string {
  return field.type === 'relation' ? `${name}_id` : name;
}
export function displayValue(value: unknown, field: FieldDefinition): string {
  if (value === null || value === undefined) return '';
  if (field.type === 'yaml') {
    return typeof value === 'string' ? value : stringify(value);
  }
  if (field.type === 'json') {
    if (typeof value === 'string') {
      try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
    }
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}
export function parseField(text: string, field: FieldDefinition): unknown {
  if (!text.trim()) {
    if (field.required) throw new Error('This field is required');
    return null;
  }
  if (field.type === 'json' || field.type === 'yaml') {
    const value: unknown = field.type === 'yaml' ? parse(text, { maxAliasCount: 50 }) : JSON.parse(text);
    if (field.jsonSchema) {
      const validate = validator.compile(field.jsonSchema);
      if (!validate(value)) throw new Error(validator.errorsText(validate.errors));
    }
    return field.type === 'yaml' ? stringify(value) : value;
  }
  if (['integer', 'float', 'decimal', 'biginteger', 'relation'].includes(field.type)) {
    const value = Number(text);
    if (!Number.isFinite(value) || (['integer', 'biginteger', 'relation'].includes(field.type) && !Number.isSafeInteger(value))) {
      throw new Error('Enter a valid number');
    }
    if (field.min !== undefined && value < field.min) throw new Error(`Minimum is ${field.min}`);
    if (field.max !== undefined && value > field.max) throw new Error(`Maximum is ${field.max}`);
    return value;
  }
  if (field.type === 'boolean') return text === 'true';
  if (field.enum && !field.enum.includes(text)) throw new Error('Select an allowed value');
  if (field.minLength !== undefined && text.length < field.minLength) throw new Error(`Minimum length is ${field.minLength}`);
  if (field.maxLength !== undefined && text.length > field.maxLength) throw new Error(`Maximum length is ${field.maxLength}`);
  return text;
}