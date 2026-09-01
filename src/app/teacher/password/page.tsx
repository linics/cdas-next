import { getPasswordChangeActor } from "../../../server/auth/current-actor";
import { redirect } from "next/navigation";
import { PasswordChangeForm } from "../../auth/password-change-form";

export default async function TeacherPasswordPage() {
  const actor = await getPasswordChangeActor();
  if (actor.role !== "TEACHER") redirect("/teacher/login");
  return <PasswordChangeForm role="teacher" actorName={actor.displayName} />;
}
