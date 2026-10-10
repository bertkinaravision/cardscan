import { auth } from "@/auth";
import { ReviewScreen } from "@/components/ReviewScreen";
import { ownerFor, owners } from "@/lib/server/env";

export default async function ReviewPage({ params }: PageProps<"/review/[id]">) {
  const { id } = await params;
  const session = await auth();
  return <ReviewScreen id={id} defaultOwner={ownerFor(session?.user?.name)} owners={owners()} />;
}
