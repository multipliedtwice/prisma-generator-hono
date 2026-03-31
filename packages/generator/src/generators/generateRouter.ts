import { DMMF } from '@prisma/generator-helper'

export function generateRouterFunction({
  model,
  enums,
  relativeClientPath,
}: {
  model: DMMF.Model
  enums: DMMF.DatamodelEnum[]
  relativeClientPath: string
}): string {
  const modelName = model.name
  const modelNameLower = modelName.toLowerCase()
  const routerFunctionName = `${modelName}Router`

  const fieldsMeta = model.fields.map((f) => ({
    name: f.name,
    kind: f.kind,
    type: f.type,
    isList: f.isList,
    isRequired: f.isRequired,
    hasDefaultValue: f.hasDefaultValue,
    isUpdatedAt: f.isUpdatedAt ?? false,
    documentation: f.documentation,
    relationFromFields: f.relationFromFields,
  }))

  const referencedEnumTypes = new Set(
    model.fields.filter((f) => f.kind === 'enum').map((f) => f.type),
  )

  const enumsMeta = enums
    .filter((e) => referencedEnumTypes.has(e.name))
    .map((e) => ({
      name: e.name,
      values: e.values.map((v) => ({ name: v.name })),
    }))

  return `import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { PrismaClient } from '${relativeClientPath}'
import { 
  ${modelName}FindUnique,
  ${modelName}FindUniqueOrThrow,
  ${modelName}FindFirst,
  ${modelName}FindFirstOrThrow,
  ${modelName}FindMany,
  ${modelName}FindManyPaginated,
  ${modelName}Create,
  ${modelName}CreateMany,
  ${modelName}CreateManyAndReturn,
  ${modelName}Update,
  ${modelName}UpdateMany,
  ${modelName}UpdateManyAndReturn,
  ${modelName}Upsert,
  ${modelName}Delete,
  ${modelName}DeleteMany,
  ${modelName}Aggregate,
  ${modelName}Count,
  ${modelName}GroupBy
} from './${modelName}Handlers'
import type { RouteConfig, HonoMiddleware } from '../routeConfig'
import { parseQueryParams } from '../parseQueryParams'
import { buildModelOpenApi } from '../buildModelOpenApi'

const _env = typeof process !== 'undefined' && process.env ? process.env : {} as Record<string, string | undefined>

type ${modelName}Env = {
  Variables: {
    prisma: PrismaClient
    postgres?: any
    sqlite?: any
    parsedQuery?: any
    data?: any
    guardShape?: Record<string, any>
    guardCaller?: string
    routeConfig?: RouteConfig
  }
}

const MODEL_FIELDS = ${JSON.stringify(fieldsMeta, null, 2)} as const

const MODEL_ENUMS = ${JSON.stringify(enumsMeta, null, 2)} as const

const defaultOpConfig = {
  before: [] as HonoMiddleware[],
  after: [] as HonoMiddleware[],
}

function normalizePrefix(p: string): string {
  if (!p) return ''
  let result = p
  if (!result.startsWith('/')) result = '/' + result
  while (result.length > 1 && result.endsWith('/')) result = result.slice(0, -1)
  if (result === '/') return ''
  return result
}

function transformResult(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'bigint') return value.toString()
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    return value.toString('base64')
  }
  if (value instanceof Uint8Array) {
    let binary = ''
    for (let i = 0; i < value.length; i++) binary += String.fromCharCode(value[i])
    return btoa(binary)
  }
  if (value instanceof Date) return value
  if (Array.isArray(value)) return value.map(transformResult)
  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) return value
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = transformResult(v)
    }
    return out
  }
  return value
}

function jsonResponse(c: any, data: unknown, status: number = 200) {
  const body = JSON.stringify(transformResult(data))
  return c.body(body, status, { 'Content-Type': 'application/json' })
}

function isQueryBuilderEnabled(config: RouteConfig): boolean {
  if (config.queryBuilder === false) return false
  if (typeof config.queryBuilder === 'object' && config.queryBuilder.enabled === false) return false
  if (_env.NODE_ENV === 'production') return false
  return true
}

function getQueryBuilderConfig(config: RouteConfig) {
  if (config.queryBuilder === false) return null
  if (typeof config.queryBuilder === 'object') return config.queryBuilder
  return {}
}

export function ${routerFunctionName}(config: RouteConfig = {}) {
  const app = new Hono<${modelName}Env>()
  
  const customPrefix = normalizePrefix(config.customUrlPrefix || '')
  const modelPrefix = config.addModelPrefix !== false ? '/${modelNameLower}' : ''
  const basePath = customPrefix + modelPrefix

  const openApiDisabled = config.disableOpenApi === true
    || (config.disableOpenApi !== false && (
      _env.DISABLE_OPENAPI === 'true'
      || _env.NODE_ENV === 'production'
    ))

  const qbEnabled = isQueryBuilderEnabled(config)

  if (qbEnabled) {
    const qbConfig = getQueryBuilderConfig(config)
    if (qbConfig) {
      import('../queryBuilder').then(mod => mod.startQueryBuilder(qbConfig)).catch(() => {})
    }
  }

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ message: err.message }, err.status)
    }
    console.error('[prisma-generator-hono] Unhandled error:', err)
    return c.json({ message: 'Internal server error' }, 500)
  })

  const parseQuery: HonoMiddleware = async (c, next) => {
    const rawQuery = c.req.query()
    if (rawQuery && Object.keys(rawQuery).length > 0) {
      c.set('parsedQuery', parseQueryParams(rawQuery))
    }
    await next()
  }

  const setShape = (opConfig: any): HonoMiddleware => {
    return async (c, next) => {
      c.set('routeConfig', config)
      if (opConfig.shape) {
        c.set('guardShape', opConfig.shape)
        const caller = config.guard?.resolveVariant?.(c)
          ?? c.req.header(config.guard?.variantHeader || 'x-api-variant')
          ?? undefined
        if (caller) {
          c.set('guardCaller', caller)
        }
      }
      await next()
    }
  }

  const respond: HonoMiddleware = async (c) => {
    const data = c.get('data')
    if (data === undefined) {
      throw new HTTPException(500, { message: 'No data set by handler' })
    }
    return jsonResponse(c, data)
  }

  const respondCreated: HonoMiddleware = async (c) => {
    const data = c.get('data')
    if (data === undefined) {
      throw new HTTPException(500, { message: 'No data set by handler' })
    }
    return jsonResponse(c, data, 201)
  }

  if (!openApiDisabled) {
    const openapiJsonPath = basePath ? \`\${basePath}/openapi.json\` : '/openapi.json'
    const openapiYamlPath = basePath ? \`\${basePath}/openapi.yaml\` : '/openapi.yaml'
    
    app.get(openapiJsonPath, (c) => {
      const spec = buildModelOpenApi(
        '${modelName}',
        MODEL_FIELDS as any,
        MODEL_ENUMS as any,
        config,
        { format: 'json' }
      )
      return c.json(spec)
    })

    app.get(openapiYamlPath, (c) => {
      const spec = buildModelOpenApi(
        '${modelName}',
        MODEL_FIELDS as any,
        MODEL_ENUMS as any,
        config,
        { format: 'yaml' }
      )
      return c.text(spec as string, 200, { 'Content-Type': 'application/yaml' })
    })
  }

  if (config.enableAll || config.findFirst) {
    const opConfig = config.findFirst || defaultOpConfig
    const { before = [], after = [] } = opConfig
    const path = basePath ? \`\${basePath}/first\` : '/first'
    app.get(path, parseQuery, setShape(opConfig), ...before, ${modelName}FindFirst, ...after, respond)
  }

  if (config.enableAll || config.findFirstOrThrow) {
    const opConfig = config.findFirstOrThrow || defaultOpConfig
    const { before = [], after = [] } = opConfig
    const path = basePath ? \`\${basePath}/first/strict\` : '/first/strict'
    app.get(path, parseQuery, setShape(opConfig), ...before, ${modelName}FindFirstOrThrow, ...after, respond)
  }

  if (config.enableAll || config.findManyPaginated) {
    const opConfig = config.findManyPaginated || defaultOpConfig
    const { before = [], after = [] } = opConfig
    const path = basePath ? \`\${basePath}/paginated\` : '/paginated'
    app.get(path, parseQuery, setShape(opConfig), ...before, ${modelName}FindManyPaginated, ...after, respond)
  }

  if (config.enableAll || config.aggregate) {
    const opConfig = config.aggregate || defaultOpConfig
    const { before = [], after = [] } = opConfig
    const path = basePath ? \`\${basePath}/aggregate\` : '/aggregate'
    app.get(path, parseQuery, setShape(opConfig), ...before, ${modelName}Aggregate, ...after, respond)
  }

  if (config.enableAll || config.count) {
    const opConfig = config.count || defaultOpConfig
    const { before = [], after = [] } = opConfig
    const path = basePath ? \`\${basePath}/count\` : '/count'
    app.get(path, parseQuery, setShape(opConfig), ...before, ${modelName}Count, ...after, respond)
  }

  if (config.enableAll || config.groupBy) {
    const opConfig = config.groupBy || defaultOpConfig
    const { before = [], after = [] } = opConfig
    const path = basePath ? \`\${basePath}/groupby\` : '/groupby'
    app.get(path, parseQuery, setShape(opConfig), ...before, ${modelName}GroupBy, ...after, respond)
  }

  if (config.enableAll || config.findUniqueOrThrow) {
    const opConfig = config.findUniqueOrThrow || defaultOpConfig
    const { before = [], after = [] } = opConfig
    const path = basePath ? \`\${basePath}/unique/strict\` : '/unique/strict'
    app.get(path, parseQuery, setShape(opConfig), ...before, ${modelName}FindUniqueOrThrow, ...after, respond)
  }

  if (config.enableAll || config.findUnique) {
    const opConfig = config.findUnique || defaultOpConfig
    const { before = [], after = [] } = opConfig
    const path = basePath ? \`\${basePath}/unique\` : '/unique'
    app.get(path, parseQuery, setShape(opConfig), ...before, ${modelName}FindUnique, ...after, respond)
  }

  if (config.enableAll || config.findMany) {
    const opConfig = config.findMany || defaultOpConfig
    const { before = [], after = [] } = opConfig
    const path = basePath || '/'
    app.get(path, parseQuery, setShape(opConfig), ...before, ${modelName}FindMany, ...after, respond)
  }

  if (config.enableAll || config.createManyAndReturn) {
    const opConfig = config.createManyAndReturn || defaultOpConfig
    const { before = [], after = [] } = opConfig
    const path = basePath ? \`\${basePath}/many/return\` : '/many/return'
    app.post(path, setShape(opConfig), ...before, ${modelName}CreateManyAndReturn, ...after, respondCreated)
  }

  if (config.enableAll || config.createMany) {
    const opConfig = config.createMany || defaultOpConfig
    const { before = [], after = [] } = opConfig
    const path = basePath ? \`\${basePath}/many\` : '/many'
    app.post(path, setShape(opConfig), ...before, ${modelName}CreateMany, ...after, respondCreated)
  }

  if (config.enableAll || config.create) {
    const opConfig = config.create || defaultOpConfig
    const { before = [], after = [] } = opConfig
    const path = basePath || '/'
    app.post(path, setShape(opConfig), ...before, ${modelName}Create, ...after, respondCreated)
  }

  if (config.enableAll || config.updateManyAndReturn) {
    const opConfig = config.updateManyAndReturn || defaultOpConfig
    const { before = [], after = [] } = opConfig
    const path = basePath ? \`\${basePath}/many/return\` : '/many/return'
    app.put(path, setShape(opConfig), ...before, ${modelName}UpdateManyAndReturn, ...after, respond)
  }

  if (config.enableAll || config.updateMany) {
    const opConfig = config.updateMany || defaultOpConfig
    const { before = [], after = [] } = opConfig
    const path = basePath ? \`\${basePath}/many\` : '/many'
    app.put(path, setShape(opConfig), ...before, ${modelName}UpdateMany, ...after, respond)
  }

  if (config.enableAll || config.update) {
    const opConfig = config.update || defaultOpConfig
    const { before = [], after = [] } = opConfig
    const path = basePath || '/'
    app.put(path, setShape(opConfig), ...before, ${modelName}Update, ...after, respond)
  }

  if (config.enableAll || config.upsert) {
    const opConfig = config.upsert || defaultOpConfig
    const { before = [], after = [] } = opConfig
    const path = basePath || '/'
    app.patch(path, setShape(opConfig), ...before, ${modelName}Upsert, ...after, respond)
  }

  if (config.enableAll || config.deleteMany) {
    const opConfig = config.deleteMany || defaultOpConfig
    const { before = [], after = [] } = opConfig
    const path = basePath ? \`\${basePath}/many\` : '/many'
    app.delete(path, setShape(opConfig), ...before, ${modelName}DeleteMany, ...after, respond)
  }

  if (config.enableAll || config.delete) {
    const opConfig = config.delete || defaultOpConfig
    const { before = [], after = [] } = opConfig
    const path = basePath || '/'
    app.delete(path, setShape(opConfig), ...before, ${modelName}Delete, ...after, respond)
  }

  return app
}
`
}
