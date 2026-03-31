import { DMMF } from '@prisma/generator-helper'

export interface UnifiedHandlerOptions {
  model: DMMF.Model
  prismaImportStatement: string
}

export function generateUnifiedHandler(options: UnifiedHandlerOptions): string {
  const { model, prismaImportStatement } = options

  const modelName = model.name
  const modelNameLower = modelName.charAt(0).toLowerCase() + modelName.slice(1)

  const importPath =
    prismaImportStatement.match(/from ['"](.+?)['"]/)?.[1] || ''

  return `
import { Prisma, PrismaClient } from '${importPath}'
import type { Context, Next } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { sanitizeKeys } from '../misc'

const _env = typeof process !== 'undefined' && process.env ? process.env : {} as Record<string, string | undefined>

let _speedExtension: ((opts: any) => any) | null = null

const _prismasqlModule = 'prisma-' + 'sql'
const _prismasqlReady = (async () => {
  try {
    const mod = await import(_prismasqlModule)
    _speedExtension = mod.speedExtension ?? mod.default?.speedExtension ?? null
  } catch (err: any) {
    const code = err?.code
    if (code !== 'MODULE_NOT_FOUND' && code !== 'ERR_MODULE_NOT_FOUND') {
      console.warn('[prisma-generator-hono] prisma-sql initialization failed:', err)
    }
  }
})()

const _extendedClients = new WeakMap<object, WeakMap<object, PrismaClient>>()

const DISTINCT_COUNT_LIMIT = 100000

type ${modelName}Env = {
  Variables: {
    prisma: PrismaClient
    postgres?: any
    sqlite?: any
    parsedQuery?: any
    data?: any
    guardShape?: Record<string, any>
    guardCaller?: string
    routeConfig?: any
  }
}

const PRISMA_ERROR_MAP: Record<string, { status: number; message: string }> = {
  P2000: { status: 400, message: 'Value too long for column' },
  P2001: { status: 404, message: 'Record not found' },
  P2002: { status: 409, message: 'Unique constraint violation' },
  P2003: { status: 400, message: 'Foreign key constraint failed' },
  P2004: { status: 400, message: 'Constraint failed on the database' },
  P2005: { status: 400, message: 'Invalid field value' },
  P2006: { status: 400, message: 'Invalid value provided' },
  P2007: { status: 400, message: 'Data validation error' },
  P2008: { status: 400, message: 'Failed to parse the query' },
  P2009: { status: 400, message: 'Failed to validate the query' },
  P2010: { status: 500, message: 'Raw query failed' },
  P2011: { status: 400, message: 'Null constraint violation' },
  P2012: { status: 400, message: 'Missing required value' },
  P2013: { status: 400, message: 'Missing required argument' },
  P2014: { status: 400, message: 'Required relation violation' },
  P2015: { status: 404, message: 'Related record not found' },
  P2016: { status: 400, message: 'Query interpretation error' },
  P2017: { status: 400, message: 'Records not connected' },
  P2018: { status: 404, message: 'Required connected record not found' },
  P2019: { status: 400, message: 'Input error' },
  P2020: { status: 400, message: 'Value out of range for the field type' },
  P2021: { status: 500, message: 'Table does not exist in the database' },
  P2022: { status: 500, message: 'Column does not exist in the database' },
  P2023: { status: 500, message: 'Inconsistent column data' },
  P2024: { status: 503, message: 'Connection pool timeout' },
  P2025: { status: 404, message: 'Record not found' },
  P2026: { status: 501, message: 'Feature not supported by the current database provider' },
  P2028: { status: 500, message: 'Transaction API error' },
  P2030: { status: 400, message: 'Cannot find a fulltext index for the search' },
  P2033: { status: 400, message: 'Number out of range for the field type' },
  P2034: { status: 409, message: 'Transaction conflict, please retry' },
}

async function getExtendedClient(c: Context): Promise<PrismaClient> {
  const base = c.var.prisma
  if (!base) {
    throw new HTTPException(500, {
      message: 'PrismaClient not found in context. Set c.var.prisma in middleware.'
    })
  }

  await _prismasqlReady

  if (!_speedExtension) return base

  const connector = c.var.postgres || c.var.sqlite
  if (!connector) return base

  if (typeof connector === 'object' && connector !== null) {
    const innerMap = _extendedClients.get(connector)
    if (innerMap) {
      const cached = innerMap.get(base)
      if (cached) return cached
    }
  }

  try {
    const extended = base.$extends(_speedExtension({
      postgres: c.var.postgres,
      sqlite: c.var.sqlite,
      debug: _env.DEBUG === 'true'
    })) as unknown as PrismaClient

    if (typeof connector === 'object' && connector !== null) {
      let innerMap = _extendedClients.get(connector)
      if (!innerMap) {
        innerMap = new WeakMap<object, PrismaClient>()
        _extendedClients.set(connector, innerMap)
      }
      innerMap.set(base, extended)
    }

    return extended
  } catch (error) {
    console.warn('[speedExtension] Failed to initialize, using base client:', error)
    return base
  }
}

function handleError(error: unknown): never {
  if (error instanceof HTTPException) throw error

  if (error && typeof error === 'object' && 'name' in error && error.name === 'ShapeError') {
    throw new HTTPException(400, { message: (error as Error).message })
  }

  if (error && typeof error === 'object' && 'name' in error && error.name === 'CallerError') {
    throw new HTTPException(400, { message: (error as Error).message })
  }

  if (error && typeof error === 'object' && 'name' in error && error.name === 'PolicyError') {
    throw new HTTPException(403, { message: (error as Error).message })
  }

  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as any).code as string
    const mapped = PRISMA_ERROR_MAP[code]
    if (mapped) {
      throw new HTTPException(mapped.status, { message: mapped.message })
    }
    if (typeof code === 'string' && code.startsWith('P')) {
      throw new HTTPException(500, { message: 'Database operation failed' })
    }
  }

  if (error && typeof error === 'object' && 'name' in error) {
    const name = (error as any).name
    if (name === 'PrismaClientValidationError') {
      throw new HTTPException(400, { message: 'Invalid query parameters' })
    }
  }

  console.error('[prisma-generator-hono] Unhandled error:', error)
  throw new HTTPException(500, { message: 'Internal server error' })
}

function assertGuard(delegate: any): void {
  if (typeof delegate.guard !== 'function') {
    throw new HTTPException(500, {
      message: 'Guard shapes require prisma-guard extension on PrismaClient. Install: npm install prisma-guard, then extend your client with guardExtension().'
    })
  }
}

async function safeParseBody(c: Context): Promise<Record<string, any>> {
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    throw new HTTPException(400, { message: 'Invalid JSON in request body' })
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new HTTPException(400, { message: 'Request body must be a JSON object' })
  }
  return sanitizeKeys(raw as Record<string, any>)
}

function requireBodyField(body: Record<string, any>, field: string): void {
  if (!(field in body) || body[field] === undefined) {
    throw new HTTPException(400, { message: 'Missing required field: ' + field })
  }
}

function applyPaginationLimits(query: Record<string, any>, c: Context): Record<string, any> {
  const routeConfig = c.get('routeConfig')
  const pagination = routeConfig?.pagination
  if (!pagination) return query

  const result = { ...query }

  if (result.take === undefined && pagination.defaultLimit !== undefined) {
    result.take = pagination.defaultLimit
  }

  if (pagination.maxLimit !== undefined && result.take !== undefined) {
    const takeNum = Number(result.take)
    if (Math.abs(takeNum) > pagination.maxLimit) {
      result.take = takeNum < 0 ? -pagination.maxLimit : pagination.maxLimit
    }
  }

  return result
}

function normalizeDistinct(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string')
  return []
}

${generateReadHandlers(modelName, modelNameLower)}

${generateWriteHandlers(modelName, modelNameLower)}
`
}

function generateReadHandlers(
  modelName: string,
  modelNameLower: string,
): string {
  const standardReadOps = [
    'findFirst',
    'findUnique',
    'findUniqueOrThrow',
    'findFirstOrThrow',
    'count',
    'aggregate',
    'groupBy',
  ]

  const standardHandlers = standardReadOps
    .map((op) => {
      const functionName = `${modelName}${op.charAt(0).toUpperCase() + op.slice(1)}`

      return `
export async function ${functionName}(
  c: Context<${modelName}Env>,
  next: Next
) {
  try {
    const query = c.get('parsedQuery') || {}
    const extended = await getExtendedClient(c)
    const shape = c.get('guardShape')

    let data
    if (shape) {
      assertGuard(extended.${modelNameLower})
      const caller = c.get('guardCaller')
      data = await extended.${modelNameLower}.guard(shape, caller).${op}(query)
    } else {
      data = await extended.${modelNameLower}.${op}(query)
    }

    c.set('data', data)
    await next()
  } catch (error: unknown) {
    handleError(error)
  }
}
`
    })
    .join('\n')

  const findManyHandler = `
export async function ${modelName}FindMany(
  c: Context<${modelName}Env>,
  next: Next
) {
  try {
    const rawQuery = c.get('parsedQuery') || {}
    const query = applyPaginationLimits(rawQuery, c)
    const extended = await getExtendedClient(c)
    const shape = c.get('guardShape')

    let data
    if (shape) {
      assertGuard(extended.${modelNameLower})
      const caller = c.get('guardCaller')
      data = await extended.${modelNameLower}.guard(shape, caller).findMany(query)
    } else {
      data = await extended.${modelNameLower}.findMany(query)
    }

    c.set('data', data)
    await next()
  } catch (error: unknown) {
    handleError(error)
  }
}
`

  return findManyHandler + '\n' + standardHandlers
}

function generateWriteHandlers(
  modelName: string,
  modelNameLower: string,
): string {
  const writeOps: {
    name: string
    method: string
    requiredFields?: string[]
  }[] = [
    { name: 'Create', method: 'create' },
    { name: 'CreateMany', method: 'createMany' },
    { name: 'CreateManyAndReturn', method: 'createManyAndReturn' },
    { name: 'Update', method: 'update' },
    {
      name: 'UpdateMany',
      method: 'updateMany',
      requiredFields: ['where', 'data'],
    },
    {
      name: 'UpdateManyAndReturn',
      method: 'updateManyAndReturn',
      requiredFields: ['where', 'data'],
    },
    { name: 'Delete', method: 'delete' },
    { name: 'DeleteMany', method: 'deleteMany', requiredFields: ['where'] },
    { name: 'Upsert', method: 'upsert' },
  ]

  return (
    writeOps
      .map((op) => {
        const functionName = `${modelName}${op.name}`
        const validationLines = (op.requiredFields || [])
          .map((field) => `    requireBodyField(body, '${field}')`)
          .join('\n')

        return `
export async function ${functionName}(c: Context<${modelName}Env>, next: Next) {
  try {
    const body = await safeParseBody(c)
${validationLines ? validationLines + '\n' : ''}    const extended = await getExtendedClient(c)
    const shape = c.get('guardShape')

    let data
    if (shape) {
      assertGuard(extended.${modelNameLower})
      const caller = c.get('guardCaller')
      data = await extended.${modelNameLower}.guard(shape, caller).${op.method}(body)
    } else {
      data = await extended.${modelNameLower}.${op.method}(body)
    }

    c.set('data', data)
    await next()
  } catch (error: unknown) {
    handleError(error)
  }
}
`
      })
      .join('\n') +
    `

async function countForPagination(
  delegate: any,
  query: Record<string, any>,
  shape: Record<string, any> | undefined,
  caller: string | undefined,
): Promise<number> {
  const distinctFields = normalizeDistinct(query.distinct)
  const hasDistinct = distinctFields.length > 0

  if (hasDistinct) {
    const selectField = distinctFields[0]
    const distinctArgs: Record<string, any> = {
      where: query.where,
      distinct: distinctFields,
      select: { [selectField]: true },
      take: DISTINCT_COUNT_LIMIT + 1,
    }

    const results = shape
      ? await delegate.guard(shape, caller).findMany(distinctArgs)
      : await delegate.findMany(distinctArgs)

    if (results.length > DISTINCT_COUNT_LIMIT) {
      console.warn('[prisma-generator-hono] Distinct count exceeds ' + DISTINCT_COUNT_LIMIT + ', falling back to approximate total')
      const countArgs: Record<string, any> = {}
      if (query.where) countArgs.where = query.where
      return shape
        ? await delegate.guard(shape, caller).count(countArgs)
        : await delegate.count(countArgs)
    }

    return results.length
  }

  const countArgs: Record<string, any> = {}
  if (query.where) countArgs.where = query.where

  return shape
    ? await delegate.guard(shape, caller).count(countArgs)
    : await delegate.count(countArgs)
}

export async function ${modelName}FindManyPaginated(c: Context<${modelName}Env>, next: Next) {
  try {
    const rawQuery = c.get('parsedQuery') || {}
    const query = applyPaginationLimits(rawQuery, c)
    const extended = await getExtendedClient(c)
    const shape = c.get('guardShape')
    const caller = c.get('guardCaller')

    if (shape) {
      assertGuard(extended.${modelNameLower})
    }

    let items: any[]
    let total: number

    if (typeof extended.$transaction === 'function') {
      try {
        const txResult = await extended.$transaction(async (tx: any) => {
          const d = shape
            ? await tx.${modelNameLower}.guard(shape, caller).findMany(query)
            : await tx.${modelNameLower}.findMany(query)
          const t = await countForPagination(tx.${modelNameLower}, query, shape, caller)
          return { d, t }
        })
        items = txResult.d
        total = txResult.t
      } catch (txError: any) {
        if (
          txError?.message?.includes?.('interactive transactions') ||
          txError?.code === 'P2028'
        ) {
          console.warn('[prisma-generator-hono] Interactive transactions not available, pagination queries are non-atomic')
          items = shape
            ? await extended.${modelNameLower}.guard(shape, caller).findMany(query)
            : await extended.${modelNameLower}.findMany(query)
          total = await countForPagination(extended.${modelNameLower}, query, shape, caller)
        } else {
          throw txError
        }
      }
    } else {
      items = shape
        ? await extended.${modelNameLower}.guard(shape, caller).findMany(query)
        : await extended.${modelNameLower}.findMany(query)
      total = await countForPagination(extended.${modelNameLower}, query, shape, caller)
    }

    const skip = (query.skip as number) ?? 0
    const absTake = Math.abs((query.take as number) ?? items.length)
    const hasMore = items.length >= absTake && skip + items.length < total

    c.set('data', { data: items, total, hasMore })
    await next()
  } catch (error: unknown) {
    handleError(error)
  }
}
`
  )
}
