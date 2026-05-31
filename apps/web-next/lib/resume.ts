// 이력서 파일 → 텍스트 추출 + 정제. apps/web/src/Chat.tsx 로직을 web-next로 이식.
// PDF 워커는 로컬 번들로 로드 — 설치된 pdfjs-dist 버전과 항상 일치한다.
// (CDN 고정 버전은 라이브러리 버전과 어긋나면 "API version does not match Worker
//  version"으로 파싱이 통째로 실패하므로 사용하지 않는다.)
// Next.js(Turbopack/webpack)에서는 Vite의 `?url` 쿼리 임포트 대신
// `new URL(..., import.meta.url)`로 워커 에셋 URL을 얻는다.

export const MAX_RESUME_CHARS = 20000;

async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const textParts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    textParts.push(pageText);
  }
  return textParts.join("\n");
}

/** PDF/txt/md 파일에서 텍스트를 추출한다. 지원하지 않는 형식이면 null. */
export async function extractFileText(file: File): Promise<string | null> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") {
    return extractPdfText(file);
  }
  if (ext === "txt" || ext === "md") {
    return file.text();
  }
  return null;
}

/**
 * 이력서 추출 텍스트에서 노이즈 라인을 제거한다.
 * - `file://` URL 라인 (PDF 렌더링 아티팩트)
 * - `YY. M. D. 오전/오후 H:MM` 형태의 날짜/시간 라인
 * - `숫자/숫자` 형태의 페이지번호 단독 라인
 * - 3줄 이상 연속 빈 줄을 2줄로 압축
 */
export function sanitizeResumeText(raw: string): string {
  return raw
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (/^file:\/\//i.test(t)) return false;
      if (/^\d{2,4}\.\s*\d{1,2}\.\s*\d{1,2}\.\s*(오전|오후)\s*\d{1,2}:\d{2}/.test(t))
        return false;
      if (/^\d+\/\d+$/.test(t)) return false;
      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_RESUME_CHARS);
}
