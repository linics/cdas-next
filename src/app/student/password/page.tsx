import { getPasswordChangeActor } from "../../../server/auth/current-actor";
import { redirect } from "next/navigation";
import { PasswordChangeForm } from "../../auth/password-change-form";

export default async function StudentPasswordPage() {
  const actor = await getPasswordChangeActor();
  if (actor.role !== "STUDENT") redirect("/student/login");
  return <PasswordChangeForm role="student" actorName={actor.displayName} />;
}
