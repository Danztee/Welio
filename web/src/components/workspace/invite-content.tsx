import { Notice } from "@/components/platform/shared";
import { AcceptInvite } from "@/components/workspace/invite";
import { TextLink } from "@/components/ui/text-link";
import type { currentUser } from "@/lib/auth/session";

export function InviteContent({
  token,
  user,
  name,
  error,
}: {
  token: string;
  user: Awaited<ReturnType<typeof currentUser>>;
  name: string;
  error: string;
}) {
  if (!token)
    return <Notice error>Open the invitation link from your email.</Notice>;

  if (!user)
    return (
      <>
        <p className="text-sm text-muted-foreground">
          Sign in or create an account using the email that received this
          invitation.
        </p>
        <TextLink
          href={`/sign-in?next=${encodeURIComponent(`/accept-invite?token=${token}`)}`}
        >
          Sign in to accept
        </TextLink>
        <TextLink
          href={`/sign-up?next=${encodeURIComponent(`/accept-invite?token=${token}`)}`}
        >
          Create an account
        </TextLink>
      </>
    );

  if (error)
    return (
      <>
        <Notice error>{error}</Notice>
        <TextLink href="/dashboard">Return to dashboard</TextLink>
      </>
    );

  return (
    <>
      <p className="text-sm">
        You’re invited to join <strong>{name}</strong> as a staff member.
      </p>
      <p className="text-xs text-muted-foreground">Signed in as {user.email}</p>
      <AcceptInvite token={token} />
    </>
  );
}
