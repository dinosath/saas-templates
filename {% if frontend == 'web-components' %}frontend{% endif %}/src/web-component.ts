import type { EntityClient, EntityRecord } from './core/client';
import { apiField, displayValue, parseField, writableFields, type EntityDefinition, type FieldDefinition } from './core/schema';

const editorStylesUrl = new URL('./ui/editor.css', import.meta.url).href;

export interface EntityEditorElement extends HTMLElement {
  client: EntityClient;
  entities: EntityDefinition[];
}

export type EntitySavedDetail = { entity: string; record: EntityRecord };
export type EntityDeletedDetail = { entity: string; id: number | string };

type EditorElement = HTMLElement;
type DraftValue = string;

function createElement<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function createButton(label: string, onClick: () => void, options: { className?: string; disabled?: boolean; title?: string } = {}): HTMLButtonElement {
  const button = createElement('button', options.className ?? '', label);
  button.type = 'button';
  button.disabled = options.disabled ?? false;
  if (options.title) button.title = options.title;
  button.addEventListener('click', onClick);
  return button;
}

function editableFields(entity: EntityDefinition): [string, FieldDefinition][] {
  return writableFields(entity);
}

export function defineEntityEditor(tagName = 'saas-entity-editor'): void {
  if (typeof customElements === 'undefined' || typeof HTMLElement === 'undefined') return;
  if (customElements.get(tagName)) return;

  class SaasEntityEditorElement extends HTMLElement {
    private readonly root: ShadowRoot;
    private entityClient: EntityClient | null = null;
    private entityDefinitions: EntityDefinition[] = [];
    private records: EntityRecord[] = [];
    private total = 0;
    private page = 1;
    private loading = false;
    private busy = false;
    private error = '';
    private message = '';
    private editing: EntityRecord | 'new' | null = null;
    private deleting: EntityRecord | null = null;
    private draft: Record<string, DraftValue> = {};
    private fieldErrors: Record<string, string> = {};
    private requestController: AbortController | null = null;

    constructor() {
      super();
      this.root = this.attachShadow({ mode: 'open' });
      this.upgradeProperty('client');
      this.upgradeProperty('entities');
    }

    get client(): EntityClient {
      if (!this.entityClient) throw new Error('Set the client property before connecting the editor');
      return this.entityClient;
    }

    set client(value: EntityClient) {
      this.entityClient = value;
      if (this.isConnected) void this.loadRecords();
    }

    get entities(): EntityDefinition[] {
      return this.entityDefinitions;
    }

    set entities(value: EntityDefinition[]) {
      this.entityDefinitions = Array.isArray(value) ? value : [];
      if (!this.entityDefinitions.some(entity => entity.name === this.currentEntityName)) {
        this.currentEntityName = this.entityDefinitions[0]?.name ?? '';
      }
      if (this.isConnected) void this.loadRecords();
    }

    private currentEntityName = '';

    connectedCallback(): void {
      if (!this.currentEntityName) this.currentEntityName = this.entityDefinitions[0]?.name ?? '';
      void this.loadRecords();
    }

    disconnectedCallback(): void {
      this.requestController?.abort();
      this.requestController = null;
    }

    private upgradeProperty(name: 'client' | 'entities'): void {
      if (!Object.prototype.hasOwnProperty.call(this, name)) return;
      const element = this as unknown as Record<string, unknown>;
      const value = element[name];
      delete element[name];
      element[name] = value;
    }

    private get entity(): EntityDefinition | undefined {
      return this.entityDefinitions.find(candidate => candidate.name === this.currentEntityName);
    }

    private async loadRecords(): Promise<void> {
      this.requestController?.abort();
      const controller = new AbortController();
      this.requestController = controller;
      if (!this.isConnected || !this.entityClient || !this.entity) {
        this.records = [];
        this.total = 0;
        this.render();
        return;
      }
      this.loading = true;
      this.error = '';
      this.render();
      try {
        const result = await this.entityClient.list(this.currentEntityName, {
          page: this.page,
          pageSize: 25,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        this.records = result.records;
        this.total = result.total;
      } catch (cause) {
        if (controller.signal.aborted) return;
        this.records = [];
        this.error = cause instanceof Error ? cause.message : 'Unable to load records';
      } finally {
        if (!controller.signal.aborted) {
          this.loading = false;
          this.render();
        }
      }
    }

    private render(): void {
      if (!this.isConnected) return;
      const style = createElement('link');
      style.rel = 'stylesheet';
      style.href = editorStylesUrl;
      const app = createElement('div', 'entity-editor');
      const main = createElement('main', 'editor-main');
      const collectionHeading = createElement('div', 'collection-heading');
      const collectionTitle = createElement('div', 'collection-title');
      const heading = createElement('h1', '', this.entity?.label ?? 'Collections');
      collectionTitle.append(heading);
      if (this.entityDefinitions.length > 1) {
        const selector = createElement('select');
        selector.setAttribute('aria-label', 'Select collection');
        selector.value = this.currentEntityName;
        selector.disabled = this.busy;
        for (const entity of this.entityDefinitions) {
          const option = createElement('option', '', entity.label);
          option.value = entity.name;
          selector.append(option);
        }
        selector.addEventListener('change', () => {
          this.currentEntityName = selector.value;
          this.page = 1;
          this.records = [];
          this.message = '';
          void this.loadRecords();
        });
        collectionTitle.append(selector);
      }
      collectionTitle.append(createElement('span', '', `${this.total} records`));
      const toolbar = createElement('div', 'toolbar');
      toolbar.append(createButton('Refresh', () => void this.loadRecords(), {
        disabled: this.loading || this.busy, title: 'Refresh records',
      }));
      toolbar.append(createButton('New record', () => void this.openEditor(), {
        className: 'primary', disabled: !this.entity || this.busy,
      }));
      collectionHeading.append(collectionTitle, toolbar);
      main.append(collectionHeading);
      const alert = createElement('p', 'error');
      alert.setAttribute('role', 'alert');
      if (this.error && this.editing === null && this.deleting === null) alert.textContent = this.error;
      if (alert.textContent) main.append(alert);
      const status = createElement('p', 'status', this.loading ? 'Loading records...' : this.message);
      status.setAttribute('role', 'status');
      main.append(status, this.renderTable());
      main.append(this.renderPagination());
      app.append(main);
      this.root.replaceChildren(style, app);
      if (this.editing !== null) this.renderEditorDialog(app);
      if (this.deleting !== null) this.renderDeleteDialog(app);
    }

    private renderTable(): HTMLElement {
      const wrapper = createElement('div', 'table-scroll');
      wrapper.setAttribute('aria-busy', String(this.loading));
      const table = createElement('table');
      const head = createElement('thead');
      const header = createElement('tr');
      header.append(createElement('th', '', 'ID'));
      const columns = this.entity
        ? Object.entries(this.entity.attributes).filter(([, field]) => !field.private && !field.writeOnly
          && !['oneToMany', 'manyToMany'].includes(field.relation ?? '')).slice(0, 5)
        : [];
      for (const [name] of columns) header.append(createElement('th', '', name.replaceAll('_', ' ')));
      header.append(createElement('th', '', 'Actions'));
      head.append(header);
      table.append(head);
      const body = createElement('tbody');
      for (const record of this.records) {
        const row = createElement('tr');
        row.append(createElement('td', 'record-id', String(record.id)));
        for (const [name, field] of columns) {
          const cell = createElement('td');
          if (field.type === 'json' || field.type === 'yaml') {
            cell.append(createElement('span', 'structured-value', field.type.toUpperCase()));
          } else {
            cell.append(createElement('span', 'cell-value', displayValue(record[apiField(name, field)], field)));
          }
          row.append(cell);
        }
        const actions = createElement('div', 'row-actions');
        actions.append(createButton('Edit', () => void this.openEditor(record), {
          disabled: this.busy, title: `Edit record ${record.id}`,
        }));
        actions.append(createButton('Delete', () => { this.error = ''; this.deleting = record; this.render(); }, {
          className: 'danger', disabled: this.busy, title: `Delete record ${record.id}`,
        }));
        const actionCell = createElement('td');
        actionCell.append(actions);
        row.append(actionCell);
        body.append(row);
      }
      table.append(body);
      wrapper.append(table);
      if (!this.loading && !this.error && this.records.length === 0) {
        const empty = createElement('div', 'empty');
        empty.append(createElement('p', '', this.entity ? 'No records' : 'No collections configured'));
        wrapper.append(empty);
      }
      return wrapper;
    }

    private renderPagination(): HTMLElement {
      const footer = createElement('footer', 'pagination');
      const pageCount = Math.max(1, Math.ceil(this.total / 25));
      footer.append(createElement('span', '', `Page ${this.page} of ${pageCount}`));
      const controls = createElement('div', 'toolbar');
      controls.append(createButton('Previous', () => {
        this.page -= 1;
        void this.loadRecords();
      }, { disabled: this.page === 1 || this.loading || this.busy, title: 'Previous page' }));
      controls.append(createButton('Next', () => {
        this.page += 1;
        void this.loadRecords();
      }, { disabled: this.page * 25 >= this.total || this.loading || this.busy, title: 'Next page' }));
      footer.append(controls);
      return footer;
    }

    private async openEditor(record?: EntityRecord): Promise<void> {
      const entity = this.entity;
      if (!entity || !this.entityClient) return;
      this.error = '';
      this.busy = true;
      this.render();
      try {
        const current = record ? await this.entityClient.read(entity.name, record.id) : undefined;
        this.draft = Object.fromEntries(editableFields(entity).map(([name, field]) => [name,
          displayValue(current?.[apiField(name, field)] ?? field.default, field)]));
        this.fieldErrors = {};
        this.editing = current ?? 'new';
      } catch (cause) {
        this.error = cause instanceof Error ? cause.message : 'Unable to open record';
      } finally {
        this.busy = false;
        this.render();
      }
    }

    private renderEditorDialog(app: HTMLElement): void {
      const entity = this.entity;
      if (!entity) return;
      const dialog = createElement('dialog', 'record-dialog');
      dialog.setAttribute('aria-labelledby', 'record-title');
      dialog.addEventListener('cancel', event => {
        event.preventDefault();
        this.editing = null;
        this.render();
      });
      const form = createElement('form');
      const title = this.editing === 'new' ? 'New record'
        : this.editing ? `Record ${this.editing.id}` : 'New record';
      const header = createElement('div', 'dialog-heading');
      header.append(createElement('h2', '', title));
      header.append(createButton('Close', () => { this.editing = null; this.render(); }, {
        disabled: this.busy, title: 'Close editor',
      }));
      const fieldsContainer = createElement('div', 'record-fields');
      for (const [name, field] of editableFields(entity)) {
        fieldsContainer.append(this.createField(name, field));
      }
      if (this.error && this.editing !== null) fieldsContainer.append(createElement('p', 'error', this.error));
      const footer = createElement('footer', 'dialog-footer');
      footer.append(createButton('Cancel', () => { this.editing = null; this.error = ''; this.render(); }, { disabled: this.busy }));
      const submit = createElement('button', 'primary', this.busy ? 'Saving...' : 'Save record');
      submit.type = 'submit';
      submit.disabled = this.busy;
      footer.append(submit);
      form.append(header, fieldsContainer, footer);
      form.addEventListener('submit', event => {
        event.preventDefault();
        void this.saveRecord();
      });
      dialog.append(form);
      app.append(dialog);
      dialog.showModal();
    }

    private createField(name: string, field: FieldDefinition): HTMLElement {
      const fieldContainer = createElement('div', 'record-field');
      const id = `field-${name}`;
      const label = createElement('label', '', `${name.replaceAll('_', ' ')}${field.required ? ' *' : ''}`);
      label.htmlFor = id;
      fieldContainer.append(label);
      let input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      if (['json', 'yaml', 'text', 'richtext'].includes(field.type)) {
        const textarea = createElement('textarea');
        textarea.rows = field.type === 'text' ? 4 : 8;
        if (field.type === 'json' || field.type === 'yaml') textarea.className = 'code-field';
        input = textarea;
      } else if (field.enum) {
        const select = createElement('select');
        const empty = createElement('option', '', 'Select value');
        empty.value = '';
        select.append(empty);
        for (const value of field.enum) {
          const option = createElement('option', '', value);
          option.value = value;
          select.append(option);
        }
        input = select;
      } else {
        const control = createElement('input');
        control.type = field.type === 'password' ? 'password'
          : field.type === 'email' ? 'email'
            : field.type === 'date' ? 'date'
              : field.type === 'boolean' ? 'checkbox'
                : ['integer', 'float', 'decimal', 'relation'].includes(field.type) ? 'number' : 'text';
        if (control.type === 'number') control.step = 'any';
        input = control;
      }
      input.id = id;
      input.disabled = this.busy;
      const value = this.draft[name] ?? '';
      if (input instanceof HTMLInputElement && input.type === 'checkbox') input.checked = value === 'true';
      else input.value = value;
      const updateDraft = () => {
        this.draft[name] = input instanceof HTMLInputElement && input.type === 'checkbox' ? String(input.checked) : input.value;
        this.fieldErrors[name] = '';
        input.removeAttribute('aria-invalid');
        const error = fieldContainer.querySelector('.field-error');
        error?.remove();
      };
      input.addEventListener('input', updateDraft);
      input.addEventListener('change', updateDraft);
      if (this.fieldErrors[name]) {
        input.setAttribute('aria-invalid', 'true');
        input.setAttribute('aria-describedby', `${id}-error`);
        const error = createElement('p', 'field-error', this.fieldErrors[name]);
        error.id = `${id}-error`;
        fieldContainer.append(input, error);
      } else {
        fieldContainer.append(input);
      }
      return fieldContainer;
    }

    private async saveRecord(): Promise<void> {
      const entity = this.entity;
      const editing = this.editing;
      if (!entity || !this.entityClient || editing === null) return;
      const payload: Record<string, unknown> = {};
      this.fieldErrors = {};
      for (const [name, field] of editableFields(entity)) {
        try {
          payload[apiField(name, field)] = parseField(this.draft[name] ?? '', field);
        } catch (cause) {
          this.fieldErrors[name] = cause instanceof Error ? cause.message : 'Invalid value';
        }
      }
      if (Object.keys(this.fieldErrors).length) {
        this.error = '';
        this.render();
        return;
      }
      this.busy = true;
      this.error = '';
      this.render();
      try {
        const record = editing === 'new'
          ? await this.entityClient.create(entity.name, payload)
          : await this.entityClient.update(entity.name, editing.id, payload);
        this.dispatchEvent(new CustomEvent<EntitySavedDetail>('entity-saved', {
          detail: { entity: entity.name, record }, bubbles: true, composed: true,
        }));
        this.editing = null;
        this.message = 'Record saved';
        await this.loadRecords();
      } catch (cause) {
        this.error = cause instanceof Error ? cause.message : 'Unable to save record';
        this.render();
      } finally {
        this.busy = false;
        this.render();
      }
    }

    private renderDeleteDialog(app: HTMLElement): void {
      const record = this.deleting;
      if (!record) return;
      const dialog = createElement('dialog', 'record-dialog');
      dialog.setAttribute('aria-labelledby', 'delete-title');
      dialog.addEventListener('cancel', event => {
        event.preventDefault();
        this.deleting = null;
        this.render();
      });
      const header = createElement('div', 'dialog-heading');
      header.append(createElement('h2', '', `Delete record ${record.id}?`));
      const content = createElement('div', 'record-fields');
      content.append(createElement('p', '', 'This cannot be undone.'));
      if (this.error) content.append(createElement('p', 'error', this.error));
      const footer = createElement('footer', 'dialog-footer');
      footer.append(createButton('Cancel', () => { this.deleting = null; this.error = ''; this.render(); }, { disabled: this.busy }));
      footer.append(createButton(this.busy ? 'Deleting...' : 'Delete record', () => void this.deleteRecord(), {
        className: 'danger', disabled: this.busy,
      }));
      dialog.append(header, content, footer);
      app.append(dialog);
      dialog.showModal();
    }

    private async deleteRecord(): Promise<void> {
      const entity = this.entity;
      const record = this.deleting;
      if (!entity || !record || !this.entityClient) return;
      this.busy = true;
      this.error = '';
      this.render();
      try {
        await this.entityClient.delete(entity.name, record.id);
        this.dispatchEvent(new CustomEvent<EntityDeletedDetail>('entity-deleted', {
          detail: { entity: entity.name, id: record.id }, bubbles: true, composed: true,
        }));
        this.deleting = null;
        this.message = 'Record deleted';
        if (this.records.length === 1 && this.page > 1) this.page -= 1;
        await this.loadRecords();
      } catch (cause) {
        this.error = cause instanceof Error ? cause.message : 'Unable to delete record';
        this.render();
      } finally {
        this.busy = false;
        this.render();
      }
    }
  }

  customElements.define(tagName, SaasEntityEditorElement);
}
