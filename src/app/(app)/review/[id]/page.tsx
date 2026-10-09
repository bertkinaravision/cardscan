import { auth } from "@/auth";
import { ReviewScreen } from "@/components/ReviewScreen";

export default async function ReviewPage({ params }: PageProps<"/review/[id]">) {
  const { id } = await params;
  const session = await auth();
  const defaultOwner = session?.user?.name?.split(" ")[0] ?? "";
  return <ReviewScreen id={id} defaultOwner={defaultOwner} />;
}
