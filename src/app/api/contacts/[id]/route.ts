import { contactInputSchema } from "@/lib/fields";
import { deleteImages } from "@/lib/server/google";
import { driveUploadMode } from "@/lib/server/env";
import { errorResponse, HttpError, requireUser } from "@/lib/server/session";
import { deleteContactRow, updateContact } from "@/lib/server/sheet";

const patchSchema = contactInputSchema.partial();

// Edit some fields of a contact (for example status or next action).
export async function PATCH(req: Request, ctx: RouteContext<"/api/contacts/[id]">) {
  try {
    await requireUser(req);
    const { id } = await ctx.params;
    const parsed = patchSchema.safeParse(await req.json());
    if (!parsed.success) throw new HttpError(400, "Some fields are invalid.");
    const updated = await updateContact(id, parsed.data);
    if (!updated) throw new HttpError(404, "Contact not found.");
    return Response.json({ contact: updated });
  } catch (err) {
    return errorResponse(err);
  }
}

// Deletes the Sheet row and the card photos in Drive (PDPA: on request, remove everything).
export async function DELETE(req: Request, ctx: RouteContext<"/api/contacts/[id]">) {
  try {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    // Check Drive access before touching the row, so a delete never stops halfway.
    if (driveUploadMode() === "user" && !user.googleAccessToken) {
      throw new HttpError(401, "Google Drive access has expired. Sign out and sign in again, then delete.");
    }
    const removed = await deleteContactRow(id);
    if (!removed) throw new HttpError(404, "Contact not found.");
    const fileIds = removed.image_file_ids.split(",").filter(Boolean);
    // The row is gone at this point: report photos that could not be removed instead of failing.
    const notDeleted = await deleteImages(user.googleAccessToken, fileIds).catch((err) => {
      console.error(err);
      return fileIds;
    });
    return Response.json({ deleted: true, imagesNotDeleted: notDeleted });
  } catch (err) {
    return errorResponse(err);
  }
}
