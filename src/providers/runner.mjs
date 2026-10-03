import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { normalizeProviderReport, createProviderContext } from './contract.mjs'
import { resolveProjectPath } from '../path-utils.mjs'

const providerSpec = (value, index) => {
  if (typeof value === 'string') return { name: path.basename(value), module: value, strict: false }
  if (!value || typeof value !== 'object') {
    throw new Error('providers[' + index + '] must be a module path or object')
  }
  if (typeof value.module !== 'string' || !value.module) {
    throw new Error('providers[' + index + '].module must be a non-empty string')
  }
  return {
    name: typeof value.name === 'string' && value.name ? value.name : path.basename(value.module),
    module: value.module,
    options: value.options || {},
    strict: value.strict === true,
  }
}

export const runProviders = async ({ root, paths, manifest, config }, { strict = false } = {}) => {
  const reports = []
  const errors = []
  const warnings = []
  const context = createProviderContext({ root, paths, manifest, config })

  for (const [index, value] of config.providers.entries()) {
    let spec
    try {
      spec = providerSpec(value, index)
      const modulePath = resolveProjectPath(root, spec.module, 'providers[' + index + '].module')
      const imported = await import(pathToFileURL(modulePath.absolute).href)
      const runner = imported.run || imported.default
      if (typeof runner !== 'function') {
        throw new Error(spec.name + ' must export run(context) or a default function')
      }
      const report = normalizeProviderReport(await runner(context, spec.options), spec.name)
      reports.push(report)
      for (const diagnostic of report.diagnostics) {
        const severity = diagnostic?.severity || 'warning'
        const message = diagnostic?.message || JSON.stringify(diagnostic)
        if (severity === 'error') errors.push(spec.name + ': ' + message)
        else if (severity === 'warning') warnings.push(spec.name + ': ' + message)
      }
    } catch (error) {
      const name = spec?.name || 'providers[' + index + ']'
      if (strict || spec?.strict) errors.push(name + ': ' + error.message)
      else warnings.push(name + ': ' + error.message)
    }
  }

  return { reports, errors, warnings }
}
