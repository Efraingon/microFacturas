import { createWorker, PSM } from 'tesseract.js'
import type { ReceiptDraft } from '../types'
import { detectVenezuelanBank } from './banks'

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = source
  })
}

/** Locate the light paper region so patterned backgrounds do not dominate OCR. */
async function prepareReceiptImage(source: string): Promise<{ gray: string; threshold: string; details: string }> {
  const image = await loadImage(source)
  const sampleWidth = 480
  const scale = sampleWidth / image.naturalWidth
  const sampleHeight = Math.round(image.naturalHeight * scale)
  const sample = document.createElement('canvas')
  sample.width = sampleWidth
  sample.height = sampleHeight
  const sampleContext = sample.getContext('2d', { willReadFrequently: true })
  if (!sampleContext) return { gray: source, threshold: source, details: source }
  sampleContext.drawImage(image, 0, 0, sampleWidth, sampleHeight)
  const { data } = sampleContext.getImageData(0, 0, sampleWidth, sampleHeight)
  const bright = new Uint8Array(sampleWidth * sampleHeight)
  for (let y = 0; y < sampleHeight; y++) {
    for (let x = 0; x < sampleWidth; x++) {
      const index = (y * sampleWidth + x) * 4
      const red = data[index], green = data[index + 1], blue = data[index + 2]
      const maximum = Math.max(red, green, blue), minimum = Math.min(red, green, blue)
      if (red > 158 && green > 151 && blue > 148 && maximum - minimum < 74) bright[y * sampleWidth + x] = 1
    }
  }

  let top = sampleHeight, bottom = -1
  for (let y = 0; y < sampleHeight; y++) {
    let count = 0
    for (let x = 0; x < sampleWidth; x++) count += bright[y * sampleWidth + x]
    if (count > sampleWidth * 0.31) { top = Math.min(top, y); bottom = Math.max(bottom, y) }
  }
  let left = sampleWidth, right = -1
  if (bottom > top) {
    for (let x = 0; x < sampleWidth; x++) {
      let count = 0
      for (let y = top; y <= bottom; y++) count += bright[y * sampleWidth + x]
      if (count > (bottom - top) * 0.20) { left = Math.min(left, x); right = Math.max(right, x) }
    }
  }

  const boxWidth = right - left + 1, boxHeight = bottom - top + 1
  const validCrop = boxWidth > sampleWidth * 0.24 && boxHeight > sampleHeight * 0.12 && boxWidth * boxHeight > sampleWidth * sampleHeight * 0.06
  const sourceX = validCrop ? Math.max(0, Math.floor((left - boxWidth * 0.035) / scale)) : 0
  const sourceY = validCrop ? Math.max(0, Math.floor((top - boxHeight * 0.035) / scale)) : 0
  const sourceRight = validCrop ? Math.min(image.naturalWidth, Math.ceil((right + boxWidth * 0.035) / scale)) : image.naturalWidth
  const sourceBottom = validCrop ? Math.min(image.naturalHeight, Math.ceil((bottom + boxHeight * 0.035) / scale)) : image.naturalHeight
  const cropWidth = sourceRight - sourceX, cropHeight = sourceBottom - sourceY
  const upscale = Math.min(2.8, 2800 / Math.max(cropWidth, cropHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(cropWidth * upscale)
  canvas.height = Math.round(cropHeight * upscale)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return { gray: source, threshold: source, details: source }
  context.filter = 'grayscale(1) contrast(1.55) brightness(1.04)'
  context.drawImage(image, sourceX, sourceY, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height)
  const gray = canvas.toDataURL('image/png')
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
  for (let index = 0; index < pixels.data.length; index += 4) {
    const value = pixels.data[index] < 168 ? 0 : 255
    pixels.data[index] = value
    pixels.data[index + 1] = value
    pixels.data[index + 2] = value
  }
  context.putImageData(pixels, 0, 0)
  const detailCanvas = document.createElement('canvas')
  const detailY = Math.floor(canvas.height * 0.40)
  const detailHeight = Math.max(1, Math.floor(canvas.height * 0.34))
  detailCanvas.width = canvas.width
  detailCanvas.height = detailHeight
  const detailContext = detailCanvas.getContext('2d')
  if (!detailContext) return { gray, threshold: canvas.toDataURL('image/png'), details: gray }
  detailContext.drawImage(canvas, 0, detailY, canvas.width, detailHeight, 0, 0, canvas.width, detailHeight)
  return { gray, threshold: canvas.toDataURL('image/png'), details: detailCanvas.toDataURL('image/png') }
}

function normalizeLines(text: string): string[] {
  return text.replace(/\r/g, '').split('\n').map((line) => line.replace(/[|]/g, 'I').replace(/\s+/g, ' ').trim()).filter(Boolean)
}

function findMatch(text: string, patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) return match[1].trim().replace(/[.,;:]$/, '')
  }
  return ''
}

function parseAmount(raw: string): number | undefined {
  let value = raw.replace(/[^\d,.]/g, '')
  if (!value) return undefined
  if (value.includes(',') && value.includes('.')) {
    value = value.lastIndexOf(',') > value.lastIndexOf('.') ? value.replace(/\./g, '').replace(',', '.') : value.replace(/,/g, '')
  } else if (value.includes(',')) {
    const decimals = value.split(',').at(-1)?.length ?? 0
    value = decimals === 2 ? value.replace(',', '.') : value.replace(/,/g, '')
  } else if ((value.match(/\./g) ?? []).length > 1) {
    const lastDot = value.lastIndexOf('.')
    value = value.slice(0, lastDot).replace(/\./g, '') + value.slice(lastDot)
  }
  const amount = Number(value)
  return Number.isFinite(amount) ? amount : undefined
}

