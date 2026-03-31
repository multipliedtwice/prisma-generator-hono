# prisma-generator-hono

[![npm version](https://badge.fury.io/js/prisma-generator-hono.svg)](https://badge.fury.io/js/prisma-generator-hono)
[![npm](https://img.shields.io/npm/dt/prisma-generator-hono.svg)](https://www.npmjs.com/package/prisma-generator-hono)
[![npm](https://img.shields.io/npm/l/prisma-generator-hono.svg)](LICENSE)

Prisma generator that creates Hono CRUD API routes with OpenAPI documentation from your Prisma schema.

Running `npx prisma generate` produces:

- Handler functions for all Prisma operations (findMany, create, update, delete, etc.)
- Router generator with middleware support (before/after hooks per operation)
- OpenAPI 3.1 spec (JSON and YAML endpoints registered automatically per router)
- Documentation helpers for contract view and Scalar UI (require manual mounting)
- Client-side query parameter encoder
- Guard/variant shape enforcement via prisma-guard integration

## Compatibility

### Prisma version

Minimum supported Prisma version: **6.0.0**

Some operations require newer versions:

| Operation             | Minimum Prisma version | Notes                                |
| --------------------- | ---------------------- | ------------------------------------ |
| `omit` parameter      | 6.2.0                  | Returns 400 on versions 6.0.x–6.1.x  |
| `updateManyAndReturn` | 6.2.0                  | PostgreSQL, CockroachDB, SQLite only |

### Database provider support

Most operations work across all Prisma-supported providers. Exceptions:

| Feature               | PostgreSQL | CockroachDB | MySQL | SQLite | SQL Server | MongoDB |
| --------------------- | ---------- | ----------- | ----- | ------ | ---------- | ------- |
| `createManyAndReturn` | ✓          | ✓           | ✗     | ✓      | ✗          | ✗       |
| `updateManyAndReturn` | ✓          | ✓           | ✗     | ✓      | ✗          | ✗       |
| `skipDuplicates`      | ✓          | ✓           | ✓     | ✗      | ✗          | ✗       |

Operations not supported by your database provider will return `501 Not Implemented` at runtime. The generator emits handlers for all operations regardless of provider — use selective route configuration to expose only supported operations.

## Installation

```bash
npm install -D prisma-generator-hono
```

Peer dependencies:

```bash
npm install @prisma/client hono
```

Optional peer dependencies:

```bash
npm install prisma-sql         # SQL optimization
npm install prisma-guard       # Guard shape enforcement
npm install prisma-query-builder-ui  # Visual query playground
```

## Setup

Add the generator to your `schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

generator hono {
  provider = "prisma-generator-hono"
}
```

The generator detects the Prisma client generator automatically. All standard provider values are supported: `prisma-client-js`, `@prisma/client`, and `prisma-client`.

Generate:

```bash
npx prisma generate
```

## Usage

```ts
import { Hono } from 'hono'
import { PrismaClient } from '@prisma/client'
import { UserRouter } from './generated/User/UserRouter'

const prisma = new PrismaClient()
const app = new Hono()

app.use('*', async (c, next) => {
  c.set('prisma', prisma)
  await next()
})

const userConfig = {
  enableAll: true,
}

app.route('/', UserRouter(userConfig))

export default app
```

## Selective routes with middleware

```ts
const userConfig = {
  findMany: {
    before: [authMiddleware],
  },
  create: {
    before: [authMiddleware, validateBody],
  },
  findUnique: {},
}

app.route('/', UserRouter(userConfig))
```

## Guard shapes (variant-based field access)

Guard shapes require the `prisma-guard` package for runtime enforcement.

### Setup

```bash
npm install prisma-guard
```

Extend your PrismaClient with the guard extension:

```ts
import { PrismaClient } from '@prisma/client'
import { guardExtension } from 'prisma-guard'

const prisma = new PrismaClient().$extends(guardExtension())
```

### Configuration

```ts
const userConfig = {
  findMany: {
    shape: {
      admin: { select: { id: true, email: true, role: true } },
      public: { select: { id: true, email: true } },
    },
  },
  guard: {
    variantHeader: 'x-api-variant',
  },
}

app.route('/', UserRouter(userConfig))
```

When a guard shape is configured on an operation, the variant is resolved from the configured header (default: `x-api-variant`) or a custom `resolveVariant` function. The resolved variant selects which shape config to apply. If no variant is resolved, the behavior depends on prisma-guard's configuration for handling undefined callers. If prisma-guard is not installed or the client is not extended with the guard extension, requests to guarded routes return a 500 with an actionable error message.

## Request body format

All write operations accept the full Prisma args object as the JSON request body. The body must be a JSON object — sending `null`, arrays, or other non-object values returns 400.

```ts
// Create
{ "data": { "name": "Alice", "email": "alice@example.com" }, "select": { "id": true } }

// Update
{ "where": { "id": 1 }, "data": { "name": "Bob" } }

// Delete
{ "where": { "id": 1 } }

// Upsert
{ "where": { "id": 1 }, "create": { "name": "Alice" }, "update": { "name": "Bob" } }
```

Write operations that return records (create, update, delete, upsert, createManyAndReturn, updateManyAndReturn) support `select`, `include`, and `omit` in the request body to control the response shape.

### Bulk operations

`createMany`, `createManyAndReturn`, `updateMany`, and `updateManyAndReturn` accept scalar-only data inputs. Nested relation writes are not supported in bulk operations. The generated OpenAPI schemas for bulk operations reflect this constraint with dedicated `CreateManyInput` and `UpdateManyMutationInput` schemas that exclude relation fields.

### Batch operation safety

`deleteMany`, `updateMany`, and `updateManyAndReturn` require a `where` field in the request body. Requests without `where` are rejected with 400 to prevent accidental mass operations. Note that sending `{ "where": {} }` is valid and matches all records — this protection catches accidental omission, not intentional broad operations.

## Query encoding (client side)

```ts
import { encodeQueryParams } from './generated/client/encodeQueryParams'

const params = encodeQueryParams({
  where: { status: 'active', role: { in: ['admin', 'editor'] } },
  select: { id: true, email: true },
  take: 20,
})

const response = await fetch(`/user?${params}`)
```

Complex values (`where`, `select`, `include`, `omit`, `orderBy`) are JSON-stringified. Primitives (`take`, `skip`) are sent directly. The encoder accepts `Record<string, unknown>` and handles BigInt serialization automatically. It does not provide compile-time type checking against your Prisma schema.

## Response shaping: select, include, omit

Read and single-record write operations support three response shaping parameters:

- **`select`** — choose which fields to include. Set scalar fields to `true`, use nested objects for relations.
- **`include`** — include relations in addition to all scalar fields. Use nested `include`/`select` for deep loading.
- **`omit`** — exclude specific scalar fields from the response.

`select` and `include` cannot be used together at the same level. `select` and `omit` cannot be used together at the same level. `omit` can be combined with `include`.

The `omit` parameter requires Prisma 6.2.0+. On versions 6.0.x–6.1.x, requests using `omit` return 400.

## BigInt and Decimal handling

BigInt and Decimal values are serialized as strings in JSON responses. The OpenAPI spec documents BigInt and Decimal fields as `type: string`.

On the client side, `encodeQueryParams` handles BigInt serialization automatically.

```ts
// Response format for a BigInt field
{ "id": "9007199254740993" }
```

## Pagination

`findManyPaginated` returns `{ data, total, hasMore }`. When the runtime supports interactive transactions, the count and query execute in a transaction for consistency. On runtimes without interactive transaction support (some edge adapters), the queries run independently with eventual consistency on the `total` count.

The `hasMore` field is reliable for forward offset pagination (`skip` + `take`) only. When using cursor-based pagination or negative `take` (backward pagination), `hasMore` may be inaccurate because the total count is computed against the full result set without regard to cursor position.

Configure default and maximum page sizes:

```ts
UserRouter({
  findManyPaginated: {},
  pagination: {
    defaultLimit: 20,
    maxLimit: 100,
  },
})
```

`pagination.defaultLimit` is applied when the client omits `take`. `pagination.maxLimit` caps `take` by absolute value to the configured limit when the client provides a larger number — this applies to both positive and negative `take` values to enforce the limit regardless of pagination direction. Neither setting applies as a default when only the other is configured. Both settings apply to `findMany` and `findManyPaginated`.

## Error handling

All errors are returned as JSON with a `message` field:

```json
{ "message": "Unique constraint violation" }
```

Each generated router installs an `onError` handler that normalizes all errors (including Hono `HTTPException` and unexpected errors) to this format. Prisma error codes are mapped to appropriate HTTP status codes.

| Status | Description                                |
| ------ | ------------------------------------------ |
| 400    | Invalid parameters, body, or query         |
| 403    | Guard policy rejected                      |
| 404    | Record not found                           |
| 409    | Unique constraint or transaction conflict  |
| 500    | Internal server error                      |
| 501    | Feature not supported by database provider |
| 503    | Database connection pool timeout           |

## Documentation endpoints

### Automatic (registered by each router)

Each router automatically registers OpenAPI spec endpoints when not in production. The actual paths depend on your `customUrlPrefix` and `addModelPrefix` configuration. With default settings (`addModelPrefix: true`, no `customUrlPrefix`):

| Endpoint                | Description           |
| ----------------------- | --------------------- |
| `/{model}/openapi.json` | OpenAPI 3.1 JSON spec |
| `/{model}/openapi.yaml` | OpenAPI 3.1 YAML spec |

With `customUrlPrefix: '/api/v1'`:

| Endpoint                       | Description           |
| ------------------------------ | --------------------- |
| `/api/v1/{model}/openapi.json` | OpenAPI 3.1 JSON spec |
| `/api/v1/{model}/openapi.yaml` | OpenAPI 3.1 YAML spec |

### Manual (generated helpers, require mounting)

The generator produces helper functions that you mount yourself. Pass the same config object used for the router to keep docs and runtime in sync:

```ts
import {
  generateCombinedDocs,
  registerModelDocs,
} from './generated/combinedDocs'

const userConfig = {
  findMany: { before: [authMiddleware] },
  create: {},
  findUnique: {},
}

const postConfig = {
  enableAll: true,
}

app.route('/', UserRouter(userConfig))
app.route('/', PostRouter(postConfig))

// Mount per-model docs using the same config objects
registerModelDocs(app, '/docs', {
  User: userConfig,
  Post: postConfig,
})

// Mount combined index page
app.get(
  '/docs',
  generateCombinedDocs({
    title: 'My API',
    modelConfigs: {
      User: userConfig,
      Post: postConfig,
    },
  }),
)
```

Only models listed in `modelConfigs` / the configs passed to `registerModelDocs` appear in the documentation index. Models not included are not advertised. Models with `disableOpenApi: true` in their config are excluded from the index and not registered.

| Endpoint                      | Description             |
| ----------------------------- | ----------------------- |
| `/docs`                       | Combined index page     |
| `/docs/{model}`               | Contract view (default) |
| `/docs/{model}?ui=scalar`     | Scalar interactive UI   |
| `/docs/{model}?ui=json`       | Raw JSON                |
| `/docs/{model}?ui=yaml`       | Raw YAML                |
| `/docs/{model}?ui=playground` | Query playground        |

Disable in production via `NODE_ENV=production` or `DISABLE_OPENAPI=true`. Override with `disableOpenApi: false` in config to force-enable. Per-model overrides are respected: setting `disableOpenApi: false` on a specific model's config will keep that model's docs available even when the global environment disables docs.

### OpenAPI spec accuracy

The generated OpenAPI schemas for single-record write operations include descriptive nested relation write shapes (create, connect, connectOrCreate, set, disconnect, upsert, etc.). Bulk write operations (createMany, updateMany, and their AndReturn variants) use dedicated scalar-only schemas that correctly exclude nested relation writes.

Prisma features not represented in the spec include: scalar update operation envelopes (`set`, `increment`, `decrement`, `multiply`, `divide`, `push`) and checked/unchecked input variants. The spec is descriptive and suitable for documentation, but should not be used as the sole source for client code generation when these features are needed.

### Spec paths and mount prefixes

The generated OpenAPI spec and docs compute paths from `customUrlPrefix` and the model name. If you mount a router under a parent path (e.g., `app.route('/api', ...)`), the spec paths will not reflect that prefix because Hono mount paths are invisible to the router at generation time.

Use `specBasePath` to set the base path for OpenAPI spec and docs independently of route registration:

```ts
const userConfig = {
  enableAll: true,
  specBasePath: '/api',
}

app.route('/api', UserRouter(userConfig))
```

This produces spec paths like `/api/user/...` while route registration uses the normal `customUrlPrefix` logic. When `specBasePath` is not set, `customUrlPrefix` is used for both runtime routes and spec paths.

## prisma-sql integration

When `prisma-sql` is installed, the generated handlers automatically attempt to use its `speedExtension` for optimized SQL execution. The extension activates only when a database connector is provided via Hono context variables.

Set `c.var.postgres` or `c.var.sqlite` in your middleware to activate the extension:

```ts
import { PrismaClient } from '@prisma/client'
import postgres from 'postgres'

const prisma = new PrismaClient()
const sql = postgres(process.env.DATABASE_URL!)

app.use('*', async (c, next) => {
  c.set('prisma', prisma)
  c.set('postgres', sql)
  await next()
})
```

Without a connector in context, the handlers use the standard PrismaClient with no performance difference. Set `DEBUG=true` in the environment to enable prisma-sql debug logging.

## Router schema

| Operation           | Method | Path             |
| ------------------- | ------ | ---------------- |
| findMany            | GET    | `/`              |
| findFirst           | GET    | `/first`         |
| findFirstOrThrow    | GET    | `/first/strict`  |
| findUnique          | GET    | `/unique`        |
| findUniqueOrThrow   | GET    | `/unique/strict` |
| findManyPaginated   | GET    | `/paginated`     |
| count               | GET    | `/count`         |
| aggregate           | GET    | `/aggregate`     |
| groupBy             | GET    | `/groupby`       |
| create              | POST   | `/`              |
| createMany          | POST   | `/many`          |
| createManyAndReturn | POST   | `/many/return`   |
| update              | PUT    | `/`              |
| updateMany          | PUT    | `/many`          |
| updateManyAndReturn | PUT    | `/many/return`   |
| upsert              | PATCH  | `/`              |
| delete              | DELETE | `/`              |
| deleteMany          | DELETE | `/many`          |

Paths shown are relative suffixes. Actual paths include the model prefix (e.g., `/user/first`) unless `addModelPrefix: false`, and any `customUrlPrefix`.

## groupBy

The `groupBy` operation requires `orderBy` when using `skip` or `take`. The response contains only the fields specified in `by` plus any requested aggregates — it does not include all scalar fields on the model.

## Configuration

```ts
interface RouteConfig {
  enableAll?: boolean
  addModelPrefix?: boolean // default: true
  customUrlPrefix?: string
  specBasePath?: string
  disableOpenApi?: boolean
  scalarCdnUrl?: string

  openApiTitle?: string
  openApiDescription?: string
  openApiVersion?: string
  openApiServers?: OpenApiServerConfig[]
  openApiSecuritySchemes?: Record<string, OpenApiSecuritySchemeConfig>
  openApiSecurity?: Record<string, string[]>[]

  guard?: {
    resolveVariant?: (c: Context) => string | undefined
    variantHeader?: string // default: 'x-api-variant'
  }

  queryBuilder?: QueryBuilderConfig | false

  pagination?: {
    defaultLimit?: number // applied when take is not provided
    maxLimit?: number // caps |take| to this value (applies to both positive and negative take)
  }

  // per-operation config
  findMany?: OperationConfig
  create?: OperationConfig
  createManyAndReturn?: OperationConfig
  updateManyAndReturn?: OperationConfig
  // ... all operations
}

interface OpenApiServerConfig {
  url: string
  description?: string
}

interface OpenApiSecuritySchemeConfig {
  type: string
  scheme?: string
  bearerFormat?: string
  name?: string
  in?: string
  description?: string
}

interface QueryBuilderConfig {
  enabled?: boolean // default: true
  port?: number
  host?: string
  schemaPath?: string
  databaseUrl?: string
}

interface OperationConfig {
  before?: HonoMiddleware[]
  after?: HonoMiddleware[]
  shape?: Record<string, any>
}
```

`customUrlPrefix` is normalized to ensure a leading slash and strip trailing slashes. A value like `'api/v1'` becomes `'/api/v1'`.

`specBasePath` controls the base path used in OpenAPI spec paths and docs examples, independent of `customUrlPrefix`. Use this when your router is mounted under a parent path that `customUrlPrefix` cannot account for.

`scalarCdnUrl` overrides the default Scalar API Reference CDN URL used in the interactive documentation UI.

`openApiTitle`, `openApiDescription`, and `openApiVersion` set the corresponding fields in the generated OpenAPI spec's `info` object. They default to `{ModelName} API`, empty string, and `1.0.0` respectively.

`openApiServers` sets the `servers` array in the OpenAPI spec. Use this to specify the base URL for your API:

```ts
UserRouter({
  enableAll: true,
  openApiServers: [
    { url: 'https://api.example.com/v1', description: 'Production' },
  ],
})
```

`openApiSecuritySchemes` and `openApiSecurity` set the `securitySchemes` component and global `security` requirement in the OpenAPI spec:

```ts
UserRouter({
  enableAll: true,
  openApiSecuritySchemes: {
    bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
  },
  openApiSecurity: [{ bearerAuth: [] }],
})
```

`docsUi` sets the default documentation view for per-model docs endpoints. Valid values: `'docs'` (contract view, default), `'scalar'` (interactive UI), `'json'`, `'yaml'`, `'playground'`. The `?ui=` query parameter overrides this setting at request time.

Query builder configuration is global — when multiple routers are mounted, the first router's query builder config takes effect and subsequent routers reuse the same instance. Set `queryBuilder: false` to disable the query builder entirely, or `queryBuilder: { enabled: false }` to disable it while keeping the configuration for later use.

## Body size limits

The generated handlers do not enforce request body size limits. Add Hono's body limit middleware for production use:

```ts
import { bodyLimit } from 'hono/body-limit'

app.use('*', bodyLimit({ maxSize: 1024 * 1024 })) // 1MB
```

## Environment variables

| Variable          | Default | Description                         |
| ----------------- | ------- | ----------------------------------- |
| `DISABLE_OPENAPI` | `false` | Disable OpenAPI endpoints           |
| `NODE_ENV`        | -       | Set to `production` to disable docs |
| `DEBUG`           | `false` | Enable prisma-sql debug logging     |

**Edge runtime note:** On Cloudflare Workers and other runtimes where `process` is undefined, environment variables listed above are not accessible. Use the `RouteConfig` object for all configuration on edge runtimes. For example, use `disableOpenApi: true` in RouteConfig instead of the `DISABLE_OPENAPI` environment variable. The query builder feature (which depends on Node.js APIs) is automatically unavailable on edge runtimes — the dynamic import fails silently and the router operates normally without it. To suppress the import attempt entirely, set `queryBuilder: false` in your RouteConfig.

## License

MIT
