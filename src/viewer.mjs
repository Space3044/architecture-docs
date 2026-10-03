import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { isActiveEntry, isPlannedEntry } from './manifest.mjs'
import { relativeUrl, resolveDocsPath } from './path-utils.mjs'

export const VIEWER_SCHEMA_VERSION = 1
export const DATA_PLACEHOLDER = '__ARCHITECTURE_VIEWER_DATA__'
export const CATALOG_HASH_PLACEHOLDER = '__ARCHITECTURE_VIEWER_CATALOG_SHA256__'

const asArray = (value) => Array.isArray(value) ? value : []

const encodeJsonForHtml = (value) => JSON.stringify(value)
  .replaceAll('<', '\\u003c')
  .replaceAll('>', '\\u003e')
  .replaceAll('&', '\\u0026')
  .replaceAll('\u2028', '\\u2028')
  .replaceAll('\u2029', '\\u2029')

const linkFor = (context, relativePath, label) => {
  if (!relativePath) return null
  const resolved = resolveDocsPath(context.root, context.paths.docsRoot.relative, relativePath, label)
  return relativeUrl(context.paths.output.absolute, resolved.absolute)
}

const entryPayload = (context, entry) => {
  const artifact = entry.artifact || entry.path || entry.source || null
  const previewable = typeof artifact === 'string' && /\.(?:html?|xhtml)$/i.test(artifact)
  return {
    id: entry.id,
    title: entry.title,
    question: entry.question,
    description: entry.description,
    type: entry.type,
    kind: entry.kind,
    category: entry.category,
    status: entry.status,
    source: entry.source,
    artifact: entry.artifact,
    path: entry.path,
    source_href: linkFor(context, entry.source, entry.id + ' source'),
    artifact_href: linkFor(context, artifact, entry.id + ' artifact'),
    preview_href: previewable ? linkFor(context, artifact, entry.id + ' preview') : null,
    tags: [...new Set([...asArray(entry.tags), ...asArray(entry.risk_tags)])],
    audience: asArray(entry.audience),
    scope: entry.scope,
    layers: asArray(entry.layers),
  }
}

export const buildViewerPayload = (context, manifest) => {
  const groups = manifest.groups.map((group, index) => {
    const entries = group.entry_ids
      .map((entryId) => manifest.entries.find((entry) => entry.id === entryId))
      .filter(Boolean)
    return {
      id: group.id,
      label: group.label,
      question: group.question,
      order: index + 1,
      active_entries: entries.filter(isActiveEntry).map((entry) => entryPayload(context, entry)),
      planned_entries: entries.filter(isPlannedEntry).map((entry) => entryPayload(context, entry)),
    }
  })

  return {
    schema_version: VIEWER_SCHEMA_VERSION,
    project: manifest.project,
    links: {
      readme: relativeUrl(context.paths.output.absolute, context.paths.readme.absolute),
      manifest: relativeUrl(context.paths.output.absolute, context.paths.manifest.absolute),
    },
    groups,
    generated_entry_count: groups.reduce((count, group) => count + group.active_entries.length, 0),
  }
}

export const renderViewer = ({ context, manifest }) => {
  const template = readFileSync(context.paths.template.absolute, 'utf8')
  if (!template.includes(DATA_PLACEHOLDER) || !template.includes(CATALOG_HASH_PLACEHOLDER)) {
    throw new Error('Viewer template is missing generation placeholders')
  }
  const catalogBytes = readFileSync(context.paths.manifest.absolute)
  const payload = buildViewerPayload(context, manifest)
  const catalogHash = createHash('sha256').update(catalogBytes).digest('hex')
  const html = template
    .replace(DATA_PLACEHOLDER, encodeJsonForHtml(payload))
    .replaceAll(CATALOG_HASH_PLACEHOLDER, catalogHash)
  return { html, payload, catalogHash }
}

export const buildViewer = ({ context, manifest, check = false }) => {
  const rendered = renderViewer({ context, manifest })
  const outputPath = context.paths.output.absolute
  if (check) {
    if (!existsSync(outputPath)) {
      throw new Error('Missing generated viewer: ' + outputPath)
    }
    const current = readFileSync(outputPath, 'utf8')
    if (current !== rendered.html) {
      throw new Error('Generated viewer is out of date; run architecture-docs build')
    }
  } else {
    mkdirSync(path.dirname(outputPath), { recursive: true })
    writeFileSync(outputPath, rendered.html)
  }
  return {
    output: outputPath,
    payload: rendered.payload,
    catalog_hash: rendered.catalogHash,
    changed: !check,
  }
}
