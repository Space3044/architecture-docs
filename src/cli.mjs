import { accessSync, constants, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { loadConfig, packageRootPath } from './config.mjs'
import { discoverDocs, registeredManifestPaths } from './discovery.mjs'
import { collectDrift } from './drift.mjs'
import { readManifest } from './manifest.mjs'
import { runProviders } from './providers/runner.mjs'
import { resolveProjectPath } from './path-utils.mjs'
import { validateManifest } from './validation.mjs'
import { buildViewer } from './viewer.mjs'

const HELP = [
  'Usage: architecture-docs <command> [options]',
  '',
  'Commands:',
  '  init       Create a config, a sample manifest, and docs/README.md',
  '  discover   Report docs files that are not registered in the manifest',
  '  build      Generate the static documentation viewer',
  '  check      Validate manifest paths, groups, viewer output, drift, and providers',
  '  doctor     Check local configuration and runtime prerequisites',
  '',
  'Options:',
  '  --root <path>          Project root (default: current directory)',
  '  --config <path>        Config path relative to the project root',
  '  --output <path>        Override viewer output path for build/check',
  '  --template <path>      Override viewer template path; use default for the bundled template',
  '  --json                 Print a machine-readable report',
  '  --strict-drift         Turn watched source drift into errors',
  '  --strict-providers     Turn provider failures into errors',
  '  --ci                   CI-compatible alias; drift remains advisory',
  '  --check                Verify build output without writing',
  '  --help                 Show this help',
].join('\n')

const parseValue = (argv, index, option) => {
  const value = argv[index]
  if (!value || value.startsWith('--')) throw new Error(option + ' requires a value')
  return value
}

export const parseArgs = (argv) => {
  const options = {
    command: null,
    root: process.cwd(),
    config: null,
    output: null,
    template: null,
    json: false,
    strictDrift: false,
    strictProviders: false,
    check: false,
    help: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help' || argument === '-h') {
      options.help = true
    } else if (argument === '--json') {
      options.json = true
    } else if (argument === '--strict-drift') {
      options.strictDrift = true
    } else if (argument === '--strict-providers') {
      options.strictProviders = true
    } else if (argument === '--ci') {
      options.ci = true
    } else if (argument === '--check') {
      options.check = true
    } else if (argument === '--root' || argument.startsWith('--root=')) {
      const value = argument.includes('=') ? argument.slice(argument.indexOf('=') + 1) : parseValue(argv, ++index, '--root')
      options.root = path.resolve(value)
    } else if (argument === '--config' || argument.startsWith('--config=')) {
      options.config = argument.includes('=') ? argument.slice(argument.indexOf('=') + 1) : parseValue(argv, ++index, '--config')
    } else if (argument === '--output' || argument.startsWith('--output=')) {
      options.output = argument.includes('=') ? argument.slice(argument.indexOf('=') + 1) : parseValue(argv, ++index, '--output')
    } else if (argument === '--template' || argument.startsWith('--template=')) {
      options.template = argument.includes('=') ? argument.slice(argument.indexOf('=') + 1) : parseValue(argv, ++index, '--template')
    } else if (argument.startsWith('-')) {
      throw new Error('Unknown option: ' + argument)
    } else if (!options.command) {
      options.command = argument
    } else {
      throw new Error('Unexpected argument: ' + argument)
    }
  }

  return options
}

const overrideContext = (context, options) => {
  const next = {
    ...context,
    paths: { ...context.paths },
    config: { ...context.config, viewer: { ...context.config.viewer } },
  }
  if (options.output) {
    next.paths.output = resolveProjectPath(context.root, options.output, 'output')
    next.config.viewer.output = options.output
  }
  if (options.template) {
    next.paths.template = options.template === 'default'
      ? { absolute: path.join(packageRootPath(), 'templates/viewer.html'), relative: null }
      : resolveProjectPath(context.root, options.template, 'template')
    next.config.viewer.template = options.template
  }
  return next
}

const readContext = (options) => {
  const context = overrideContext(loadConfig(options.root, options.config), options)
  const manifest = readManifest(context.paths.manifest.absolute)
  return { context, manifest }
}

