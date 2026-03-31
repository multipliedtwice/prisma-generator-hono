import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { PrismaClient } from '../prisma/generated/client'
import Database from 'better-sqlite3'
import { orderItemRouter } from '../prisma/generated/hono/orderItem/orderItemRouter'
import { UserAccountRouter } from '../prisma/generated/hono/UserAccount/UserAccountRouter'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

import {
  generateCombinedDocs,
  registerModelDocs,
} from '../prisma/generated/hono/combinedDocs'
import type {
  HonoMiddleware,
  RouteConfig,
} from '../prisma/generated/hono/routeConfig'

type Variables = {
  prisma: PrismaClient
  sqlite: Database.Database
}

const app = new Hono<{ Variables: Variables }>()

const dbPath = './prisma/dev.db'
const sqlite = new Database(dbPath)
const connectionString = `'file:./prisma/dev.db'`
const adapter = new PrismaBetterSqlite3({ url: connectionString })
const prisma = new PrismaClient({ adapter })

app.use('*', async (c, next) => {
  c.set('prisma', prisma)
  c.set('sqlite', sqlite)
  await next()
})

app.use('*', async (c, next) => {
  const start = Date.now()
  console.log(`→ ${c.req.method} ${c.req.path}`)
  await next()
  const ms = Date.now() - start
  console.log(`← ${c.req.method} ${c.req.path} - ${c.res.status} [${ms}ms]`)
})

const setUserRole: HonoMiddleware = async (c, next) => {
  const authHeader = c.req.header('authorization')
  const role = authHeader?.includes('admin')
    ? 'admin'
    : authHeader?.includes('manager')
      ? 'manager'
      : 'user'

  c.req.raw.headers.set('x-api-variant', role)
  console.log(`  [Auth] Variant set to: ${role}`)
  await next()
}

const ordersConfig: RouteConfig = {
  addModelPrefix: false,
  customUrlPrefix: '',

  guard: {
    variantHeader: 'x-api-variant',
  },

  findMany: {
    before: [setUserRole],
    shape: {
      user: {
        select: {
          ProductName: true,
          quantity: true,
          price: true,
          userID: true,
        },
      },
      manager: {
        select: {
          ProductName: true,
          quantity: true,
          price: true,
          cost_price: true,
          userID: true,
        },
      },
      admin: {},
    },
  },

  create: {
    before: [setUserRole],
    shape: {
      user: {
        data: {
          ProductName: true,
          quantity: true,
          userID: true,
        },
      },
      manager: {
        data: {
          ProductName: true,
          quantity: true,
          price: true,
          userID: true,
        },
      },
      admin: {
        data: {
          ProductName: true,
          quantity: true,
          price: true,
          cost_price: true,
          userID: true,
        },
      },
    },
  },
}

const usersConfig: RouteConfig = {
  enableAll: true,
  addModelPrefix: false,
  customUrlPrefix: '',

  findMany: {
    shape: {
      select: {
        id: true,
        email: true,
        name: true,
      },
    },
  },

  pagination: {
    defaultLimit: 20,
    maxLimit: 100,
  },
}

console.log('\n╔════════════════════════════════════════╗')
console.log('║     Creating Routers                   ║')
console.log('╚════════════════════════════════════════╝\n')

const orderRouter = orderItemRouter(ordersConfig)
const userRouter = UserAccountRouter(usersConfig)

console.log('╔════════════════════════════════════════╗')
console.log('║     Mounting Routers                   ║')
console.log('╚════════════════════════════════════════╝')

app.route('/api/orders', orderRouter)
app.route('/api/users', userRouter)

console.log('  ✓ Mounted orderRouter at: /api/orders')
console.log('  ✓ Mounted userRouter at:  /api/users\n')

console.log('Registering documentation routes...')
registerModelDocs(app, '/docs', {
  orderItem: ordersConfig,
  UserAccount: usersConfig,
})

app.get(
  '/docs',
  generateCombinedDocs({
    title: 'Demo API Documentation',
    description: 'Role-based access control with guard shape enforcement',
  }),
)

app.get('/test', (c) => {
  return c.json({
    message: 'Test route works!',
    prisma: !!c.var.prisma,
    sqlite: !!c.var.sqlite,
  })
})

app.notFound((c) => {
  console.log(`❌ 404 Not Found: ${c.req.method} ${c.req.path}`)
  return c.text('404 Not Found', 404)
})

console.log(`
╔════════════════════════════════════════════════════════════════╗
║  Server Running                                                ║
╠════════════════════════════════════════════════════════════════╣
║  Server:          http://localhost:3000                        ║
║                                                                ║
║  Test Endpoints:                                               ║
║    curl http://localhost:3000/test                             ║
║    curl http://localhost:3000/api/orders                       ║
║    curl http://localhost:3000/api/users                        ║
║    curl http://localhost:3000/api/users/count                  ║
║                                                                ║
║  Documentation (auto-registered by router):                    ║
║    curl http://localhost:3000/api/orders/openapi.json          ║
║    curl http://localhost:3000/api/users/openapi.json           ║
║                                                                ║
║  Documentation (manually registered):                          ║
║    http://localhost:3000/docs                                  ║
║    http://localhost:3000/docs/orderitem                       ║
║    http://localhost:3000/docs/useraccount                     ║
║                                                                ║
║  Role-Based Access (Orders via guard shapes):                  ║
║    curl http://localhost:3000/api/orders \\                    ║
║      -H "authorization: Bearer user-token"                     ║
║    curl http://localhost:3000/api/orders \\                    ║
║      -H "authorization: Bearer admin-token"                    ║
╚════════════════════════════════════════════════════════════════╝
`)

serve({
  fetch: app.fetch,
  port: 3000,
})

process.on('SIGINT', async () => {
  console.log('\nShutting down...')
  await prisma.$disconnect()
  sqlite.close()
  process.exit(0)
})
