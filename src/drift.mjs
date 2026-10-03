import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { normalizeRelativePath, toPosix } from './path-utils.mjs'

const runGit = (root, args) => {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

const globToRegExp = (pattern) => {
  const escaped = normalizeRelativePath(pattern)
    .split('*')
    .map((part) => part.replace(/[.*+?^()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp('^' + escaped + '$')
}

const matchesWatchPath = (filePath, watchPath) => {
  const normalizedFile = normalizeRelativePath(filePath)
  const normalizedWatch = normalizeRelativePath(watchPath)
  if (normalizedWatch.includes('*')) return globToRegExp(normalizedWatch).test(normalizedFile)
  return normalizedFile === normalizedWatch
    || normalizedFile.startsWith(normalizedWatch.endsWith('/') ? normalizedWatch : normalizedWatch + '/')
}

const changedPaths = (root, revision) => {
  const result = new Set()
  const diff = runGit(root, ['diff', '--name-only', revision])
  for (const item of diff.split(/\r?\n/).filter(Boolean)) result.add(normalizeRelativePath(item))
  const status = runGit(root, ['status', '--porcelain=v1', '--untracked-files=all'])
  for (const line of status.split(/\r?\n/).filter(Boolean)) {
    const item = line.slice(3).trim()
    if (!item) continue
    result.add(normalizeRelativePath(item.split(' -> ').pop()))
  }
  return [...result]
}

const sourceRevision = (entry, paths) => {
  if (typeof entry.revision === 'string') return entry.revision
  if (!entry.source) return null
  const sourcePath = path.join(paths.docsRoot.absolute, ...entry.source.split('/'))
  if (!existsSync(sourcePath) || !sourcePath.endsWith('.json')) return null
  try {
    const source = JSON.parse(readFileSync(sourcePath, 'utf8'))
    return source?.meta?.repository?.revision || null
  } catch {
    return null
  }
}

export const collectDrift = ({ root, paths, manifest }, { enabled = true, strict = false } = {}) => {
  if (!enabled) return { enabled: false, affected: [], errors: [], warnings: [], infos: [] }
  const head = runGit(root, ['rev-parse', 'HEAD'])
  if (!head) {
    return {
      enabled: true,
      affected: [],
      errors: [],
      warnings: ['Unable to read the current Git revision; drift check skipped'],
      infos: [],
    }
  }

  const affected = []
  const warnings = []
  const errors = []
  const infos = []
  for (const entry of manifest.entries) {
    if (!['active', 'needs-refresh'].includes(entry.status)) continue
    const revision = sourceRevision(entry, paths)
    if (!revision || revision === head) continue
    const watchPaths = Array.isArray(entry.watch_paths) ? entry.watch_paths : []
    const watchedChanges = changedPaths(root, revision)
      .filter((filePath) => watchPaths.some((watchPath) => matchesWatchPath(filePath, watchPath)))
    if (watchedChanges.length === 0) {
      infos.push(entry.id + ' is older than HEAD but no watched path changed')
      continue
    }
    const item = {
      id: entry.id,
      revision,
      changed_paths: watchedChanges.map(toPosix),
    }
    affected.push(item)
    const message = entry.id + ' is bound to ' + revision.slice(0, 12)
      + '; watched files changed: ' + watchedChanges.join(', ')
    if (strict) errors.push('Drift: ' + message)
    else warnings.push('Drift: ' + message)
  }

  return { enabled: true, head, affected, errors, warnings, infos }
}
