export const PROVIDER_SCHEMA_VERSION = 1

const asArray = (value) => Array.isArray(value) ? value : []

export const createProviderContext = ({ root, paths, manifest, config }) => ({
  schema_version: PROVIDER_SCHEMA_VERSION,
  root,
  docs_root: paths.docsRoot.absolute,
  manifest,
  config,
})

export const normalizeProviderReport = (report, providerName = 'provider') => {
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    throw new Error(providerName + ' must return an object')
  }
  if (report.schema_version !== PROVIDER_SCHEMA_VERSION) {
    throw new Error(providerName + ' schema_version must be 1')
  }
  if (report.provider && typeof report.provider !== 'string') {
    throw new Error(providerName + ' provider must be a string')
  }
  return {
    schema_version: PROVIDER_SCHEMA_VERSION,
    provider: report.provider || providerName,
    objects: asArray(report.objects),
    diagnostics: asArray(report.diagnostics),
  }
}
