/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-require-imports */
import * as core from '@actions/core'
import { env } from 'process'
// Import this way otherwise typescript has errors
const exec = require('@actions/exec')
const shlex = require('shlex')

export interface RunDockerCommandOptions {
  workingDir?: string
  input?: Buffer
  env?: { [key: string]: string }
}

export async function runDockerCommand(
  args: string[],
  options?: RunDockerCommandOptions
): Promise<string> {
  options = optionsWithDockerEnvs(options)
  args = fixArgs(args)
  const pipes = await exec.getExecOutput('docker', args, options)
  if (pipes.exitCode !== 0) {
    core.error(`Docker failed with exit code ${pipes.exitCode}`)
    return Promise.reject(pipes.stderr)
  }
  return Promise.resolve(pipes.stdout)
}

export function optionsWithDockerEnvs(
  options?: RunDockerCommandOptions
): RunDockerCommandOptions | undefined {
  // From https://docs.docker.com/engine/reference/commandline/cli/#environment-variables
  const dockerCliEnvs = new Set([
    'DOCKER_API_VERSION',
    'DOCKER_CERT_PATH',
    'DOCKER_CONFIG',
    'DOCKER_CONTENT_TRUST_SERVER',
    'DOCKER_CONTENT_TRUST',
    'DOCKER_CONTEXT',
    'DOCKER_DEFAULT_PLATFORM',
    'DOCKER_HIDE_LEGACY_COMMANDS',
    'DOCKER_HOST',
    'DOCKER_STACK_ORCHESTRATOR',
    'DOCKER_TLS_VERIFY',
    'BUILDKIT_PROGRESS'
  ])
  const dockerEnvs = {}
  for (const key in process.env) {
    if (dockerCliEnvs.has(key)) {
      dockerEnvs[key] = process.env[key]
    }
  }

  const newOptions = {
    workingDir: options?.workingDir,
    input: options?.input,
    env: options?.env || {}
  }

  // Set docker envs or overwrite provided ones
  for (const [key, value] of Object.entries(dockerEnvs)) {
    newOptions.env[key] = value as string
  }

  return newOptions
}

export function sanitize(val: string): string {
  if (!val || typeof val !== 'string') {
    return ''
  }
  const newNameBuilder: string[] = []
  for (let i = 0; i < val.length; i++) {
    const char = val.charAt(i)
    if (!newNameBuilder.length) {
      if (isAlpha(char)) {
        newNameBuilder.push(char)
      }
    } else {
      if (isAlpha(char) || isNumeric(char) || char === '_') {
        newNameBuilder.push(char)
      }
    }
  }
  return newNameBuilder.join('')
}

export function fixArgs(args: string[]): string[] {
  return shlex.split(args.join(' '))
}

export function checkEnvironment(): void {
  if (!env.GITHUB_WORKSPACE) {
    throw new Error('GITHUB_WORKSPACE is not set')
  }
}

// isAlpha accepts single character and checks if
// that character is [a-zA-Z]
function isAlpha(val: string): boolean {
  return (
    val.length === 1 &&
    ((val >= 'a' && val <= 'z') || (val >= 'A' && val <= 'Z'))
  )
}

function isNumeric(val: string): boolean {
  return val.length === 1 && val >= '0' && val <= '9'
}

/**
 * Process createOptions to handle GPU allocation.
 * Replaces '--gpus runner_decide' with '--gpus $RUNNER_VISIBLE_DEVICES'
 * where RUNNER_VISIBLE_DEVICES is resolved from the environment.
 */
export function processGpuOptions(createOptions: string): string {
  if (!createOptions) {
    return createOptions
  }

  // Pattern to match --gpus runner_decide (with various quoting styles)
  // Handles: --gpus runner_decide, --gpus=runner_decide, --gpus "runner_decide", etc.
  const gpuPattern = /(--gpus[=\s]+)(['"]?)runner_decide\2/g

  if (!gpuPattern.test(createOptions)) {
    return createOptions
  }

  const runnerVisibleDevices = env.RUNNER_VISIBLE_DEVICES

  if (!runnerVisibleDevices) {
    core.warning(
      'Hook: Found --gpus runner_decide but RUNNER_VISIBLE_DEVICES is not set. GPU allocation will be skipped.'
    )
    // Remove the --gpus runner_decide option entirely if env var is not set
    // Need to recreate the pattern since test() consumes it
    return createOptions
      .replace(/(--gpus[=\s]+)(['"]?)runner_decide\2/g, '')
      .trim()
  }

  core.info(
    `Hook: Replacing --gpus runner_decide with --gpus ${runnerVisibleDevices}`
  )
  // Need to recreate the pattern since test() consumes it
  return createOptions.replace(
    /(--gpus[=\s]+)(['"]?)runner_decide\2/g,
    `$1"${runnerVisibleDevices}"`
  )
}
