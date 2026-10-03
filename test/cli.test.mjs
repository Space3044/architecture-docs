import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { normalizeProviderReport } from '../src/providers/contract.mjs'

const packageRoot = path.resolve(import.meta.dirname, '..')
const bin = path.join(packageRoot, 'bin/architecture-docs.mjs')
const fixture = path.join(packageRoot, 'fixtures/minimal')
const invalidFixture = path.join(packageRoot, 'fixtures/invalid')

const copyFixture = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'architecture-docs-'))
  cpSync(fixture, root, { recursive: true })
  return root
}

const copyInvalidFixture = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'architecture-docs-invalid-'))
  cpSync(invalidFixture, root, { recursive: true })
  return root
}

const runCli = (root, args) => spawnSync(process.execPath, [bin, ...args, '--root', root], {
  encoding: 'utf8',
})

test('help lists the manifest workflow commands', () => {
  const result = spawnSync(process.execPath, [bin, '--help'], { encoding: 'utf8' })
  assert.equal(result.status, 0)
  assert.match(result.stdout, /architecture-docs <command>/)
  assert.match(result.stdout, /discover/)
  assert.match(result.stdout, /check/)
})

test('build, check, and discover work on a docs-only fixture', () => {
  const root = copyFixture()
  const build = runCli(root, ['build'])
  assert.equal(build.status, 0, build.stderr)
  assert.equal(existsSync(path.join(root, 'docs/index.html')), true)
  assert.match(readFileSync(path.join(root, 'docs/index.html'), 'utf8'), /Example Project/)

  const check = runCli(root, ['check', '--json'])
  assert.equal(check.status, 0, check.stderr)
  const checkReport = JSON.parse(check.stdout)
  assert.equal(checkReport.ok, true)
  assert.deepEqual(checkReport.discovery.unregistered, ['unregistered.md'])
  assert.ok(checkReport.warnings.some((message) => message.includes('Unregistered docs files')))

  const discover = runCli(root, ['discover', '--json'])
  assert.equal(discover.status, 0, discover.stderr)
  const discoverReport = JSON.parse(discover.stdout)
  assert.deepEqual(discoverReport.discovery.unregistered, ['unregistered.md'])
})

test('check rejects a path that escapes docsRoot', () => {
  const root = copyFixture()
  const manifestPath = path.join(root, 'docs/catalog/manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.entries[0].path = '../outside.html'
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  const result = runCli(root, ['check', '--json'])
  assert.equal(result.status, 1)
  const report = JSON.parse(result.stdout)
  assert.equal(report.ok, false)
  assert.ok(report.errors.some((message) => message.includes('cannot contain empty or parent path segments')))
})

test('check reports duplicate ids and missing active artifacts', () => {
  const root = copyInvalidFixture()
  const result = runCli(root, ['check', '--json'])
  assert.equal(result.status, 1)
  const report = JSON.parse(result.stdout)
  assert.equal(report.ok, false)
  assert.ok(report.errors.some((message) => message.includes('Duplicate manifest entry id')))
  assert.ok(report.errors.some((message) => message.includes('missing.html')))
  assert.ok(report.warnings.some((message) => message.includes('planned but has files')))
  assert.ok(report.warnings.some((message) => message.includes('multiple manifest fields')))
})

test('init creates only missing starter files', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'architecture-docs-init-'))
  const first = runCli(root, ['init'])
  assert.equal(first.status, 0, first.stderr)
  assert.equal(existsSync(path.join(root, 'architecture-docs.config.json')), true)
  assert.equal(existsSync(path.join(root, 'docs/catalog/manifest.json')), true)
  assert.equal(existsSync(path.join(root, 'docs/README.md')), true)

  const second = runCli(root, ['init', '--json'])
  assert.equal(second.status, 0, second.stderr)
  const report = JSON.parse(second.stdout)
  assert.deepEqual(report.created, [])
})

test('provider reports are normalized to the stable contract', () => {
  const report = normalizeProviderReport({
    schema_version: 1,
    provider: 'fixture',
    objects: [{ id: 'one' }],
    diagnostics: [],
  })
  assert.deepEqual(report, {
    schema_version: 1,
    provider: 'fixture',
    objects: [{ id: 'one' }],
    diagnostics: [],
  })
})
