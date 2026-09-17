import { readFile } from 'node:fs/promises'

const EXPECTED_PROJECT = Object.freeze({
  appKey: 'ossfkey',
  host: 'https://pzmh35a7.ap-southeast.insforge.app',
  projectName: 'oss-project',
})

function fail(message) {
  console.error(`Queue Pilot project guard failed: ${message}`)
  process.exit(1)
}

function parseEnvironment(source) {
  return Object.fromEntries(
    source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const separator = line.indexOf('=')
        return [
          line.slice(0, separator).trim(),
          line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, ''),
        ]
      }),
  )
}

let project
let environment

try {
  project = JSON.parse(await readFile(new URL('../.insforge/project.json', import.meta.url), 'utf8'))
  environment = parseEnvironment(await readFile(new URL('../.env.local', import.meta.url), 'utf8'))
} catch (error) {
  fail(error instanceof Error ? error.message : 'Queue Pilot project metadata could not be read.')
}

if (project.project_name !== EXPECTED_PROJECT.projectName) {
  fail(`expected project name ${EXPECTED_PROJECT.projectName}.`)
}
if (project.appkey !== EXPECTED_PROJECT.appKey) {
  fail(`expected app key ${EXPECTED_PROJECT.appKey}.`)
}
if (project.oss_host?.replace(/\/$/, '') !== EXPECTED_PROJECT.host) {
  fail(`expected backend host ${EXPECTED_PROJECT.host}.`)
}
if (environment.VITE_INSFORGE_URL?.replace(/\/$/, '') !== EXPECTED_PROJECT.host) {
  fail('VITE_INSFORGE_URL does not match the Queue Pilot backend host.')
}

console.log(`Queue Pilot project guard passed (${EXPECTED_PROJECT.host}).`)
