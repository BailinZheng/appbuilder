import { auth } from "@/lib/auth";
import { MAX_UPLOAD_BYTES } from "@/lib/media/limits";
import { saveImageUpload, UploadError } from "@/lib/media/uploads";

const STATUS: Record<string, number> = { tooLarge: 413, unsupportedType: 415, invalidImage: 422, tooManyImages: 409, notFound: 404 };

/** Image upload for the editor: multipart form with `file` and `appId`. Returns { url, width, height }. */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  // Reject oversized bodies before reading them (multipart overhead allowance: 64 KB).
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_UPLOAD_BYTES + 64 * 1024) return Response.json({ error: "tooLarge" }, { status: 413 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "invalidImage" }, { status: 400 });
  }
  const file = form.get("file");
  const appId = form.get("appId");
  if (!(file instanceof File) || typeof appId !== "string") {
    return Response.json({ error: "invalidImage" }, { status: 400 });
  }

  try {
    const result = await saveImageUpload({ userId: session.user.id, appId, file });
    return Response.json(result, { status: 201 });
  } catch (e) {
    if (e instanceof UploadError) return Response.json({ error: e.code }, { status: STATUS[e.code] ?? 400 });
    console.error("[media] upload failed", e);
    return Response.json({ error: "failed" }, { status: 500 });
  }
}
