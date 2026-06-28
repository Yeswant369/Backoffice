import SetPasswordForm from "./SetPasswordForm";

// Must render client-side: the invite session may arrive in the URL hash
// (#access_token=…), which the server never sees — so no server-side guard here.
export const dynamic = "force-dynamic";

export default function SetPasswordPage() {
  return <SetPasswordForm />;
}
