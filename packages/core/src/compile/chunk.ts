export interface TextChunk {
  text: string;
  charStart: number;
  charEnd: number;
}

export function chunkBody(body: string): TextChunk[] {
  if (!body.trim()) return [];
  const boundaries: number[] = [];
  for (const match of body.matchAll(/(?:\r?\n)[\t ]*(?:\r?\n)(?:[\t ]*\r?\n)*/g)) {
    boundaries.push(match.index, match.index + match[0].length);
  }
  boundaries.push(body.length);
  const chunks: TextChunk[] = [];
  let start = 0;
  let end = 0;
  for (const boundary of boundaries) {
    if (boundary - start > 3_000 && end > start) {
      chunks.push({ text: body.slice(start, end), charStart: start, charEnd: end });
      start = end;
    }
    while (boundary - start > 3_000) {
      let split = start + 3_000;
      const code = body.charCodeAt(split - 1);
      if (code >= 0xd800 && code <= 0xdbff) split -= 1;
      chunks.push({ text: body.slice(start, split), charStart: start, charEnd: split });
      start = split;
    }
    end = boundary;
  }
  if (end > start) chunks.push({ text: body.slice(start, end), charStart: start, charEnd: end });
  return chunks;
}