const discoveryReport = (context, manifest) => {
  const registered = registeredManifestPaths({ manifest, paths: context.paths })
  return discoverDocs({
    docsRoot: context.paths.docsRoot,
    include: context.config.discovery.include,
    exclude: context.config.discovery.exclude,
    registered,
  })
}

const baseReport = (command) => ({
  schema_version: 1,
  command,
  ok: true,
  errors: [],
  warnings: [],
  infos: [],
})

const runCheck = async (options) => {
  const report = baseReport('check')
  let context
  let manifest
  try {
    ({ context, manifest } = readContext(options))
  } catch (error) {
    report.ok = false
    report.errors.push(error.message)
    return report
  }

  report.manifest = {
    entries: manifest.entries.length,
    groups: manifest.groups.length,
    project: manifest.project.name,
  }
  const validation = validateManifest({ root: context.root, paths: context.paths, manifest })
  report.errors.push(...validation.errors)
  report.warnings.push(...validation.warnings)
  report.infos.push(...validation.infos)

  const discovery = discoveryReport(context, manifest)
  report.discovery = discovery
  if (discovery.unregistered.length > 0) {
    report.warnings.push('Unregistered docs files: ' + discovery.unregistered.join(', '))
  }

  const providers = await runProviders({ ...context, manifest }, { strict: options.strictProviders })
  report.providers = providers.reports
  report.errors.push(...providers.errors)
  report.warnings.push(...providers.warnings)

  const drift = collectDrift({ ...context, manifest }, {
    enabled: context.config.drift.enabled !== false,
    strict: options.strictDrift,
  })
  report.drift = drift
  report.errors.push(...drift.errors)
  report.warnings.push(...drift.warnings)
  report.infos.push(...drift.infos)

  if (report.errors.length === 0) {
    try {
      buildViewer({ context, manifest, check: true })
      report.infos.push('Generated viewer is up to date')
    } catch (error) {
      report.errors.push(error.message)
    }
  }
  report.ok = report.errors.length === 0
  return report
}

const runDiscover = (options) => {
  const report = baseReport('discover')
  let context
  let manifest
  try {
    ({ context, manifest } = readContext(options))
  } catch (error) {
    report.ok = false
    report.errors.push(error.message)
    return report
  }
  const discovery = discoveryReport(context, manifest)
  report.discovery = discovery
  report.infos.push(discovery.unregistered.length > 0
    ? 'Found ' + discovery.unregistered.length + ' unregistered docs file(s)'
    : 'All discovered docs files are registered or excluded')
  return report
}

const runBuild = (options) => {
  const report = baseReport('build')
  let context
  let manifest
  try {
    ({ context, manifest } = readContext(options))
  } catch (error) {
    report.ok = false
    report.errors.push(error.message)
    return report
  }
  const validation = validateManifest({ root: context.root, paths: context.paths, manifest })
  report.errors.push(...validation.errors)
  report.warnings.push(...validation.warnings)
  if (report.errors.length === 0) {
    try {
      const result = buildViewer({ context, manifest, check: options.check })
      report.output = path.relative(context.root, result.output).replaceAll('\\', '/')
      report.entries = result.payload.generated_entry_count
      report.infos.push(options.check ? 'Generated viewer is up to date' : 'Generated viewer')
    } catch (error) {
      report.errors.push(error.message)
    }
  }
  report.ok = report.errors.length === 0
  return report
}

const writeIfMissing = (filePath, content, created) => {
  if (existsSync(filePath)) return false
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, content)
  created.push(filePath)
  return true
}

