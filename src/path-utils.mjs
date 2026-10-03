import path from 'node:path'

export const toPosix = (value) => String(value).replaceAll('\\', '/')

export const normalizeRelativePath = (value) => {
  if (typeof value !== 'string') return ''
  return toPosix(value).replace(/^\.\/+/, '')
}

const isWindowsAbsolute = (value) => /^[A-Za-z]:[\\/]/.test(value)

export const assertRelativePath = (value, label = 'path') => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(label + ' must be a non-empty relative path')
  }
  if (value.includes('\u0000') || path.isAbsolute(value) || isWindowsAbsolute(value)) {
    throw new Error(label + ' must be a relative path: ' + value)
  }

  const normalized = normalizeRelativePath(value)
  const segments = normalized.split('/')
  if (!normalized || segments.includes('..') || segments.some((segment) => segment === '')) {
    throw new Error(label + ' cannot contain empty or parent path segments: ' + value)
  }
  return normalized
}

export const isWithin = (root, candidate) => {
  const resolvedRoot = path.resolve(root)
  const resolvedCandidate = path.resolve(candidate)
  return resolvedCandidate === resolvedRoot
    || resolvedCandidate.startsWith(resolvedRoot + path.sep)
}

export const resolveProjectPath = (root, relativePath, label = 'path') => {
  const relative = assertRelativePath(relativePath, label)
  const absolute = path.resolve(root, ...relative.split('/'))
  if (!isWithin(root, absolute)) {
    throw new Error(label + ' must stay inside the project root: ' + relativePath)
  }
  return { absolute, relative }
}

export const resolveDocsPath = (root, docsRoot, relativePath, label = 'docs path') => {
  const relative = assertRelativePath(relativePath, label)
  const docsAbsolute = path.resolve(root, docsRoot)
  const absolute = path.resolve(docsAbsolute, ...relative.split('/'))
  if (!isWithin(docsAbsolute, absolute)) {
    throw new Error(label + ' must stay inside docsRoot: ' + relativePath)
  }
  return {
    absolute,
    relative,
    projectRelative: toPosix(path.relative(root, absolute)),
  }
}

export const relativeUrl = (fromFile, toFile) => {
  const relative = toPosix(path.relative(path.dirname(fromFile), toFile))
  return encodeURI(relative || path.basename(toFile))
}