function parseReceipt(text: string): Partial<ReceiptDraft> {
  const lines = normalizeLines(text)
  const normalized = lines.join('\n')
  const dateText = findMatch(normalized, [/(?:fecha|date)\s*[:#-]?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i, /\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/])
  let date = ''
  if (dateText) {
    const [day, month, yearRaw] = dateText.split(/[/-]/)
    const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw
    const monthNumber = Number(month), dayNumber = Number(day)
    if (monthNumber >= 1 && monthNumber <= 12 && dayNumber >= 1 && dayNumber <= 31) date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }

  const numberPatterns = [
    /\bticket\s*(?:n(?:ro|[ºo])?\.?\s*)?[:#-]?\s*([A-Z0-9-]{3,})/i,
    /\bno\.?\s*operac(?:i[oó]n)?\.?\s*[:#-]?\s*([A-Z0-9-]{4,})/i,
    /\bno\.?\s*autor(?:izaci[oó]n)?\.?\s*[:#-]?\s*([A-Z0-9-]{4,})/i,
    /(?:n(?:ro|úm)?\.?\s*(?:de\s*)?(?:comprobante|referencia|operaci[oó]n)|comprobante|referencia)\s*[:#-]?\s*([A-Z0-9-]{4,})/i,
  ]
  const operationLine = lines.findIndex((line) => /(?:oper|opre|operac)/i.test(line))
  const nearbyOperationNumber = operationLine >= 0
    ? lines.slice(operationLine + 1, operationLine + 4).map((line) => line.match(/\b(\d{4,8})\b/)?.[1]).find(Boolean) ?? ''
    : ''
  const receiptNumber = findMatch(normalized, numberPatterns) || nearbyOperationNumber
  const amountText = findMatch(normalized, [/(?:monto|montos|total)\s*(?:bs\.?\s*)?[:$-]?\s*(?:bs\.?\s*)?(\d[\d.,]*)/i, /(?:bs\.?|ves)\s*[:$-]?\s*(\d[\d.,]*)/i])
  const explicitAmount = parseAmount(amountText)
  const genericAmount = parseAmount(findMatch(normalized, [/\b(\d{1,3}(?:[.,]\d{2}))\b/]))
  const amount = explicitAmount ?? (genericAmount !== undefined && genericAmount >= 10 ? genericAmount : undefined)
  const bank = detectVenezuelanBank(normalized) || (() => {
    const bankLine = lines.find((line) => /\bbanco\b/i.test(line))
    return bankLine ? bankLine.replace(/^.*?\bbanco\b\s*/i, '').trim() ? `BANCO ${bankLine.replace(/^.*?\bbanco\b\s*/i, '').trim()}` : 'BANCO' : findMatch(normalized, [/(?:banco|tarjeta)\s*[:#-]?\s*([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ ]{2,})/i])
  })()
  const headerStop = /\b(venta|d[eé]bito|cr[eé]dito|fecha|banco|maestro|rif|r\.?i\.?f\.?)\b/i
  const header = lines.slice(0, 6).filter((line) => !headerStop.test(line) && !/\d{4,}/.test(line)).slice(0, 3)
  const rawLocation = header.join(' ').replace(/\s+/g, ' ').trim()
  const store = findMatch(normalized, [/\b(LA\s+N.?ROSA)\b/i, /\b(FRIGOR[IÍ]FICO\s+LA\s+ROSA)\b/i, /\b(ILANUSA)\b/i])
  const city = findMatch(normalized, [/\b(MIRANDA|MINANDA)\b/i])
  const location = store
    ? `${/ILANUSA/i.test(store) ? 'LA ROSA' : store.replace(/N.?ROSA/i, 'ROSA')}${city ? ` - ${city.replace(/MINANDA/i, 'MIRANDA')}` : ''}`
    : rawLocation
  return { date, receiptNumber, amount, bank: bank.replace(/\s+/g, ' ').trim(), location }
}

export async function readReceipt(image: string, onProgress: (progress: number) => void): Promise<Partial<ReceiptDraft>> {
  const prepared = await prepareReceiptImage(image)
  const worker = await createWorker('spa', 1, { logger: (message) => message.status === 'recognizing text' && onProgress(message.progress) })
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, user_defined_dpi: '300', preserve_interword_spaces: '1' })
    const first = await worker.recognize(prepared.gray)
    onProgress(0.55)
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT })
    const second = await worker.recognize(prepared.threshold)
    onProgress(0.78)
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK })
    const details = await worker.recognize(prepared.details)
    const parsedFirst = parseReceipt(first.data.text)
    const parsedSecond = parseReceipt(second.data.text)
    const parsedDetails = parseReceipt(details.data.text)
    return {
      date: parsedDetails.date || parsedFirst.date || parsedSecond.date,
      receiptNumber: parsedDetails.receiptNumber || parsedFirst.receiptNumber || parsedSecond.receiptNumber,
      amount: parsedDetails.amount ?? parsedSecond.amount ?? parsedFirst.amount,
      bank: parsedDetails.bank || parsedFirst.bank || parsedSecond.bank,
      location: parsedFirst.location || parsedDetails.location || parsedSecond.location,
    }
  } finally {
    await worker.terminate()
  }
}
