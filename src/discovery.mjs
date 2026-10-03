import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { normalizeRelativePath, toPosix } from './path-utils.mjs'

const escapeRegExp = (value) => value.replace(/[.*+?^()|[\]\\]/g, '\\$&')

export const globToRegExp = (pattern) => {
  const normalized = normalizeRelativePath(pattern)
  const segments = normalized.split('/')
  let source = '^'

  segments.forEach((segment, index) => {
    const isLast = index === segments.length - 1
    if (segment === '**') {
      source += isLast ? '(?:.*)?' : '(?:[^/]+/)*'
      return
    }

    let segmentSource = ''
    for (const character of segment) {
      if (character === '*') segmentSource += '[^/]*'
      else if (character === '?') segmentSource += '[^/]'
      else segmentSource += escapeRegExp(character)
    }
    source += segmentSource
    if (!isLast) source += '/'
  })

  return new RegExp(source + '$')
}

const matchesAny = (relativePath, patterns) => patterns.some((pattern) => globToRegExp(pattern).test(relativePath))

const walk = (directory, root, output = []) => {
  if (!existsSync(directory) || !statSync(directory).isDirectory()) return output
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = path.join(directory, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) walk(absolute, root, output)
    else if (entry.isFile()) output.push(toPosix(path.relative(root, absolute)))
  }
  return output
}

export const discoverDocs = ({ docsRoot, include, exclude, registered = [] }) => {
  const files = walk(docsRoot.absolute, docsRoot.absolute)
    .filter((relativePath) => matchesAny(relativePath, include))
    .filter((relativePath) => !matchesAny(relativePath, exclude))
  const registeredSet = new Set(registered.map(normalizeRelativePath))
  return {
    files,
    registered: files.filter((relativePath) => registeredSet.has(relativePath)),
    unregistered: files.filter((relativePath) => !registeredSet.has(relativePath)),
  }
}

export const registeredManifestPaths = ({ manifest, paths }) => {
  const values = []
  for (const entry of manifest.entries) {
    for (const key of ['source', 'artifact', 'path']) {
      if (entry[key]) values.push(entry[key])
    }
  }

  const docsRoot = paths.docsRoot.absolute
  for (const item of [paths.manifest.absolute, paths.output.absolute, paths.readme.absolute]) {
    if (item === docsRoot || !item.startsWith(docsRoot + path.sep)) continue
    values.push(toPosix(path.relative(docsRoot, item)))
  }
  return [...new Set(values.map(normalizeRelativePath))]
}