const runInit = (options) => {
  const report = baseReport('init')
  const root = path.resolve(options.root)
  mkdirSync(root, { recursive: true })
  const configPath = options.config
    ? resolveProjectPath(root, options.config, 'config')
    : { absolute: path.join(root, 'architecture-docs.config.json'), relative: 'architecture-docs.config.json' }
  const config = {
    schema_version: 1,
    docsRoot: 'docs',
    manifest: 'docs/catalog/manifest.json',
    viewer: { template: 'default', output: 'docs/index.html', readme: 'docs/README.md' },
    discovery: {
      include: ['**/*.md', '**/*.html', '**/*.json'],
      exclude: ['README.md', 'index.html', 'catalog/**'],
    },
    providers: [],
    drift: { enabled: true },
  }
  const created = []
  writeIfMissing(configPath.absolute, JSON.stringify(config, null, 2) + '\n', created)
  const manifestPath = path.join(root, 'docs/catalog/manifest.json')
  const readmePath = path.join(root, 'docs/README.md')
  const manifest = {
    schema_version: 1,
    project: {
      name: 'Documentation Atlas',
      description: 'A manifest-driven entry point for project documentation.',
    },
    groups: [{
      id: 'overview',
      label: 'Overview',
      question: 'What should a maintainer read first?',
      entry_ids: ['readme'],
    }],
    entries: [{
      id: 'readme',
      title: 'Documentation overview',
      question: 'Where is the project documentation overview?',
      type: 'document',
      status: 'active',
      path: 'README.md',
    }],
  }
  writeIfMissing(manifestPath, JSON.stringify(manifest, null, 2) + '\n', created)
  writeIfMissing(readmePath, '# Documentation Atlas\n\nRun architecture-docs build to generate the viewer.\n', created)
  report.created = created.map((filePath) => path.relative(root, filePath).replaceAll('\\', '/'))
  report.infos.push(report.created.length > 0 ? 'Created missing starter files' : 'Starter files already exist')
  return report
}

const runDoctor = (options) => {
  const report = baseReport('doctor')
  report.node = process.versions.node
  if (Number.parseInt(process.versions.node.split('.')[0], 10) < 20) {
    report.errors.push('Node.js 20 or newer is required')
  }
  try {
    const context = overrideContext(loadConfig(options.root, options.config), options)
    report.config = {
      path: context.sourcePath ? path.relative(context.root, context.sourcePath).replaceAll('\\', '/') : null,
      docsRoot: context.paths.docsRoot.relative,
      manifest: context.paths.manifest.relative,
      output: context.paths.output.relative,
      template: context.paths.template.relative || 'default',
    }
    if (!existsSync(context.paths.docsRoot.absolute)) report.errors.push('docsRoot does not exist')
    if (!existsSync(context.paths.manifest.absolute)) report.errors.push('manifest does not exist')
    if (!existsSync(context.paths.template.absolute)) report.errors.push('viewer template does not exist')
    try {
      accessSync(path.dirname(context.paths.output.absolute), constants.W_OK)
    } catch {
      report.warnings.push('viewer output directory is not writable or does not exist yet')
    }
  } catch (error) {
    report.errors.push(error.message)
  }
  report.ok = report.errors.length === 0
  return report
}

const printHuman = (report) => {
  for (const error of report.errors || []) console.error('ERROR ' + error)
  for (const warning of report.warnings || []) console.warn('WARN  ' + warning)
  for (const info of report.infos || []) console.log('INFO  ' + info)
  if (report.discovery) {
    console.log('Discovery: ' + report.discovery.files.length + ' matched, ' + report.discovery.unregistered.length + ' unregistered')
  }
  if (report.output) console.log('Output: ' + report.output)
  console.log(report.ok ? 'architecture-docs ' + report.command + ' passed' : 'architecture-docs ' + report.command + ' failed')
}

export const main = async (argv = process.argv.slice(2)) => {
  let options
  try {
    options = parseArgs(argv)
    if (options.help || !options.command) {
      console.log(HELP)
      return 0
    }
    const handlers = { init: runInit, discover: runDiscover, build: runBuild, check: runCheck, doctor: runDoctor }
    const handler = handlers[options.command]
    if (!handler) throw new Error('Unknown command: ' + options.command)
    const report = await handler(options)
    if (options.json) console.log(JSON.stringify(report, null, 2))
    else printHuman(report)
    return report.ok ? 0 : 1
  } catch (error) {
    const report = { schema_version: 1, ok: false, errors: [error.message], warnings: [], infos: [] }
    if (options?.json) console.log(JSON.stringify(report, null, 2))
    else console.error(error.message)
    return 1
  }
}
