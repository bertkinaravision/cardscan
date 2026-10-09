import { contactInputSchema } from "@/lib/fields";
import { deleteImages } from "@/lib/server/google";
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
    const removed = await deleteContactRow(id);
    if (!removed) throw new HttpError(404, "Contact not found.");
    const fileIds = removed.image_file_ids.split(",").filter(Boolean);
    const notDeleted = await deleteImages(user.googleAccessToken, fileIds);
    return Response.json({ deleted: true, imagesNotDeleted: notDeleted });
  } catch (err) {
    return errorResponse(err);
  }
}
