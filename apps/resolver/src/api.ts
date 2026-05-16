import type { EvidencePacket } from "./types.js";

export type PostEvidenceResult =
  | { ok: true; evidenceURI: string; status: number }
  | { ok: false; evidenceURI: string; status: number; message: string };

export function localEvidenceURI(packet: EvidencePacket): string {
  return `local://evidence/${packet.marketId}/${encodeURIComponent(packet.generatedAt)}`;
}

export async function postEvidencePacket(packet: EvidencePacket, apiBaseUrl: string): Promise<PostEvidenceResult> {
  const fallbackURI = localEvidenceURI(packet);
  const baseUrl = apiBaseUrl.replace(/\/$/, "");
  let response = await postPacket(`${baseUrl}/evidence`, packet);
  if (response.status === 404) {
    response = await postPacket(`${baseUrl}/local/evidence`, packet);
  }

  const body = await response.json().catch(() => null);
  const evidenceURI = evidenceURIFromBody(body) ?? fallbackURI;

  if (!response.ok) {
    return {
      ok: false,
      evidenceURI,
      status: response.status,
      message: typeof body?.message === "string" ? body.message : response.statusText,
    };
  }

  return { ok: true, evidenceURI, status: response.status };
}

function postPacket(url: string, packet: EvidencePacket): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(packet),
  });
}

function evidenceURIFromBody(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  for (const key of ["evidenceURI", "uri", "url", "id"]) {
    if (typeof record[key] === "string" && record[key].length > 0) {
      return record[key];
    }
  }
  return null;
}
