import { existsSync, statSync } from 'node:fs'
import { isActiveEntry, isPlannedEntry } from './manifest.mjs'
import { resolveDocsPath } from './path-utils.mjs'

const pathFields = (entry) => ['source', 'artifact', 'path']
  .filter((field) => typeof entry[field] === 'string' && entry[field].length > 0)

const addPathError = (errors, entry, field, error) => {
  errors.push(entry.id + ' ' + field + ': ' + error.message)
}

export const validateManifest = ({ root, paths, manifest }) => {
  const errors = []
  const warnings = []
  const infos = []

  if (!existsSync(paths.docsRoot.absolute) || !statSync(paths.docsRoot.absolute).isDirectory()) {
    errors.push('docsRoot does not exist or is not a directory: ' + paths.docsRoot.relative)
  }
  if (!existsSync(paths.readme.absolute)) {
    errors.push('Configured readme does not exist: ' + paths.readme.relative)
  }
  if (manifest.entries.length === 0) warnings.push('Manifest contains no entries')

  const entryIds = new Set()
  const pathOwners = new Map()
  for (const entry of manifest.entries) {
    if (entryIds.has(entry.id)) errors.push('Duplicate manifest entry id: ' + entry.id)
    entryIds.add(entry.id)
    if (!entry.status) errors.push(entry.id + ' is missing status')

    const hasSource = Boolean(entry.source)
    const hasArtifact = Boolean(entry.artifact)
    if (hasSource !== hasArtifact) {
      errors.push(entry.id + ' must declare source and artifact together')
    }
    if (pathFields(entry).length === 0 && (isActiveEntry(entry) || isPlannedEntry(entry))) {
      errors.push(entry.id + ' must declare path, source, or artifact')
    }

    for (const field of pathFields(entry)) {
      try {
        const resolved = resolveDocsPath(root, paths.docsRoot.relative, entry[field], entry.id + ' ' + field)
        const owner = entry.id + '.' + field
        const previousOwners = pathOwners.get(resolved.relative) || []
        if (previousOwners.length > 0 && !previousOwners.includes(owner)) {
          warnings.push('Path is referenced by multiple manifest fields: ' + resolved.relative
            + ' (' + [...previousOwners, owner].join(', ') + ')')
        }
        pathOwners.set(resolved.relative, [...previousOwners, owner])
        if (isActiveEntry(entry) && !existsSync(resolved.absolute)) {
          errors.push(entry.id + ' is active but ' + field + ' does not exist: ' + entry[field])
        }
      } catch (error) {
        addPathError(errors, entry, field, error)
      }
    }
  }

  const groupIds = new Set()
  const references = new Map()
  for (const group of manifest.groups) {
    if (groupIds.has(group.id)) errors.push('Duplicate manifest group id: ' + group.id)
    groupIds.add(group.id)
    const seenInGroup = new Set()
    for (const entryId of group.entry_ids) {
      if (seenInGroup.has(entryId)) errors.push(group.id + ' references ' + entryId + ' more than once')
      seenInGroup.add(entryId)
      if (!entryIds.has(entryId)) {
        errors.push(group.id + ' references unknown entry: ' + entryId)
        continue
      }
      const list = references.get(entryId) || []
      list.push(group.id)
      references.set(entryId, list)
    }
  }

  for (const entry of manifest.entries) {
    const groupReferences = references.get(entry.id) || []
    if ((isActiveEntry(entry) || isPlannedEntry(entry)) && groupReferences.length === 0) {
      errors.push(entry.id + ' is not assigned to a catalog group')
    }
    if (groupReferences.length > 1) {
      errors.push(entry.id + ' is assigned to multiple catalog groups: ' + groupReferences.join(', '))
    }
  }

  for (const entry of manifest.entries) {
    if (entry.status !== 'planned') continue
    const files = pathFields(entry).filter((field) => {
      try {
          return existsSync(resolveDocsPath(root, paths.docsRoot.relative, entry[field]).absolute)
      } catch {
        return false
      }
    })
    if (files.length > 0) warnings.push(entry.id + ' is planned but has files in docsRoot')
  }

  return { ok: errors.length === 0, errors, warnings, infos }
}
