import { runCli } from '../runtime'
import { getArgValue, getFirstPositionalArg, hasDirectorySpec, isUrl, loadSpecSource, looksLikeHost, stripFirstPositionalArg, stripOption } from '../spec-source'

/**
 * plat run [--src <file-or-url>] <command> [--key=value ...]
 */
export async function runOpenApi(cwd: string, argv: string[] = []): Promise<void> {
  const explicitSrc = getArgValue(argv, '--src')
  const positionalSrc = explicitSrc ? undefined : await inferPositionalSource(argv, cwd)
  const src = explicitSrc ?? positionalSrc
  const withoutSrcFlag = stripOption(argv, '--src')
  const passthrough = positionalSrc ? stripFirstPositionalArg(withoutSrcFlag) : withoutSrcFlag
  const { spec, baseUrl } = await loadSpecSource(src, cwd)
  await runCli(spec, passthrough, { baseUrl })
}

async function inferPositionalSource(argv: string[], cwd: string): Promise<string | undefined> {
  const candidate = getFirstPositionalArg(argv)
  if (!candidate) return undefined
  if (isUrl(candidate)) return candidate
  if (/\.(json|ya?ml)$/i.test(candidate)) return candidate
  if (looksLikeHost(candidate)) return candidate
  if (candidate.includes('/') || candidate.includes('\\')) return candidate
  if (await hasDirectorySpec(candidate, cwd)) return candidate
  return undefined
}
