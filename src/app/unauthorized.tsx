import Link from "next/link";

export default function Unauthorized() {
  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-4">
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold">401</h1>
        <p className="text-muted-foreground">
          You need to sign in to access this page.
        </p>
        <Link
          href="/login"
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Sign in
        </Link>
      </div>
    </div>
  );
}
