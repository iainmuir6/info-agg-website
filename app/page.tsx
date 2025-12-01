import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  try {
    const supabase = await createClient();
    
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims) {
      // User not authenticated, show landing page
      return (
        <main className="min-h-screen flex flex-col items-center">
          <div className="flex-1 w-full flex flex-col gap-20 items-center">
            <nav className="w-full flex justify-center border-b border-b-foreground/10 h-16">
              <div className="w-full max-w-5xl flex justify-between items-center p-3 px-5 text-sm">
                <div className="flex gap-5 items-center font-semibold">
                  <span>Info Aggregator</span>
                </div>
              </div>
            </nav>
            <div className="flex-1 flex flex-col gap-20 max-w-5xl p-5">
              <div className="text-center">
                <h1 className="text-4xl font-bold mb-4">Welcome to Info Aggregator</h1>
                <p className="text-lg text-muted-foreground mb-8">
                  Your personal dashboard for news, sports, markets, media, and more.
                </p>
                <a 
                  href="/auth/login" 
                  className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
                >
                  Get Started
                </a>
              </div>
            </div>
          </div>
        </main>
      );
    }
    
    // User is authenticated, redirect to protected home page
    redirect("/protected");
  } catch (error) {
    // If there's an error (e.g., Supabase connection issue), show landing page
    console.error("Error in Home page:", error);
    return (
      <main className="min-h-screen flex flex-col items-center">
        <div className="flex-1 w-full flex flex-col gap-20 items-center">
          <nav className="w-full flex justify-center border-b border-b-foreground/10 h-16">
            <div className="w-full max-w-5xl flex justify-between items-center p-3 px-5 text-sm">
              <div className="flex gap-5 items-center font-semibold">
                <span>Info Aggregator</span>
              </div>
            </div>
          </nav>
          <div className="flex-1 flex flex-col gap-20 max-w-5xl p-5">
            <div className="text-center">
              <h1 className="text-4xl font-bold mb-4">Welcome to Info Aggregator</h1>
              <p className="text-lg text-muted-foreground mb-8">
                Your personal dashboard for news, sports, markets, media, and more.
              </p>
              <a 
                href="/auth/login" 
                className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
              >
                Get Started
              </a>
            </div>
          </div>
        </div>
      </main>
    );
  }
}
