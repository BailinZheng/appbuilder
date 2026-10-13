import { ResetPasswordForm } from "../password-forms";

// Reached from the e-mail link: Better Auth checks the token and redirects here with ?token=… or ?error=INVALID_TOKEN.
export default async function ResetPassword({ searchParams }: PageProps<"/reset-password">) {
  const { token, error } = await searchParams;
  return (
    <main className="flex flex-1 items-center justify-center px-6">
      <ResetPasswordForm token={typeof token === "string" ? token : null} invalid={Boolean(error)} />
    </main>
  );
}
