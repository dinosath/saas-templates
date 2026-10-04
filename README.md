# springrs-template

## Connect Entity Editor

Generate the optional ConnectRPC backend and entity editor:

```sh
baker generate . generated/connect --answers-file samples/answers-connect.json --force --non-interactive --skip-confirms all
cd generated/connect
mise run frontend-build
DATABASE_URL=postgres://postgres:postgres@localhost:5432/app cargo run
```

The backend serves the built editor at `http://localhost:8080`. For frontend
development, `mise run frontend-dev` starts Vite and proxies API calls to that backend.

Use these answers in your own configuration:

```json
{
	"backend": "axum",
	"orm": "seaorm",
	"id_type": "integer",
	"protocols": ["rest", "connect"],
	"frontend": "entity-editor",
	"frontend_protocol": "connect"
}
```

Connect is an optional protocol, not a replacement backend. It uses `connectrpc`
0.9.1 and `connectrpc-build` 0.9.0, requiring Rust 1.88 or newer. The unary
`entities.v1.EntityService/Execute` service supports list, read, create, update,
and delete. Generated Rust and TypeScript bindings share `proto/entities.proto`.
Rust code generation uses protox without a system protoc dependency; frontend
generation uses locally installed Buf and Protobuf-ES npm tools.

The adapter dispatches only to generated entity routes in-process, reusing REST
validation, authentication, and tenant handling. Authorization, cookie, and
tenant headers are forwarded; internal server errors are sanitized. REST must
be enabled. SeaORM and Diesel with integer IDs are supported; spring-rs, Toasty,
UUID/big-integer IDs, and gRPC-Web editor transport are not supported by this
variant. Existing frontend and tonic choices remain unchanged.

The editor is a schema-driven CRUD UI, not a workflow diagram editor. Its
architecture follows the reference editor's separation of domain logic,
transport adapters, and UI. It can also use the existing REST API by selecting
`frontend_protocol: "rest"` without enabling Connect.

### Embedding

Generated `frontend/src/core` has no framework or Connect dependency.
`EntityClient` and `EntityTransport` are the reusable contracts; REST and Connect
implementations live in `frontend/src/adapters`. The editor is also exposed as
a framework-independent Web Component. Set the client and entity definitions as
JavaScript properties:

```ts
import { createEntityClient, defineEntityEditor, type EntityEditorElement } from './frontend/src';
import { createConnectEntityTransport } from './frontend/src/adapters/connect';
import { entities } from './frontend/src/entities';

const client = createEntityClient(createConnectEntityTransport({
	baseUrl: 'https://api.example.test',
	headers: () => ({
		authorization: `Bearer ${session.accessToken}`,
		'x-tenant-id': session.tenantId,
	}),
}));

defineEntityEditor();
const editor = document.createElement('saas-entity-editor') as EntityEditorElement;
editor.client = client;
editor.entities = entities;
document.querySelector('#container')!.append(editor);

editor.addEventListener('entity-saved', event => {
	const { entity, record } = (event as CustomEvent).detail;
	console.log('Saved', entity, record.id);
});
```

The element dispatches bubbling `entity-saved` and `entity-deleted` events.
Its styles are encapsulated in its shadow root. The custom element requires a
browser DOM and is registered by calling `defineEntityEditor()`; it has no React
runtime or framework dependency.

Token storage, login, and tenant selection belong to the embedding application;
the generated standalone host does not invent an authentication provider.
Cross-origin deployments must configure the backend's allowed origins and
credentials as appropriate for their authentication scheme.

JSON and YAML attributes receive structured text editors. Optional `jsonSchema`
objects are validated with AJV (draft 2020-12) before saving. YAML is parsed
with the YAML library and validated against the same schema. JSON fields use
native JSON values; YAML fields retain their text storage representation. This is editor-side
validation, not a new database constraint or server-side JSON Schema validator.

### Tests

`mise run connect` joins the existing generation/build/container test suite.
Focused checks, after generation and dependency installation:

```sh
cd generated/connect
mise run frontend-test
mise run frontend-build
cargo test --lib connect::tests
```