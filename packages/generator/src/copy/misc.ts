export const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

export function isSafeKey(key: string): boolean {
  return !UNSAFE_KEYS.has(key)
}

export function sanitizeKeys<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(sanitizeKeys) as T
  }
  if (isObject(value)) {
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(value)) {
      if (!isSafeKey(key)) continue
      result[key] = sanitizeKeys((value as Record<string, unknown>)[key])
    }
    return result as T
  }
  return value
}
