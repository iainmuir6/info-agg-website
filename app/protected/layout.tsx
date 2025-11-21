import { ThemeSwitcher } from "@/components/theme-switcher";
import { NewspaperIcon } from "@/components/newspaper-icon";
import { HamburgerIcon } from "@/components/hamburger-icon";

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const currentDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }).toUpperCase();

  return (
    <main className="min-h-screen flex flex-col items-center bg-white">
      <div className="flex-1 w-full flex flex-col items-center">
        {/* Header */}
        <header className="w-full max-w-5xl px-6 py-4">
          <div className="flex items-center justify-between">
            {/* Left: Newspaper Icon */}
            <div className="flex items-center">
              <NewspaperIcon className="w-12 h-12 text-gray-800" />
            </div>
            
            {/* Center: Title and Date */}
            <div className="flex flex-col items-center text-center">
              <h1 className="text-2xl font-bold text-gray-900 tracking-wide">
                INFORMATION AGGREGATOR
              </h1>
              <p className="text-sm text-gray-600 mt-1">
                {currentDate}
              </p>
            </div>
            
            {/* Right: Hamburger Menu */}
            <div className="flex items-center">
              <button className="p-2 hover:bg-gray-100 rounded-md">
                <HamburgerIcon className="w-6 h-6 text-gray-800" />
              </button>
            </div>
          </div>
        </header>

        {/* Double divider lines below navigation */}
        <div className="w-full max-w-5xl mx-auto mt-2">
          <div className="flex justify-center">
            <div className="flex space-x-8">
              <div className="h-2 w-full border-b-2 border-b-2 border-gray-200" />
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 w-full max-w-5xl px-6 py-0">
          {children}
        </div>

        {/* Footer */}
        <footer className="w-full flex items-center justify-center border-t mx-auto text-center text-xs gap-8 py-16">
          <p>
            Powered by{" "}
            <a
              href="https://supabase.com/?utm_source=create-next-app&utm_medium=template&utm_term=nextjs"
              target="_blank"
              className="font-bold hover:underline"
              rel="noreferrer"
            >
              Supabase
            </a>
          </p>
          <ThemeSwitcher />
        </footer>
      </div>
    </main>
  );
}
