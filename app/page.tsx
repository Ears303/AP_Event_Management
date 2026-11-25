import { redirect } from "next/navigation";

// The public landing page is the results page.
export default function Page() {
  redirect("/results");
}
