import { readFileSync } from 'node:fs'

const ACTIVE_STATUSES = new Set(['active', 'needs-refresh'])
const PLANNED_STATUSES = new Set(['planned', 'draft'])

const asArray = (value) => Array.isArray(value) ? value : []

const unique = (values) => [...new Set(values.filter(Boolean))]

const firstString = (...values) => values.find((value) => typeof value === 'string' && value.length > 0) || null

const entryReferences = (group) => {
  const candidates = group.entry_ids
    || group.document_ids
    || group.diagram_ids
    || group.item_ids
    || group.entries
    || []
  return candidates.map((item) => typeof item === 'string' ? item : item?.id).filter(Boolean)
}

const normalizeEntry = (raw, index) => {
  const value = raw && typeof raw === 'object' ? raw : {}
  const id = firstString(value.id, value.key, value.slug)
  if (!id) throw new Error('manifest entry at index ' + index + ' is missing id')

  const source = firstString(value.source, value.source_path)
  const artifact = firstString(value.artifact, value.output, value.html)
  const documentPath = firstString(value.path, value.document, value.file, value.markdown)
  const title = firstString(value.title, value.label, value.name, id) || id
  const question = firstString(value.question, value.description, value.summary, title) || title
  const type = firstString(value.type, value.format, value.kind, 'document') || 'document'
  const status = firstString(value.status, 'active') || 'active'
  const tags = unique([
    ...asArray(value.tags),
    ...asArray(value.risk_tags),
    ...asArray(value.riskTags),
  ].filter((item) => typeof item === 'string'))
  const groupId = firstString(value.group_id, value.groupId, value.group)

  return {
    id,
    title,
    question,
    description: firstString(raw.description, raw.summary),
    type,
    kind: firstString(value.kind, 'document') || 'document',
    status,
    category: firstString(raw.category, groupId, 'documents') || 'documents',
    source,
    artifact,
    path: documentPath,
    group_id: groupId,
    tags,
    audience: asArray(value.audience),
    scope: firstString(value.scope),
    layers: asArray(value.layers),
    risk_tags: unique(asArray(value.risk_tags).filter((item) => typeof item === 'string')),
    watch_paths: asArray(value.watch_paths),
    evidence_paths: asArray(value.evidence_paths),
    raw: value,
  }
}

const makeFallbackGroups = (entries) => {
  const groups = new Map()
  for (const entry of entries) {
    const id = entry.group_id || entry.category || 'documents'
    if (!groups.has(id)) {
      groups.set(id, {
        id,
        label: id,
        question: 'Entries grouped under ' + id,
        entry_ids: [],
        raw: null,
      })
    }
    groups.get(id).entry_ids.push(entry.id)
  }
  return [...groups.values()]
}

const normalizeGroups = (rawManifest, entries) => {
  const taxonomy = rawManifest.taxonomy || rawManifest.view_taxonomy || {}
  const rawGroups = asArray(taxonomy.groups).length > 0
    ? taxonomy.groups
    : asArray(rawManifest.groups)
  const groups = rawGroups.map((group, index) => ({
    id: firstString(group?.id, group?.key, 'group-' + (index + 1)),
    label: firstString(group?.label, group?.name, group?.title, group?.id, 'Group ' + (index + 1)),
    question: firstString(group?.question, group?.description, group?.label, group?.id, '') || '',
    entry_ids: unique(entryReferences(group)),
    raw: group,
  }))

  const result = groups.length > 0 ? groups : makeFallbackGroups(entries)
  const known = new Set(result.flatMap((group) => group.entry_ids))
  const unassigned = entries
    .filter((entry) => !known.has(entry.id))
    .map((entry) => entry.id)
  if (unassigned.length > 0) {
    result.push({
      id: 'unassigned',
      label: 'Unassigned',
      question: 'Entries that still need a catalog group.',
      entry_ids: unassigned,
      raw: null,
    })
  }
  return result
}

export const readManifest = (manifestPath) => {
  let raw
  try {
    raw = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    throw new Error('Unable to read manifest: ' + error.message)
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Manifest must be a JSON object')
  }
  if (raw.schema_version !== 1) {
    throw new Error('Manifest schema_version must be 1')
  }

  const rawEntries = asArray(raw.entries).length > 0
    ? raw.entries
    : asArray(raw.diagrams).length > 0
      ? raw.diagrams
      : asArray(raw.documents)
  const entries = rawEntries.map(normalizeEntry)
  const project = typeof raw.project === 'string'
    ? { name: raw.project, description: '' }
    : (raw.project && typeof raw.project === 'object' ? raw.project : {})

  return {
    schema_version: 1,
    project: {
      name: firstString(project.name, raw.name, 'Documentation Atlas') || 'Documentation Atlas',
      description: firstString(project.description, raw.description, '') || '',
    },
    entries,
    groups: normalizeGroups(raw, entries),
    raw,
  }
}

export const isActiveEntry = (entry) => ACTIVE_STATUSES.has(entry.status)

export const isPlannedEntry = (entry) => PLANNED_STATUSES.has(entry.status)

export const visibleEntries = (manifest) => manifest.entries.filter(isActiveEntry)
