/**
 * GET /api/attachment - image bytes for the transcript (story #134 task #135
 * commit 9; AC 20).
 *
 * Images already in the transcript render through an `<img>` src here; the
 * route calls `session.attachment`, which PROVES the session's log
 * references the id before returning the bytes, and re-serves them as the
 * image with `private` caching (single-user surface, content-addressed id -
 * immutable bytes, safe to cache). The host path never crosses to the
 * browser: the URL carries only the opaque attachmentId and the session it
 * belongs to, and the query is the same fence-covered door as everything
 * else (AC 24).
 */
import { AttachmentId } from "@deepseek-ai/dsh-attachment";
import { SessionId } from "@deepseek-ai/dsh-session/types";
import { getBridgeClient } from "@/lib/bridge";

export const dynamic = "force-dynamic";

/** Media types the route will echo; anything else is served as octet-stream. */
const MEDIA_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");
  const attachmentId = url.searchParams.get("attachmentId");
  if (sessionId === null || sessionId === "" || attachmentId === null || attachmentId === "") {
    return Response.json({ error: "sessionId and attachmentId are required" }, { status: 400 });
  }
  try {
    const response = await getBridgeClient().sessions.attachment({
      sessionId: SessionId(sessionId),
      attachmentId: AttachmentId(attachmentId),
    });
    if (!response.result.ok) {
      // The host proved the reference or refused it; mirror that line here -
      // never a fallback that could leak bytes across sessions.
      return Response.json(
        { error: response.result.error.code },
        {
          status: response.result.error.code === "session-not-found" ? 404 : 404,
        },
      );
    }
    const { attachment, data } = response.result.value;
    const bytes = Buffer.from(data, "base64");
    const mediaType = MEDIA_TYPES.has(attachment.mediaType)
      ? attachment.mediaType
      : "application/octet-stream";
    return new Response(bytes, {
      headers: {
        "content-type": mediaType,
        "content-length": String(bytes.byteLength),
        "cache-control": "private, max-age=31536000, immutable",
        "x-accel-buffering": "no",
      },
    });
  } catch (error) {
    console.error("[attachment] read failed:", error);
    return Response.json({ error: "attachment unavailable" }, { status: 503 });
  }
}
