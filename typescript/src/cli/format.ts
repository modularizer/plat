/**
 * Built-in CLI output formatters. Pure (no node-only imports besides the optional terminal width),
 * so the lightweight client package can ship them.
 */

export function formatJson(data: any): string {
  return JSON.stringify(data, null, 2)
}

export function formatYaml(data: any, indent = 0): string {
  const pad = '  '.repeat(indent)
  if (data === null || data === undefined) return pad + 'null'
  if (typeof data === 'string') return data.includes('\n') ? `|\n${data.split('\n').map(l => pad + '  ' + l).join('\n')}` : data
  if (typeof data !== 'object') return String(data)
  if (Array.isArray(data)) {
    if (data.length === 0) return '[]'
    return data.map(item => {
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
        const entries = Object.entries(item)
        const first = entries[0]!
        const rest = entries.slice(1)
        let s = pad + '- ' + first[0] + ': ' + formatYaml(first[1], indent + 2)
        for (const [k, v] of rest) s += '\n' + pad + '  ' + k + ': ' + formatYaml(v, indent + 2)
        return s
      }
      return pad + '- ' + formatYaml(item, indent + 1)
    }).join('\n')
  }
  const entries = Object.entries(data)
  if (entries.length === 0) return '{}'
  return entries.map(([k, v]) => {
    if (typeof v === 'object' && v !== null) return pad + k + ':\n' + formatYaml(v, indent + 1)
    return pad + k + ': ' + formatYaml(v, indent)
  }).join('\n')
}

export function formatHuman(data: any, indent = 0): string {
  const pad = '  '.repeat(indent)
  if (data === null || data === undefined) return pad + '\u2014'
  if (typeof data !== 'object') return pad + String(data)
  if (Array.isArray(data)) {
    if (data.length === 0) return pad + '(empty)'
    return data.map((item, i) => {
      const prefix = pad + (i + 1) + '. '
      const body = formatHuman(item, 0).trimStart()
      const contPad = ' '.repeat(prefix.length)
      return prefix + body.split('\n').map((line, j) => j === 0 ? line : contPad + line).join('\n')
    }).join('\n')
  }
  return Object.entries(data).map(([k, v]) => {
    if (typeof v === 'object' && v !== null) return pad + k + ':\n' + formatHuman(v, indent + 1)
    return pad + k + ': ' + (v ?? '\u2014')
  }).join('\n')
}

export function formatTable(data: any): string {
  let rows: any[]
  if (Array.isArray(data)) rows = data
  else if (typeof data === 'object' && data !== null) {
    const vals = Object.values(data)
    const arrVal = vals.find(v => Array.isArray(v))
    if (arrVal) rows = arrVal as any[]
    else rows = [data]
  } else {
    return String(data)
  }

  if (rows.length === 0) return '(empty)'
  if (typeof rows[0] !== 'object' || rows[0] === null) return rows.map(String).join('\n')

  const flatRows = rows.map(row => {
    const flat: Record<string, string> = {}
    for (const [k, v] of Object.entries(row)) {
      flat[k] = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '')
    }
    return flat
  })

  const cols = Array.from(new Set(flatRows.flatMap(r => Object.keys(r))))
  const termWidth = (process.stdout as any).columns || 120

  const widths: Record<string, number> = {}
  for (const col of cols) {
    widths[col] = col.length
    for (const row of flatRows) {
      widths[col] = Math.max(widths[col]!, (row[col] || '').length)
    }
  }

  const borders = 1 + cols.length * 3
  let totalWidth = borders + cols.reduce((s, c) => s + widths[c]!, 0)
  while (totalWidth > termWidth) {
    let widest = cols[0]!, maxW = 0
    for (const c of cols) { if (widths[c]! > maxW) { maxW = widths[c]!; widest = c } }
    if (maxW <= 4) break
    widths[widest] = Math.max(4, widths[widest]! - 1)
    totalWidth = borders + cols.reduce((s, c) => s + widths[c]!, 0)
  }

  const truncate = (s: string, w: number) => s.length > w ? s.slice(0, w - 1) + '\u2026' : s

  const hline = (left: string, mid: string, right: string) =>
    left + cols.map(c => '\u2500'.repeat(widths[c]! + 2)).join(mid) + right
  const dataRow = (row: Record<string, string>) =>
    '\u2502' + cols.map(c => ' ' + truncate(row[c] || '', widths[c]!).padEnd(widths[c]!) + ' ').join('\u2502') + '\u2502'

  const lines: string[] = []
  lines.push(hline('\u250c', '\u252c', '\u2510'))
  lines.push('\u2502' + cols.map(c => ' ' + truncate(c, widths[c]!).padEnd(widths[c]!) + ' ').join('\u2502') + '\u2502')
  lines.push(hline('\u251c', '\u253c', '\u2524'))
  for (const row of flatRows) lines.push(dataRow(row))
  lines.push(hline('\u2514', '\u2534', '\u2518'))
  return lines.join('\n')
}

export function formatCsv(data: any): string {
  let rows: any[]
  if (Array.isArray(data)) rows = data
  else if (typeof data === 'object' && data !== null) {
    const arrVal = Object.values(data).find(v => Array.isArray(v))
    if (arrVal) rows = arrVal as any[]
    else rows = [data]
  } else return String(data)

  if (rows.length === 0) return ''
  if (typeof rows[0] !== 'object' || rows[0] === null) return rows.map(String).join('\n')

  const cols = Array.from(new Set(rows.flatMap(r => Object.keys(r))))
  const esc = (v: any) => {
    const s = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '')
    return s.includes(',') || s.includes('"') || s.includes('\n') ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const lines = [cols.join(',')]
  for (const row of rows) lines.push(cols.map(c => esc(row[c])).join(','))
  return lines.join('\n')
}

export type CliFormatter = (data: any) => string

/** Name → formatter. A CLI adds or replaces entries through `CliOptions.formatters`. */
export const defaultFormatters: Record<string, CliFormatter> = {
  json: formatJson,
  yaml: (data) => formatYaml(data),
  table: formatTable,
  csv: formatCsv,
  human: (data) => formatHuman(data),
}
