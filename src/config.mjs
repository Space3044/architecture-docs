import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveProjectPath } from './path-utils.mjs'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const DEFAULT_CONFIG = {
  schema_version: 1,
  docsRoot: 'docs',
  manifest: 'docs/catalog/manifest.json',
  viewer: {
    template: 'default',
    output: 'docs/index.html',
    readme: 'docs/README.md',
  },
  discovery: {
    include: ['**/*.md', '**/*.html', '**/*.json'],
    exclude: [
      'README.md',
      'index.html',
      'catalog/**',
      '**/*.delivery.json',
      '**/*.delivery-pending.json',
      '**/*.finalize.json',
      '**/*.finalize-summary.json',
      '**/*.browser-check.json',
      '**/visual-check/**',
      '**/review-*/**',
    ],
  },
  providers: [],
  drift: {
    enabled: true,
  },
}

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value)

const mergeConfig = (base, override) => {
  if (!isObject(base) || !isObject(override)) return override
  const result = { ...base }
  for (const [key, value] of Object.entries(override)) {
    result[key] = isObject(value) && isObject(result[key])
      ? mergeConfig(result[key], value)
      : value
  }
  return result
}

const readJson = (filePath, label) => {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch (error) {
    throw new Error('Unable to read ' + label + ': ' + error.message)
  }
}

const ensureStringArray = (value, label) => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(label + ' must be an array of strings')
  }
}

export const validateConfig = (config) => {
  if (!isObject(config)) throw new Error('architecture-docs config must be a JSON object')
  if (config.schema_version !== 1) {
    throw new Error('architecture-docs config schema_version must be 1')
  }
  if (typeof config.docsRoot !== 'string' || !config.docsRoot) {
    throw new Error('config.docsRoot must be a non-empty relative path')
  }
  if (typeof config.manifest !== 'string' || !config.manifest) {
    throw new Error('config.manifest must be a non-empty relative path')
  }
  if (!isObject(config.viewer)) throw new Error('config.viewer must be an object')
  for (const key of ['template', 'output', 'readme']) {
    if (typeof config.viewer[key] !== 'string' || !config.viewer[key]) {
      throw new Error('config.viewer.' + key + ' must be a non-empty string')
    }
  }
  if (!isObject(config.discovery)) throw new Error('config.discovery must be an object')
  ensureStringArray(config.discovery.include, 'config.discovery.include')
  ensureStringArray(config.discovery.exclude, 'config.discovery.exclude')
  if (!Array.isArray(config.providers)) throw new Error('config.providers must be an array')
  if (!isObject(config.drift)) throw new Error('config.drift must be an object')
}

export const loadConfig = (root = process.cwd(), requestedConfig = null) => {
  const projectRoot = path.resolve(root)
  const defaultConfigPath = path.join(projectRoot, 'architecture-docs.config.json')
  const configPath = requestedConfig
    ? resolveProjectPath(projectRoot, requestedConfig, 'config')
    : { absolute: defaultConfigPath, relative: 'architecture-docs.config.json' }

  const hasConfig = existsSync(configPath.absolute)
  const parsed = hasConfig ? readJson(configPath.absolute, 'architecture-docs config') : {}
  const config = mergeConfig(DEFAULT_CONFIG, parsed)
  validateConfig(config)

  const docsRoot = resolveProjectPath(projectRoot, config.docsRoot, 'config.docsRoot')
  const manifest = resolveProjectPath(projectRoot, config.manifest, 'config.manifest')
  const output = resolveProjectPath(projectRoot, config.viewer.output, 'config.viewer.output')
  const readme = resolveProjectPath(projectRoot, config.viewer.readme, 'config.viewer.readme')
  const template = config.viewer.template === 'default'
    ? { absolute: path.join(packageRoot, 'templates/viewer.html'), relative: null }
    : resolveProjectPath(projectRoot, config.viewer.template, 'config.viewer.template')

  return {
    root: projectRoot,
    config,
    sourcePath: hasConfig ? configPath.absolute : null,
    paths: {
      docsRoot,
      manifest,
      output,
      readme,
      template,
    },
  }
}

export const packageRootPath = () => packageRoot
