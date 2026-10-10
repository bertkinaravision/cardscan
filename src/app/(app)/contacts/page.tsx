import { ContactsScreen } from "@/components/ContactsScreen";
import { owners } from "@/lib/server/env";

export default function ContactsPage() {
  return <ContactsScreen owners={owners()} />;
}
