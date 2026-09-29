import Link from "next/link";
import { SettingsMenu } from "@/components/SettingsMenu";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5">
        <Link href="/" className="text-lg font-bold">AppBuilder</Link>
        <SettingsMenu />
      </header>
      {children}
    </div>
  );
}
